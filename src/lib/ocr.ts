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
    const { data } = await Tesseract.recognize(url, "eng", {
      // Bias OCR towards digits + the few letters used as point labels.
      // Helps a lot with handwritten survey sheets.
      // @ts-expect-error tesseract.js typing
      tessedit_char_whitelist:
        "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ=., \n",
    });
    return data.text;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Match decimal lat/lng pairs like "-1.5520, 35.3050" (with various separators).
const LATLNG_RE =
  /(-?\d{1,2}\.\d{3,8})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,8})/g;

// Generic UTM pair: 6 or 7 digit numbers, either order. We disambiguate
// per-match by magnitude (northings in Kenya are ~9.7–9.9M, eastings 100k–900k,
// sometimes written with a leading 0 on a survey sheet, e.g. "0813130").
const UTM_RE =
  /(\d{6,7}(?:\.\d+)?)\s*[,;\sEeNn:/-]{0,3}\s*(\d{6,7}(?:\.\d+)?)/g;

// "label = Northing Easting" form, e.g. "a = 9876571 0813130".
const LABELED_RE =
  /([A-Za-z]{1,3}|\d{1,3})\s*[=:\-]\s*(\d{6,7}(?:\.\d+)?)\s*[,;\s]+\s*(\d{6,7}(?:\.\d+)?)/g;

// Decide which number is easting vs northing. Returns null if neither plausible.
function classifyUtmPair(
  a: number,
  b: number,
): { easting: number; northing: number } | null {
  const plausibleE = (v: number) => v >= 100_000 && v <= 999_999;
  // KE northings (S hemisphere UTM) are ~9.5M–10M; N hemisphere ~0–10M.
  const plausibleN = (v: number) => v >= 1_000_000 && v <= 10_000_000;

  // Strip a single leading zero possibility by treating 7-digit values that
  // start with 0 in source text as 6-digit eastings — but here we only see
  // numeric values, so just rely on magnitude.
  if (plausibleN(a) && plausibleE(b)) return { northing: a, easting: b };
  if (plausibleN(b) && plausibleE(a)) return { northing: b, easting: a };
  return null;
}

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
  // First try labelled rows ("a = 9876571 0813130") — captures the corner name.
  LABELED_RE.lastIndex = 0;
  while ((m = LABELED_RE.exec(text)) !== null) {
    const label = m[1].trim();
    const pair = classifyUtmPair(Number(m[2]), Number(m[3]));
    if (!pair) continue;
    const key = `UTM:${pair.easting.toFixed(0)}:${pair.northing.toFixed(0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const ll = utmToLatLng(
        pair.easting,
        pair.northing,
        opts.defaultZone,
        opts.defaultHemisphere,
        opts.datum,
      );
      if (Math.abs(ll.lat) > 90 || Math.abs(ll.lng) > 180) continue;
      raw.push(`${label}: E${pair.easting} N${pair.northing}`);
      points.push({
        id: newPointId(),
        label,
        lat: ll.lat,
        lng: ll.lng,
      });
    } catch {
      // ignore
    }
  }

  // Then unlabelled UTM pairs anywhere else in the text.
  UTM_RE.lastIndex = 0;
  while ((m = UTM_RE.exec(text)) !== null) {
    const pair = classifyUtmPair(Number(m[1]), Number(m[2]));
    if (!pair) continue;
    const key = `UTM:${pair.easting.toFixed(0)}:${pair.northing.toFixed(0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const ll = utmToLatLng(
        pair.easting,
        pair.northing,
        opts.defaultZone,
        opts.defaultHemisphere,
        opts.datum,
      );
      if (Math.abs(ll.lat) > 90 || Math.abs(ll.lng) > 180) continue;
      raw.push(
        `E${pair.easting} N${pair.northing} (Z${opts.defaultZone}${opts.defaultHemisphere})`,
      );
      points.push({
        id: newPointId(),
        label: `P${points.length + 1}`,
        lat: ll.lat,
        lng: ll.lng,
      });
    } catch {
      // ignore bad conversions
    }
  }

  return { points, raw };
}