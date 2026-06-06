// Coordinate helpers: parse lat/lng and convert UTM <-> lat/lng (WGS84).

export function parseDecimal(value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type Datum = "WGS84" | "ARC1960";

/** Bursa–Wolf 7-parameter datum shift (Arc 1960 -> WGS84 by convention). */
export type SevenParam = {
  /** translation, meters */
  dx: number;
  dy: number;
  dz: number;
  /** rotations, arc-seconds */
  rx: number;
  ry: number;
  rz: number;
  /** scale, parts-per-million */
  k: number;
};

/** EPSG / Molodensky 3-parameter values for Arc 1960 -> WGS84 (Kenya). */
export const ARC1960_TO_WGS84_EPSG: SevenParam = {
  dx: -157,
  dy: -2,
  dz: -299,
  rx: 0,
  ry: 0,
  rz: 0,
  k: 0,
};

/**
 * Some RTK controllers (e.g. the Kolida "Seven parameters" screen) input the
 * transform in the WGS84 -> Arc 1960 direction with values +163, +6, +298.
 * Stored here as the Arc 1960 -> WGS84 inverse so the math direction stays
 * consistent with the EPSG preset.
 */
export const ARC1960_TO_WGS84_CONTROLLER: SevenParam = {
  dx: -163,
  dy: -6,
  dz: -298,
  rx: 0,
  ry: 0,
  rz: 0,
  k: 1,
};

// Ellipsoid parameters
const ELLIPSOIDS = {
  WGS84: { a: 6378137.0, f: 1 / 298.257223563 },
  // Clarke 1880 (RGS) — used by Arc 1960 (Kenya/Tanzania/Uganda)
  ARC1960: { a: 6378249.145, f: 1 / 293.465 },
};

function geodeticToEcef(lat: number, lng: number, h: number, a: number, f: number) {
  const e2 = f * (2 - f);
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const x = (N + h) * Math.cos(phi) * Math.cos(lam);
  const y = (N + h) * Math.cos(phi) * Math.sin(lam);
  const z = (N * (1 - e2) + h) * Math.sin(phi);
  return { x, y, z };
}

function ecefToGeodetic(x: number, y: number, z: number, a: number, f: number) {
  const e2 = f * (2 - f);
  const b = a * (1 - f);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.sqrt(x * x + y * y);
  const th = Math.atan2(z * a, p * b);
  const lng = Math.atan2(y, x);
  const lat = Math.atan2(
    z + ep2 * b * Math.sin(th) ** 3,
    p - e2 * a * Math.cos(th) ** 3,
  );
  return { lat: (lat * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}

/** Bursa–Wolf forward transform: Pt = T + (1+k*1e-6) * R * Ps */
function applyBursaWolf(
  x: number,
  y: number,
  z: number,
  p: SevenParam,
): { x: number; y: number; z: number } {
  const asec = Math.PI / (180 * 3600);
  const rx = p.rx * asec;
  const ry = p.ry * asec;
  const rz = p.rz * asec;
  const s = 1 + p.k * 1e-6;
  // Small-angle rotation matrix
  const xr = x - rz * y + ry * z;
  const yr = rz * x + y - rx * z;
  const zr = -ry * x + rx * y + z;
  return { x: s * xr + p.dx, y: s * yr + p.dy, z: s * zr + p.dz };
}

// Convert a lat/lng in the given datum to WGS84 lat/lng.
export function toWgs84(
  lat: number,
  lng: number,
  datum: Datum,
  params: SevenParam = ARC1960_TO_WGS84_EPSG,
): { lat: number; lng: number } {
  if (datum === "WGS84") return { lat, lng };
  const src = ELLIPSOIDS.ARC1960;
  const dst = ELLIPSOIDS.WGS84;
  const p = geodeticToEcef(lat, lng, 0, src.a, src.f);
  const t = applyBursaWolf(p.x, p.y, p.z, params);
  return ecefToGeodetic(t.x, t.y, t.z, dst.a, dst.f);
}

// WGS84 UTM -> lat/lng. zone 1-60, hemisphere 'N' or 'S'.
export function utmToLatLng(
  easting: number,
  northing: number,
  zone: number,
  hemisphere: "N" | "S",
  datum: Datum = "WGS84",
  params: SevenParam = ARC1960_TO_WGS84_EPSG,
): { lat: number; lng: number } {
  const ell = ELLIPSOIDS[datum];
  const a = ell.a;
  const f = ell.f;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const x = easting - 500000.0;
  const y = hemisphere === "S" ? northing - 10000000.0 : northing;

  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) /
          720);

  const lngRad =
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
    cosPhi1;

  const lngOrigin = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lng = lngOrigin + lngRad;

  const result = { lat: lat * (180 / Math.PI), lng: lng * (180 / Math.PI) };
  // If non-WGS84 input, shift to WGS84 for display on web maps.
  return datum === "WGS84"
    ? result
    : toWgs84(result.lat, result.lng, datum, params);
}

export function latLngToUtm(
  lat: number,
  lng: number,
): { easting: number; northing: number; zone: number; hemisphere: "N" | "S" } {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);

  const zone = Math.floor((lng + 180) / 6) + 1;
  const lngOrigin = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const phi = lat * (Math.PI / 180);
  const lam = lng * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lngOrigin);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    k0 *
      N *
      (A +
        ((1 - T + C) * A ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000.0;

  let northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));

  const hemisphere: "N" | "S" = lat < 0 ? "S" : "N";
  if (hemisphere === "S") northing += 10000000.0;

  return { easting, northing, zone, hemisphere };
}