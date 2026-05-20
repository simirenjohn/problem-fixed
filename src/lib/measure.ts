import * as turf from "@turf/turf";

export function lineDistanceMeters(latlngs: Array<[number, number]>): number {
  if (latlngs.length < 2) return 0;
  // latlngs are [lat, lng]; turf expects [lng, lat]
  const coords = latlngs.map(([lat, lng]) => [lng, lat]);
  const line = turf.lineString(coords);
  return turf.length(line, { units: "kilometers" }) * 1000;
}

export function polygonAreaSqMeters(latlngs: Array<[number, number]>): number {
  if (latlngs.length < 3) return 0;
  const coords = latlngs.map(([lat, lng]) => [lng, lat]);
  const ring = [...coords, coords[0]];
  const poly = turf.polygon([ring]);
  return turf.area(poly);
}

export function polygonPerimeterMeters(coords: number[][]): number {
  // coords as [lng, lat] ring (closed)
  if (coords.length < 2) return 0;
  const line = turf.lineString(coords);
  return turf.length(line, { units: "kilometers" }) * 1000;
}

export function geojsonPolygonArea(geom: GeoJSON.Polygon): number {
  return turf.area(turf.polygon(geom.coordinates));
}

export function geojsonPolygonPerimeter(geom: GeoJSON.Polygon): number {
  return polygonPerimeterMeters(geom.coordinates[0]);
}

export function formatArea(m2: number): string {
  const ha = m2 / 10000;
  return `${m2.toLocaleString(undefined, { maximumFractionDigits: 0 })} m² (${ha.toFixed(3)} ha)`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(3)} km (${m.toFixed(0)} m)`;
  return `${m.toFixed(1)} m`;
}