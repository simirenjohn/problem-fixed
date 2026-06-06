// Local project persistence (localStorage). Maps cleanly to a future DB schema.

export type CoordPoint = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

export type Measurement = {
  id: string;
  type: "distance" | "area";
  points: Array<[number, number]>;
  label?: string;
};

import type { SevenParam } from "@/lib/coords";

export type DatumPreset = "epsg" | "controller" | "custom";

export type DatumParams = {
  preset: DatumPreset;
  values: SevenParam;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  points: CoordPoint[];
  measurements: Measurement[];
  notes?: string;
  /** Arc 1960 -> WGS84 datum-shift parameters (Bursa-Wolf, 7-param). */
  datumParams?: DatumParams;
};

const STORAGE_KEY = "siana-rim:projects:v1";
const ACTIVE_KEY = "siana-rim:active-project:v1";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function listProjects(): Project[] {
  return safeRead<Project[]>(STORAGE_KEY, []);
}

export function saveProjects(projects: Project[]) {
  safeWrite(STORAGE_KEY, projects);
}

export function getActiveProjectId(): string | null {
  return safeRead<string | null>(ACTIVE_KEY, null);
}

export function setActiveProjectId(id: string | null) {
  safeWrite(ACTIVE_KEY, id);
}

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: uid(),
    name: name.trim() || "Untitled project",
    createdAt: now,
    updatedAt: now,
    points: [],
    measurements: [],
  };
}

export function ensureDefaultProject(): { projects: Project[]; activeId: string } {
  let projects = listProjects();
  let activeId = getActiveProjectId();
  if (projects.length === 0) {
    const p = createProject("My first project");
    projects = [p];
    saveProjects(projects);
    activeId = p.id;
    setActiveProjectId(activeId);
  }
  if (!activeId || !projects.find((p) => p.id === activeId)) {
    activeId = projects[0].id;
    setActiveProjectId(activeId);
  }
  return { projects, activeId };
}

export function exportProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export function parseImportedProject(json: string): Project {
  const obj = JSON.parse(json) as Project;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.points)) {
    throw new Error("Invalid project file");
  }
  return {
    ...obj,
    id: uid(),
    name: obj.name || "Imported project",
    createdAt: obj.createdAt || Date.now(),
    updatedAt: Date.now(),
    points: obj.points || [],
    measurements: obj.measurements || [],
  };
}

export function newPointId() {
  return uid();
}
export function newMeasurementId() {
  return uid();
}