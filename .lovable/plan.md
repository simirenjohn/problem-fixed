## Goal
Hard-wire the app to the ARC 1960 / Clarke 1880 / UTM Zone 36S projection shown on your RTK controller, and let you override the datum-shift values with the exact 7-parameter set the controller uses, so on-map points match RTK results.

## What changes

### 1. Lock the projection profile (Narok default)
- Source/Target ellipsoid: **Clarke 1880 (RGS)** — a = 6378249.145 m, 1/f = 293.465006 (already matches what is in `src/lib/coords.ts`, just verified against your screenshot).
- Projection: **UTM**, Zone **36**, Hemisphere **South**, k0 = 0.9996, false easting 500000, false northing 10,000,000.
- Allow Zone **37S** as a secondary option (eastern Narok edge), but default to 36S.
- Remove WGS84 as a coordinate-entry datum choice — Arc 1960 only, since lat/lng and WGS84 UTM are not used in your survey.

### 2. Seven-parameter datum transform (Arc 1960 → WGS84)
Replace the current 3-parameter shift in `src/lib/coords.ts` with a full **Bursa–Wolf 7-parameter** transform (DX, DY, DZ, RX, RY, RZ, K-ppm) so the controller's values can be entered verbatim.

Two presets exposed in the UI, plus a custom slot:
- **EPSG default (Molodensky 3-param)** — DX −157, DY −2, DZ −299, rotations 0, scale 0. This matches the "Detailed Information" screen on your RTK.
- **Controller 7-param** — DX +163, DY +6, DZ +298, RX/RY/RZ 0″, K 1 ppm (the values from your "Seven parameters" screen, applied in the WGS84→Arc 1960 direction, i.e. inverted when going Arc 1960→WGS84).
- **Custom** — seven editable fields so you can paste any future values from the controller.

Selection is stored per project (extends `Project` type in `src/lib/projects.ts` with a `datumParams` field) and persists in localStorage. A small "Datum" badge in the sidebar shows which preset is active.

### 3. UI cleanup in the coordinate panel
- Default zone dropdown to **36** (S), with 37 (S) as the only other option.
- Drop the hemisphere control (always S in Narok) — already removed in last turn, just confirming.
- Show the active ellipsoid + datum line ("Arc 1960 / Clarke 1880 / UTM 36S") so it's obvious what frame the numbers are in.
- Tokens kept in `src/styles.css` and `src/lib/projects.ts` so we can add Geoid model and Grid correction later without another refactor.

## Technical details

`src/lib/coords.ts`
- Add `type SevenParam = { dx; dy; dz; rx; ry; rz; k }` and `applyBursaWolf(x,y,z, p, inverse)`.
- Replace `toWgs84()` with a version that takes a `SevenParam` and a direction flag.
- `utmToLatLng()` and `latLngToUtm()` get an optional `params?: SevenParam` argument; when omitted they use the EPSG default.

`src/lib/projects.ts`
- Extend `Project` with `datumParams?: { preset: "epsg" | "controller" | "custom"; values: SevenParam }`.
- Default new projects to `"epsg"`.

`src/routes/index.tsx`
- Remove RTK metric-offset code path (already gone) and instead read `project.datumParams` when converting OCR / typed / imported UTM coords.
- Add a compact "Datum & projection" disclosure in the sidebar with the three presets + 7 editable fields when "Custom" is chosen.

## Out of scope (kept as future tokens)
- Geoid model and Grid correction toggles — UI placeholders only, no math yet.
- H.RMS / V.RMS reporting.
- Site Calibration (multi-point fit) — you asked to remove the simpler RTK calibration earlier; re-introducing it later as a real 4-param Helmert fit if you want.
