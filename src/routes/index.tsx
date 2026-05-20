import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import {
  Search,
  Ruler,
  Hexagon,
  Crosshair,
  Layers,
  X,
  Download,
  MapPin,
  Menu,
  Info,
  Navigation,
} from "lucide-react";
import parcelsData from "@/data/parcels.geojson?raw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  geojsonPolygonArea,
  geojsonPolygonPerimeter,
  formatArea,
  formatDistance,
} from "@/lib/measure";
import {
  downloadBlob,
  parcelToGeoJSON,
  parcelToKML,
} from "@/lib/parcel-export";
import { parseDecimal, utmToLatLng } from "@/lib/coords";

const MapView = lazy(() => import("@/components/map/MapView"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Siana RIM Web Map — Parcel Viewer" },
      {
        name: "description",
        content:
          "Browse digitized Siana RIM land parcels on satellite imagery. Search, identify, measure, and export parcel boundaries.",
      },
      { property: "og:title", content: "Siana RIM Web Map" },
      {
        property: "og:description",
        content:
          "Interactive web map of Siana land parcels with search, measure, and export tools.",
      },
    ],
  }),
  component: Index,
});

type MeasureMode = "none" | "distance" | "area";

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const parcels = useMemo<FeatureCollection<Polygon>>(
    () => JSON.parse(parcelsData) as FeatureCollection<Polygon>,
    [],
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  );
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurePoints, setMeasurePoints] = useState<Array<[number, number]>>([]);
  const [gpsPosition, setGpsPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [coordMode, setCoordMode] = useState<"latlng" | "utm">("latlng");
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [eastingInput, setEastingInput] = useState("");
  const [northingInput, setNorthingInput] = useState("");
  const [utmZone, setUtmZone] = useState("36");
  const [utmHem, setUtmHem] = useState<"N" | "S">("S");
  const [pinnedPoint, setPinnedPoint] = useState<{
    lat: number;
    lng: number;
    label?: string;
  } | null>(null);
  const [coordError, setCoordError] = useState<string | null>(null);

  const goToCoordinates = () => {
    setCoordError(null);
    if (coordMode === "latlng") {
      const lat = parseDecimal(latInput);
      const lng = parseDecimal(lngInput);
      if (lat === null || lng === null) {
        setCoordError("Enter valid decimal latitude and longitude.");
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setCoordError("Lat must be -90..90, Lng -180..180.");
        return;
      }
      setPinnedPoint({ lat, lng, label: `${lat.toFixed(6)}, ${lng.toFixed(6)}` });
      setFlyTo({ lat, lng, zoom: 18 });
    } else {
      const e = parseDecimal(eastingInput);
      const n = parseDecimal(northingInput);
      const z = parseInt(utmZone, 10);
      if (e === null || n === null || !z || z < 1 || z > 60) {
        setCoordError("Enter valid easting, northing and UTM zone (1-60).");
        return;
      }
      const { lat, lng } = utmToLatLng(e, n, z, utmHem);
      setPinnedPoint({
        lat,
        lng,
        label: `E ${e.toFixed(1)} N ${n.toFixed(1)} (${z}${utmHem})`,
      });
      setFlyTo({ lat, lng, zoom: 18 });
    }
  };

  const selected: Feature<Polygon> | null = useMemo(() => {
    if (!selectedId) return null;
    return (
      (parcels.features.find(
        (f) => f.properties?.parcel_number === selectedId,
      ) as Feature<Polygon> | undefined) ?? null
    );
  }, [parcels, selectedId]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return parcels.features
      .filter((f) =>
        String(f.properties?.parcel_number ?? "")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 20);
  }, [parcels, query]);

  const handleSelect = (parcelNumber: string) => {
    setSelectedId(parcelNumber);
    const f = parcels.features.find(
      (x) => x.properties?.parcel_number === parcelNumber,
    ) as Feature<Polygon> | undefined;
    if (f) {
      const ring = f.geometry.coordinates[0];
      let x = 0,
        y = 0;
      for (const [lng, lat] of ring) {
        x += lng;
        y += lat;
      }
      setFlyTo({ lat: y / ring.length, lng: x / ring.length, zoom: 17 });
    }
  };

  const startMeasure = (mode: MeasureMode) => {
    setMeasureMode(mode);
    setMeasurePoints([]);
  };

  const handleGps = () => {
    setGpsError(null);
    if (!("geolocation" in navigator)) {
      setGpsError("Geolocation not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const exportGeoJSON = () => {
    if (!selected) return;
    downloadBlob(
      `${selected.properties?.parcel_number ?? "parcel"}.geojson`,
      "application/geo+json",
      parcelToGeoJSON(selected),
    );
  };
  const exportKML = () => {
    if (!selected) return;
    downloadBlob(
      `${selected.properties?.parcel_number ?? "parcel"}.kml`,
      "application/vnd.google-earth.kml+xml",
      parcelToKML(selected),
    );
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Map */}
      <div className="absolute inset-0">
        {mounted ? (
          <Suspense fallback={<MapFallback />}>
            <MapView
              parcels={parcels}
              showParcels={showParcels}
              selectedId={selectedId}
              onSelect={handleSelect}
              flyTo={flyTo}
              measureMode={measureMode}
              measurePoints={measurePoints}
              onMeasurePoint={(pt) => setMeasurePoints((p) => [...p, pt])}
              onMeasureFinish={() => setMeasureMode((m) => m)}
              gpsPosition={gpsPosition}
              pinnedPoint={pinnedPoint}
            />
          </Suspense>
        ) : (
          <MapFallback />
        )}
      </div>

      {/* Top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-center justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-background/90 px-3 py-2 shadow-lg backdrop-blur">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <MapPin className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold tracking-tight">Siana RIM Web Map</h1>
        </div>
        {measureMode !== "none" && (
          <div className="pointer-events-auto rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-100 shadow-lg backdrop-blur">
            {measureMode === "distance"
              ? "Click to add points · double-click to finish"
              : "Click to add vertices · double-click to close polygon"}
            <Button
              size="sm"
              variant="ghost"
              className="ml-2 h-6 px-2 text-xs"
              onClick={() => {
                setMeasureMode("none");
                setMeasurePoints([]);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </header>

      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="absolute bottom-0 left-0 top-16 z-[1000] flex w-full max-w-sm flex-col gap-3 overflow-y-auto p-3 sm:top-16">
          <Panel title="Search" icon={<Search className="h-4 w-4" />}>
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. SIANA/001"
                className="h-9"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setQuery("")}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {query && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
                {results.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">No matches</div>
                ) : (
                  results.map((f) => {
                    const pn = String(f.properties?.parcel_number);
                    return (
                      <button
                        key={pn}
                        onClick={() => handleSelect(pn)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {pn}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </Panel>

          <Panel title="Tools" icon={<Ruler className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={measureMode === "distance" ? "default" : "secondary"}
                size="sm"
                onClick={() => startMeasure("distance")}
                className="justify-start"
              >
                <Ruler className="mr-2 h-4 w-4" /> Distance
              </Button>
              <Button
                variant={measureMode === "area" ? "default" : "secondary"}
                size="sm"
                onClick={() => startMeasure("area")}
                className="justify-start"
              >
                <Hexagon className="mr-2 h-4 w-4" /> Area
              </Button>
              <Button variant="secondary" size="sm" onClick={handleGps} className="justify-start">
                <Crosshair className="mr-2 h-4 w-4" /> My GPS
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowParcels((s) => !s)}
                className="justify-start"
              >
                <Layers className="mr-2 h-4 w-4" />
                {showParcels ? "Hide parcels" : "Show parcels"}
              </Button>
            </div>
            {(measurePoints.length > 0 || measureMode !== "none") && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  setMeasureMode("none");
                  setMeasurePoints([]);
                }}
              >
                Clear measurement
              </Button>
            )}
            {gpsError && (
              <p className="mt-2 text-xs text-destructive">{gpsError}</p>
            )}
          </Panel>

          <Panel title="Go to coordinates" icon={<Navigation className="h-4 w-4" />}>
            <div className="mb-2 flex gap-1 rounded-md border border-border p-1">
              <button
                onClick={() => setCoordMode("latlng")}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                  coordMode === "latlng"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                Lat / Lng
              </button>
              <button
                onClick={() => setCoordMode("utm")}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium transition ${
                  coordMode === "utm"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                UTM (N / E)
              </button>
            </div>

            {coordMode === "latlng" ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Latitude
                  </label>
                  <Input
                    value={latInput}
                    onChange={(e) => setLatInput(e.target.value)}
                    placeholder="-1.552000"
                    className="h-8"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Longitude
                  </label>
                  <Input
                    value={lngInput}
                    onChange={(e) => setLngInput(e.target.value)}
                    placeholder="35.305000"
                    className="h-8"
                    inputMode="decimal"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Easting (m)
                    </label>
                    <Input
                      value={eastingInput}
                      onChange={(e) => setEastingInput(e.target.value)}
                      placeholder="700000"
                      className="h-8"
                      inputMode="decimal"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Northing (m)
                    </label>
                    <Input
                      value={northingInput}
                      onChange={(e) => setNorthingInput(e.target.value)}
                      placeholder="9828000"
                      className="h-8"
                      inputMode="decimal"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Zone (1–60)
                    </label>
                    <Input
                      value={utmZone}
                      onChange={(e) => setUtmZone(e.target.value)}
                      placeholder="36"
                      className="h-8"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Hemisphere
                    </label>
                    <div className="flex gap-1 rounded-md border border-border p-1">
                      <button
                        onClick={() => setUtmHem("N")}
                        className={`flex-1 rounded px-2 py-0.5 text-xs ${
                          utmHem === "N"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        N
                      </button>
                      <button
                        onClick={() => setUtmHem("S")}
                        className={`flex-1 rounded px-2 py-0.5 text-xs ${
                          utmHem === "S"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        S
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" onClick={goToCoordinates}>
                <Navigation className="mr-2 h-4 w-4" /> Go to point
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPinnedPoint(null);
                  setCoordError(null);
                }}
                disabled={!pinnedPoint}
              >
                Clear pin
              </Button>
            </div>
            {coordError && (
              <p className="mt-2 text-xs text-destructive">{coordError}</p>
            )}
            {pinnedPoint && !coordError && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Pinned: {pinnedPoint.lat.toFixed(6)}, {pinnedPoint.lng.toFixed(6)}
              </p>
            )}
          </Panel>

          {selected ? (
            <Panel
              title={`Parcel ${selected.properties?.parcel_number}`}
              icon={<Info className="h-4 w-4" />}
              onClose={() => setSelectedId(null)}
            >
              <dl className="space-y-2 text-sm">
                <Row label="Parcel number" value={String(selected.properties?.parcel_number)} />
                <Row
                  label="Area"
                  value={formatArea(geojsonPolygonArea(selected.geometry))}
                />
                <Row
                  label="Perimeter"
                  value={formatDistance(geojsonPolygonPerimeter(selected.geometry))}
                />
                <Row
                  label="Source"
                  value={String(selected.properties?.source ?? "RIM Map")}
                />
              </dl>
              <Separator className="my-3" />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={exportGeoJSON}>
                  <Download className="mr-2 h-4 w-4" /> GeoJSON
                </Button>
                <Button variant="secondary" size="sm" onClick={exportKML}>
                  <Download className="mr-2 h-4 w-4" /> KML
                </Button>
              </div>
            </Panel>
          ) : (
            <Panel title="Parcel info" icon={<Info className="h-4 w-4" />}>
              <p className="text-xs text-muted-foreground">
                Click a parcel on the map or search by number to see its details and
                export options.
              </p>
            </Panel>
          )}

          <p className="px-1 text-[10px] leading-relaxed text-muted-foreground">
            Demo data — {parcels.features.length} sample parcels rendered over Esri
            World Imagery. Replace <code>src/data/parcels.geojson</code> with real
            digitized data when ready.
          </p>
        </aside>
      )}
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
  onClose,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </h2>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function MapFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30 text-sm text-muted-foreground">
      Loading map…
    </div>
  );
}
