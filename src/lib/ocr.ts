// Run Tesseract OCR on an image and extract coordinate candidates.
import Tesseract from "tesseract.js";
import { utmToLatLng, type Datum } from "@/lib/coords";
import type { CoordPoint } from "@/lib/projects";
import { newPointId } from "@/lib/projects";

export type OcrOptions = {
  // Hint for UTM-only text (no zone in image): defaults to Narok.
  defaultZone: number;
  defaultHemisphere: "N" | "S";
  datum: Datum;
};

export async function runOcr(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const { data } = await Tesseract.recognize(url, "eng");
    return data.text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Match decimal lat/lng pairs like "-1.5520, 35.3050" (with various separators).
const LATLNG_RE =
  /(-?\d{1,2}\.\d{3,8})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,8})/g;

// Match UTM-style 6 or 7 digit easting/northing pairs.
// Easting 6 digits, Northing 7 digits (typical for KE).
const UTM_RE = /(\d{6}(?:\.\d+)?)\s*[,;\sEe]?\s*(\d{7}(?:\.\d+)?)/g;

export function extractCoordPointsFromText(
  text: string,
  opts: OcrOptions,
): { points: CoordPoint[]; raw: string[] } {
  const points: CoordPoint[] = [];
  const raw: string[] = [];

  const seen = new Set<string>();

  // Try lat/lng first
  let m: RegExpExecArray | null;
  LATLNG_RE.lastIndex = 0;
  while ((m = LATLNG_RE.exec(text)) !== null) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const key = `LL:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    raw.push(`${lat}, ${lng}`);
    points.push({
      id: newPointId(),
      label: `OCR ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  }

  // Then UTM pairs
  UTM_RE.lastIndex = 0;
  while ((m = UTM_RE.exec(text)) !== null) {
    const e = Number(m[1]);
    const n = Number(m[2]);
    const key = `UTM:${e.toFixed(0)}:${n.toFixed(0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const ll = utmToLatLng(e, n, opts.defaultZone, opts.defaultHemisphere, opts.datum);
      if (Math.abs(ll.lat) > 90 || Math.abs(ll.lng) > 180) continue;
      raw.push(`E${e} N${n} (Z${opts.defaultZone}${opts.defaultHemisphere})`);
      points.push({
        id: newPointId(),
        label: `OCR E${e.toFixed(0)} N${n.toFixed(0)}`,
        lat: ll.lat,
        lng: ll.lng,
      });
    } catch {
      // ignore bad conversions
    }
  }

  return { points, raw };
}