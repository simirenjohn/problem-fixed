// Import various GIS file formats into a list of points + optional shapes.
import JSZip from "jszip";
import { kml, gpx } from "@tmcw/togeojson";
import shp from "shpjs";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { newPointId, type CoordPoint, type Measurement } from "@/lib/projects";
import { newMeasurementId } from "@/lib/projects";

export type ImportResult = {
  points: CoordPoint[];
  measurements: Measurement[];
  warnings: string[];
};

function pushVertex(
  out: CoordPoint[],
  lng: number,
  lat: number,
  label: string,
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
  out.push({ id: newPointId(), label, lat, lng });
}

function walkGeometry(
  geom: Geometry | null | undefined,
  baseLabel: string,
  points: CoordPoint[],
  measurements: Measurement[],
) {
  if (!geom) return;
  switch (geom.type) {
    case "Point":
      pushVertex(points, geom.coordinates[0], geom.coordinates[1], baseLabel);
      break;
    case "MultiPoint":
      geom.coordinates.forEach((c, i) =>
        pushVertex(points, c[0], c[1], `${baseLabel} #${i + 1}`),
      );
      break;
    case "LineString":
      measurements.push({
        id: newMeasurementId(),
        type: "distance",
        label: baseLabel,
        points: geom.coordinates.map((c: Position) => [c[1], c[0]]),
      });
      break;
    case "MultiLineString":
      geom.coordinates.forEach((line, i) =>
        measurements.push({
          id: newMeasurementId(),
          type: "distance",
          label: `${baseLabel} ${i + 1}`,
          points: line.map((c: Position) => [c[1], c[0]]),
        }),
      );
      break;
    case "Polygon":
      measurements.push({
        id: newMeasurementId(),
        type: "area",
        label: baseLabel,
        points: geom.coordinates[0].map((c: Position) => [c[1], c[0]]),
      });
      break;
    case "MultiPolygon":
      geom.coordinates.forEach((poly, i) =>
        measurements.push({
          id: newMeasurementId(),
          type: "area",
          label: `${baseLabel} ${i + 1}`,
          points: poly[0].map((c: Position) => [c[1], c[0]]),
        }),
      );
      break;
    case "GeometryCollection":
      geom.geometries.forEach((g) => walkGeometry(g, baseLabel, points, measurements));
      break;
  }
}

function ingestGeoJSON(
  fc: FeatureCollection | Feature,
  warnings: string[],
): ImportResult {
  const points: CoordPoint[] = [];
  const measurements: Measurement[] = [];
  const features: Feature[] =
    fc.type === "FeatureCollection" ? (fc.features as Feature[]) : [fc as Feature];
  features.forEach((f, i) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const label =
      String(props.name ?? props.Name ?? props.NAME ?? props.label ?? `F${i + 1}`);
    walkGeometry(f.geometry, label, points, measurements);
  });
  if (points.length + measurements.length === 0)
    warnings.push("No geometries found in file.");
  return { points, measurements, warnings };
}

function parseCsv(text: string, warnings: string[]): ImportResult {
  const points: CoordPoint[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { points, measurements: [], warnings };
  const header = lines[0].toLowerCase().split(/[,;\t]/).map((s) => s.trim());
  const has = (k: string) => header.findIndex((h) => h === k);
  const latIdx = [has("lat"), has("latitude"), has("y")].find((i) => i >= 0) ?? -1;
  const lngIdx = [has("lng"), has("lon"), has("long"), has("longitude"), has("x")].find(
    (i) => i >= 0,
  ) ?? -1;
  const labelIdx = [has("name"), has("label"), has("id")].find((i) => i >= 0) ?? -1;
  const start = latIdx >= 0 && lngIdx >= 0 ? 1 : 0;
  if (latIdx < 0 || lngIdx < 0) {
    warnings.push("CSV header not recognised; expecting lat/lng or x/y columns. Treating first two columns as lat,lng.");
  }
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/).map((s) => s.trim());
    const lat = Number(parts[latIdx >= 0 ? latIdx : 0]);
    const lng = Number(parts[lngIdx >= 0 ? lngIdx : 1]);
    const label = labelIdx >= 0 ? parts[labelIdx] : `Row ${i}`;
    pushVertex(points, lng, lat, label || `Row ${i}`);
  }
  return { points, measurements: [], warnings };
}

export async function importGisFile(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  const warnings: string[] = [];

  // DWG — not supported in browser
  if (name.endsWith(".dwg")) {
    throw new Error(
      "DWG is a proprietary AutoCAD format and cannot be opened in a browser. Convert it to DXF, SHP, KML, or GeoJSON (e.g. with QGIS or AutoCAD ‘Save As’) and re-import.",
    );
  }

  // KMZ (zip containing doc.kml)
  if (name.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry =
      zip.file(/\.kml$/i)[0] ?? null;
    if (!kmlEntry) throw new Error("KMZ contains no .kml document.");
    const text = await kmlEntry.async("text");
    const doc = new DOMParser().parseFromString(text, "text/xml");
    return ingestGeoJSON(kml(doc) as FeatureCollection, warnings);
  }

  if (name.endsWith(".kml")) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    return ingestGeoJSON(kml(doc) as FeatureCollection, warnings);
  }

  if (name.endsWith(".gpx")) {
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    return ingestGeoJSON(gpx(doc) as FeatureCollection, warnings);
  }

  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    const text = await file.text();
    return ingestGeoJSON(JSON.parse(text), warnings);
  }

  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    const text = await file.text();
    return parseCsv(text, warnings);
  }

  // Shapefile bundle (.zip) or single .shp + sidecars
  if (name.endsWith(".zip") || name.endsWith(".shp")) {
    const buf = await file.arrayBuffer();
    const fc = (await shp(buf)) as FeatureCollection | FeatureCollection[];
    const merged: FeatureCollection = Array.isArray(fc)
      ? { type: "FeatureCollection", features: fc.flatMap((c) => c.features) }
      : fc;
    return ingestGeoJSON(merged, warnings);
  }

  throw new Error(
    `Unsupported file type "${file.name}". Supported: KML, KMZ, GPX, GeoJSON, JSON, CSV/TSV, Shapefile (.zip or .shp).`,
  );
}