import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  Info,
  Navigation,
  Plus,
  Trash2,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Save,
  Upload,
  Spline,
  Shapes,
  Maximize2,
  Undo2,
  FileUp,
  Image as ImageIcon,
  Loader2,
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
  lineDistanceMeters,
  polygonAreaSqMeters,
} from "@/lib/measure";
import {
  downloadBlob,
  parcelToGeoJSON,
  parcelToKML,
} from "@/lib/parcel-export";
import { parseDecimal, toWgs84, utmToLatLng, type Datum } from "@/lib/coords";
import { importGisFile } from "@/lib/import-gis";
import { extractCoordPointsFromText, runOcr } from "@/lib/ocr";
import {
  type Project,
  type CoordPoint,
  createProject,
  ensureDefaultProject,
  exportProject,
  newMeasurementId,
  newPointId,
  parseImportedProject,
  saveProjects,
  setActiveProjectId,
} from "@/lib/projects";

const MapView = lazy(() => import("@/components/map/MapView"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Siana RIM Web Map — Parcel Viewer" },
      {
        name: "description",
        content:
          "Browse digitized Siana RIM land parcels on satellite imagery. Manage projects, plot coordinates, measure, and export.",
      },
    ],
  }),
  component: Index,
});

type MeasureMode = "none" | "distance" | "area";
type CoordMode = "latlng" | "utm";
type SectionId =
  | "projects"
  | "search"
  | "layers"
  | "coords"
  | "import"
  | "measure"
  | "info";

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const parcels = useMemo<FeatureCollection<Polygon>>(
    () => JSON.parse(parcelsData) as FeatureCollection<Polygon>,
    [],
  );

  // --- Projects ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const gisInputRef = useRef<HTMLInputElement | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    const { projects: ps, activeId: a } = ensureDefaultProject();
    setProjects(ps);
    setActiveId(a);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeId) ?? null,
    [projects, activeId],
  );

  const updateActive = (mut: (p: Project) => Project) => {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === activeId ? { ...mut(p), updatedAt: Date.now() } : p,
      );
      saveProjects(next);
      return next;
    });
  };

  const switchProject = (id: string) => {
    setActiveId(id);
    setActiveProjectId(id);
  };

  const handleNewProject = () => {
    const name = window.prompt("Project name?", `Project ${projects.length + 1}`);
    if (name === null) return;
    const p = createProject(name);
    const next = [...projects, p];
    setProjects(next);
    saveProjects(next);
    switchProject(p.id);
  };

  const handleRenameProject = () => {
    if (!activeProject) return;
    const name = window.prompt("Rename project", activeProject.name);
    if (!name) return;
    updateActive((p) => ({ ...p, name }));
  };

  const handleDeleteProject = () => {
    if (!activeProject) return;
    if (!window.confirm(`Delete project "${activeProject.name}"?`)) return;
    const next = projects.filter((p) => p.id !== activeProject.id);
    const fallback = next[0] ?? createProject("My first project");
    const finalList = next.length ? next : [fallback];
    setProjects(finalList);
    saveProjects(finalList);
    switchProject(fallback.id);
  };

  const handleExportProject = () => {
    if (!activeProject) return;
    downloadBlob(
      `${activeProject.name.replace(/\s+/g, "_")}.json`,
      "application/json",
      exportProject(activeProject),
    );
  };

  const handleImportProject = async (file: File) => {
    const text = await file.text();
    try {
      const p = parseImportedProject(text);
      const next = [...projects, p];
      setProjects(next);
      saveProjects(next);
      switchProject(p.id);
    } catch (e) {
      alert("Could not import project: " + (e as Error).message);
    }
  };

  // --- Map state ---
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    projects: true,
    search: false,
    layers: false,
    coords: true,
    import: false,
    measure: false,
    info: true,
  });
  const toggleSection = (id: SectionId) =>
    setOpenSections((s) => ({ ...s, [id]: !s[id] }));

  const [showParcels, setShowParcels] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(
    null,
  );
  const [fitBounds, setFitBounds] = useState<Array<[number, number]> | null>(null);

  // --- Measure (active in-progress) ---
  const [measureMode, setMeasureMode] = useState<MeasureMode>("none");
  const [measurePoints, setMeasurePoints] = useState<Array<[number, number]>>([]);

  const finishMeasure = () => {
    if (measureMode === "none") return;
    const min = measureMode === "distance" ? 2 : 3;
    if (measurePoints.length >= min && activeProject) {
      updateActive((p) => ({
        ...p,
        measurements: [
          ...p.measurements,
          {
            id: newMeasurementId(),
            type: measureMode,
            points: measurePoints,
          },
        ],
      }));
    }
    setMeasureMode("none");
    setMeasurePoints([]);
  };

  const cancelMeasure = () => {
    setMeasureMode("none");
    setMeasurePoints([]);
  };

  // Keyboard: Enter finish, Esc cancel, Backspace undo
  useEffect(() => {
    if (measureMode === "none") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") finishMeasure();
      else if (e.key === "Escape") cancelMeasure();
      else if (e.key === "Backspace") setMeasurePoints((pts) => pts.slice(0, -1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureMode, measurePoints]);

  // --- GPS ---
  const [gpsPosition, setGpsPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const handleGps = () => {
    setGpsError(null);
    if (!("geolocation" in navigator)) {
      setGpsError("Geolocation not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGpsPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => setGpsError(err.message),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // --- Multi-point coordinate entry ---
  const [coordMode, setCoordMode] = useState<CoordMode>("latlng");
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [eastingInput, setEastingInput] = useState("");
  const [northingInput, setNorthingInput] = useState("");
  const [utmZone, setUtmZone] = useState("36");
  const [utmHem, setUtmHem] = useState<"N" | "S">("S");
  const [datum, setDatum] = useState<Datum>("WGS84");
  const [labelInput, setLabelInput] = useState("");
  const [coordError, setCoordError] = useState<string | null>(null);
  const [coordShape, setCoordShape] = useState<"none" | "line" | "polygon">("none");

  const addCoordPoint = () => {
    setCoordError(null);
    let lat: number | null = null;
    let lng: number | null = null;
    let autoLabel = "";
    if (coordMode === "latlng") {
      lat = parseDecimal(latInput);
      lng = parseDecimal(lngInput);
      if (lat === null || lng === null) {
        setCoordError("Enter valid decimal latitude and longitude.");
        return;
      }
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setCoordError("Lat must be -90..90, Lng -180..180.");
        return;
      }
      if (datum !== "WGS84") {
        const w = toWgs84(lat, lng, datum);
        lat = w.lat;
        lng = w.lng;
      }
      autoLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } else {
      const e = parseDecimal(eastingInput);
      const n = parseDecimal(northingInput);
      const z = parseInt(utmZone, 10);
      if (e === null || n === null || !z || z < 1 || z > 60) {
        setCoordError("Enter valid easting, northing and UTM zone (1-60).");
        return;
      }
      // Sanity check: typical UTM easting is 100,000-900,000.
      if (e < 100000 || e > 900000) {
        setCoordError(
          "Easting looks out of range (expect ~160,000–840,000 m). Check the value.",
        );
        return;
      }
      const r = utmToLatLng(e, n, z, utmHem, datum);
      lat = r.lat;
      lng = r.lng;
      autoLabel = `E${e.toFixed(0)} N${n.toFixed(0)} ${z}${utmHem} (${datum})`;
    }
    const label =
      labelInput.trim() ||
      `P${(activeProject?.points.length ?? 0) + 1} · ${autoLabel}`;
    const pt: CoordPoint = { id: newPointId(), label, lat, lng };
    updateActive((p) => ({ ...p, points: [...p.points, pt] }));
    setFlyTo({ lat, lng, zoom: 18 });
    setLatInput("");
    setLngInput("");
    setEastingInput("");
    setNorthingInput("");
    setLabelInput("");
  };

  // --- GIS file import ---
  const handleGisFile = async (file: File) => {
    if (!activeProject) return;
    setImportBusy(true);
    setImportStatus(`Reading ${file.name}…`);
    try {
      const res = await importGisFile(file);
      updateActive((p) => ({
        ...p,
        points: [...p.points, ...res.points],
        measurements: [...p.measurements, ...res.measurements],
      }));
      const all = [
        ...res.points.map((p) => [p.lat, p.lng] as [number, number]),
        ...res.measurements.flatMap((m) => m.points),
      ];
      if (all.length > 0) {
        setFitBounds(all);
        setTimeout(() => setFitBounds(null), 100);
      }
      setImportStatus(
        `Imported ${res.points.length} point(s) and ${res.measurements.length} shape(s).` +
          (res.warnings.length ? " " + res.warnings.join(" ") : ""),
      );
    } catch (e) {
      setImportStatus("Import failed: " + (e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  // --- Image OCR import ---
  const handleOcrFile = async (file: File) => {
    if (!activeProject) return;
    setImportBusy(true);
    setImportStatus(`Running OCR on ${file.name}…`);
    try {
      const text = await runOcr(file);
      const { points: pts, raw } = extractCoordPointsFromText(text, {
        defaultZone: parseInt(utmZone, 10) || 36,
        defaultHemisphere: utmHem,
        datum,
      });
      if (pts.length === 0) {
        setImportStatus(
          "OCR found no coordinate-like numbers. Try a clearer image, or copy the text and paste manually.",
        );
        return;
      }
      updateActive((p) => ({ ...p, points: [...p.points, ...pts] }));
      setFitBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
      setTimeout(() => setFitBounds(null), 100);
      setImportStatus(
        `OCR detected ${pts.length} coordinate(s): ${raw.slice(0, 3).join(" · ")}${
          raw.length > 3 ? "…" : ""
        }`,
      );
    } catch (e) {
      setImportStatus("OCR failed: " + (e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const removePoint = (id: string) => {
    updateActive((p) => ({ ...p, points: p.points.filter((x) => x.id !== id) }));
  };

  const clearAllPoints = () => {
    if (!activeProject) return;
    if (!window.confirm("Clear all points in this project?")) return;
    updateActive((p) => ({ ...p, points: [] }));
    setCoordShape("none");
  };

  const flyToAllPoints = () => {
    const pts = activeProject?.points ?? [];
    if (pts.length === 0) return;
    setFitBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
    // clear after a tick so the same bounds can be requested again later
    setTimeout(() => setFitBounds(null), 100);
  };

  const lineDist =
    activeProject && activeProject.points.length >= 2
      ? lineDistanceMeters(activeProject.points.map((p) => [p.lat, p.lng]))
      : 0;
  const polyArea =
    activeProject && activeProject.points.length >= 3
      ? polygonAreaSqMeters(activeProject.points.map((p) => [p.lat, p.lng]))
      : 0;

  // --- Parcel selection ---
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
        String(f.properties?.parcel_number ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [parcels, query]);

  const handleSelect = (parcelNumber: string) => {
    setSelectedId(parcelNumber);
    setOpenSections((s) => ({ ...s, info: true }));
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

  const startMeasure = (mode: MeasureMode) => {
    setMeasureMode(mode);
    setMeasurePoints([]);
    setOpenSections((s) => ({ ...s, measure: true }));
  };

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`relative z-[1100] flex h-full shrink-0 flex-col border-r border-border bg-background/95 backdrop-blur transition-[width] duration-200 ${
          sidebarOpen ? "w-[340px]" : "w-12"
        }`}
      >
        {/* Sidebar header */}
        <div className="flex h-12 items-center justify-between border-b border-border px-2">
          {sidebarOpen ? (
            <div className="flex items-center gap-2 pl-1">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold tracking-tight">Siana RIM</span>
            </div>
          ) : (
            <MapPin className="mx-auto h-4 w-4 text-primary" />
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {sidebarOpen ? (
          <div className="flex-1 space-y-2 overflow-y-auto p-2">
            {/* Projects */}
            <Section
              id="projects"
              icon={<FolderOpen className="h-4 w-4" />}
              title="Project"
              open={openSections.projects}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                <select
                  value={activeId}
                  onChange={(e) => switchProject(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={handleNewProject}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> New
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleRenameProject}>
                    Rename
                  </Button>
                  <Button size="sm" variant="secondary" onClick={handleExportProject}>
                    <Save className="mr-1 h-3.5 w-3.5" /> Export
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => importInputRef.current?.click()}
                  >
                    <Upload className="mr-1 h-3.5 w-3.5" /> Import
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="col-span-2 text-destructive hover:text-destructive"
                    onClick={handleDeleteProject}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete project
                  </Button>
                </div>
                <input
                  ref={importInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportProject(f);
                    e.target.value = "";
                  }}
                />
                {activeProject && (
                  <p className="text-[10px] text-muted-foreground">
                    {activeProject.points.length} points ·{" "}
                    {activeProject.measurements.length} measurements · saved{" "}
                    {new Date(activeProject.updatedAt).toLocaleTimeString()}
                  </p>
                )}
              </div>
            </Section>

            {/* Search */}
            <Section
              id="search"
              icon={<Search className="h-4 w-4" />}
              title="Search parcels"
              open={openSections.search}
              onToggle={toggleSection}
            >
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
            </Section>

            {/* Layers */}
            <Section
              id="layers"
              icon={<Layers className="h-4 w-4" />}
              title="Layers"
              open={openSections.layers}
              onToggle={toggleSection}
            >
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                onClick={() => setShowParcels((s) => !s)}
              >
                <Layers className="mr-2 h-4 w-4" />
                {showParcels ? "Hide parcels" : "Show parcels"}
              </Button>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Use the layers control on the top-right of the map to switch
                between Google Satellite Hybrid, Google Satellite, Esri imagery,
                and OpenStreetMap.
              </p>
            </Section>

            {/* Coordinates */}
            <Section
              id="coords"
              icon={<Navigation className="h-4 w-4" />}
              title="Coordinates"
              open={openSections.coords}
              onToggle={toggleSection}
            >
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
                  <LabeledInput
                    label="Latitude"
                    value={latInput}
                    onChange={setLatInput}
                    placeholder="-1.552000"
                  />
                  <LabeledInput
                    label="Longitude"
                    value={lngInput}
                    onChange={setLngInput}
                    placeholder="35.305000"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <LabeledInput
                      label="Easting (m)"
                      value={eastingInput}
                      onChange={setEastingInput}
                      placeholder="700000"
                    />
                    <LabeledInput
                      label="Northing (m)"
                      value={northingInput}
                      onChange={setNorthingInput}
                      placeholder="9828000"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Zone (Narok: 36)
                      </label>
                      <div className="flex gap-1">
                        <Input
                          value={utmZone}
                          onChange={(e) => setUtmZone(e.target.value)}
                          className="h-8 w-14"
                          inputMode="numeric"
                        />
                        {(["36", "37"] as const).map((z) => (
                          <button
                            key={z}
                            onClick={() => setUtmZone(z)}
                            className={`flex-1 rounded border text-xs ${
                              utmZone === z
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            {z}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Hemisphere
                      </label>
                      <div className="flex gap-1 rounded-md border border-border p-1">
                        {(["N", "S"] as const).map((h) => (
                          <button
                            key={h}
                            onClick={() => setUtmHem(h)}
                            className={`flex-1 rounded px-2 py-0.5 text-xs ${
                              utmHem === h
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-2">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Datum
                </label>
                <div className="flex gap-1 rounded-md border border-border p-1">
                  {(
                    [
                      { id: "WGS84" as const, label: "WGS 84" },
                      { id: "ARC1960" as const, label: "Arc 1960 (KE)" },
                    ]
                  ).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDatum(d.id)}
                      className={`flex-1 rounded px-2 py-1 text-xs ${
                        datum === d.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Use <strong>Arc 1960</strong> for Kenyan cadastral / RIM
                  coordinates. Points are auto-shifted to WGS 84 for the
                  satellite basemap (~150 m correction).
                </p>
              </div>

              <div className="mt-2">
                <LabeledInput
                  label="Label (optional)"
                  value={labelInput}
                  onChange={setLabelInput}
                  placeholder="Corner A"
                />
              </div>

              <Button size="sm" className="mt-2 w-full" onClick={addCoordPoint}>
                <Plus className="mr-2 h-4 w-4" /> Add point
              </Button>
              {coordError && (
                <p className="mt-2 text-xs text-destructive">{coordError}</p>
              )}

              {/* Points list */}
              {activeProject && activeProject.points.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Points ({activeProject.points.length})
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={clearAllPoints}
                    >
                      Clear
                    </Button>
                  </div>
                  <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {activeProject.points.map((p, i) => (
                      <li
                        key={p.id}
                        className="group flex items-center gap-1.5 rounded border border-border bg-card/50 px-2 py-1 text-xs"
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <button
                          className="min-w-0 flex-1 truncate text-left hover:text-primary"
                          onClick={() =>
                            setFlyTo({ lat: p.lat, lng: p.lng, zoom: 18 })
                          }
                          title={`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`}
                        >
                          {p.label}
                        </button>
                        <button
                          className="opacity-0 transition group-hover:opacity-100"
                          onClick={() => removePoint(p.id)}
                          aria-label="Remove"
                        >
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <Button
                      size="sm"
                      variant={coordShape === "line" ? "default" : "secondary"}
                      onClick={() =>
                        setCoordShape((s) => (s === "line" ? "none" : "line"))
                      }
                      disabled={activeProject.points.length < 2}
                    >
                      <Spline className="mr-1 h-3.5 w-3.5" /> Line
                    </Button>
                    <Button
                      size="sm"
                      variant={coordShape === "polygon" ? "default" : "secondary"}
                      onClick={() =>
                        setCoordShape((s) => (s === "polygon" ? "none" : "polygon"))
                      }
                      disabled={activeProject.points.length < 3}
                    >
                      <Shapes className="mr-1 h-3.5 w-3.5" /> Polygon
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="col-span-2"
                      onClick={flyToAllPoints}
                    >
                      <Maximize2 className="mr-1 h-3.5 w-3.5" /> Fit all points
                    </Button>
                  </div>
                  {coordShape === "line" && lineDist > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Total length: {formatDistance(lineDist)}
                    </p>
                  )}
                  {coordShape === "polygon" && polyArea > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Area: {formatArea(polyArea)}
                    </p>
                  )}
                </>
              )}
            </Section>

            {/* Import */}
            <Section
              id="import"
              icon={<FileUp className="h-4 w-4" />}
              title="Import data"
              open={openSections.import}
              onToggle={toggleSection}
            >
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => gisInputRef.current?.click()}
                  disabled={importBusy}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  GIS file (KML, KMZ, GPX, GeoJSON, SHP zip, CSV)
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => ocrInputRef.current?.click()}
                  disabled={importBusy}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Image (OCR → coordinates)
                </Button>
                <input
                  ref={gisInputRef}
                  type="file"
                  accept=".kml,.kmz,.gpx,.geojson,.json,.csv,.tsv,.txt,.zip,.shp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleGisFile(f);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={ocrInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleOcrFile(f);
                    e.target.value = "";
                  }}
                />
                {importBusy && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Working…
                  </div>
                )}
                {importStatus && (
                  <p className="text-[11px] text-muted-foreground">{importStatus}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  <strong>DWG</strong> files cannot be parsed in the browser
                  (proprietary AutoCAD format). Export from AutoCAD or QGIS as
                  <em> DXF, SHP, KML or GeoJSON</em> and import that.
                  Imported coordinates use the datum currently selected in
                  Coordinates above.
                </p>
              </div>
            </Section>

            {/* Measure */}
            <Section
              id="measure"
              icon={<Ruler className="h-4 w-4" />}
              title="Measure"
              open={openSections.measure}
              onToggle={toggleSection}
            >
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={measureMode === "distance" ? "default" : "secondary"}
                  size="sm"
                  onClick={() => startMeasure("distance")}
                >
                  <Ruler className="mr-2 h-4 w-4" /> Distance
                </Button>
                <Button
                  variant={measureMode === "area" ? "default" : "secondary"}
                  size="sm"
                  onClick={() => startMeasure("area")}
                >
                  <Hexagon className="mr-2 h-4 w-4" /> Area
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleGps}
                  className="col-span-2"
                >
                  <Crosshair className="mr-2 h-4 w-4" /> My GPS
                </Button>
              </div>
              {measureMode !== "none" && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Click to add vertices · move mouse to preview · Enter or
                    double-click to finish · Backspace to undo · Esc to cancel.
                  </p>
                  <div className="grid grid-cols-3 gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setMeasurePoints((p) => p.slice(0, -1))}
                      disabled={measurePoints.length === 0}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
                    </Button>
                    <Button size="sm" onClick={finishMeasure}>
                      Done
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelMeasure}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {activeProject && activeProject.measurements.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Saved ({activeProject.measurements.length})
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() =>
                        updateActive((p) => ({ ...p, measurements: [] }))
                      }
                    >
                      Clear
                    </Button>
                  </div>
                  <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
                    {activeProject.measurements.map((m, i) => {
                      const val =
                        m.type === "distance"
                          ? formatDistance(lineDistanceMeters(m.points))
                          : formatArea(polygonAreaSqMeters(m.points));
                      return (
                        <li
                          key={m.id}
                          className="group flex items-center gap-1.5 rounded border border-border bg-card/50 px-2 py-1 text-xs"
                        >
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="flex-1 truncate">
                            {m.type === "distance" ? "↔" : "▢"} {val}
                          </span>
                          <button
                            className="opacity-0 transition group-hover:opacity-100"
                            onClick={() =>
                              updateActive((p) => ({
                                ...p,
                                measurements: p.measurements.filter(
                                  (x) => x.id !== m.id,
                                ),
                              }))
                            }
                          >
                            <X className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              {gpsError && (
                <p className="mt-2 text-xs text-destructive">{gpsError}</p>
              )}
            </Section>

            {/* Parcel info */}
            <Section
              id="info"
              icon={<Info className="h-4 w-4" />}
              title="Parcel info"
              open={openSections.info}
              onToggle={toggleSection}
            >
              {selected ? (
                <>
                  <dl className="space-y-2 text-sm">
                    <Row
                      label="Parcel"
                      value={String(selected.properties?.parcel_number)}
                    />
                    <Row
                      label="Area"
                      value={formatArea(geojsonPolygonArea(selected.geometry))}
                    />
                    <Row
                      label="Perimeter"
                      value={formatDistance(
                        geojsonPolygonPerimeter(selected.geometry),
                      )}
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
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Click a parcel on the map or search by number to see its details.
                </p>
              )}
            </Section>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center gap-1 py-2">
            {(
              [
                { id: "projects" as const, icon: FolderOpen },
                { id: "search" as const, icon: Search },
                { id: "layers" as const, icon: Layers },
                { id: "coords" as const, icon: Navigation },
                { id: "measure" as const, icon: Ruler },
                { id: "info" as const, icon: Info },
              ]
            ).map(({ id, icon: Icon }) => (
              <Button
                key={id}
                size="icon"
                variant="ghost"
                className="h-9 w-9"
                onClick={() => {
                  setSidebarOpen(true);
                  setOpenSections((s) => ({ ...s, [id]: true }));
                }}
                title={id}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
        )}
      </aside>

      {/* Map */}
      <div className="relative flex-1">
        {mounted ? (
          <Suspense fallback={<MapFallback />}>
            <MapView
              parcels={parcels}
              showParcels={showParcels}
              selectedId={selectedId}
              onSelect={handleSelect}
              flyTo={flyTo}
              fitBounds={fitBounds}
              measureMode={measureMode}
              measurePoints={measurePoints}
              onMeasurePoint={(pt) => setMeasurePoints((p) => [...p, pt])}
              onMeasureFinish={finishMeasure}
              gpsPosition={gpsPosition}
              pinnedPoint={null}
              coordPoints={activeProject?.points ?? []}
              coordShape={coordShape}
              savedMeasurements={activeProject?.measurements ?? []}
            />
          </Suspense>
        ) : (
          <MapFallback />
        )}

        {measureMode !== "none" && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-lg border border-orange-500/40 bg-orange-500/15 px-3 py-1.5 text-xs text-orange-100 shadow-lg backdrop-blur">
            {measureMode === "distance" ? "Measure distance" : "Measure area"} —{" "}
            {measurePoints.length} point{measurePoints.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card/40">
      <button
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent/40"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {icon}
          {title}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        />
      </button>
      {open && <div className="border-t border-border p-3">{children}</div>}
    </section>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8"
        inputMode="decimal"
      />
    </div>
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