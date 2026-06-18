### Problem
The `ARC1960_TO_WGS84_CONTROLLER` preset in `src/lib/coords.ts` currently stores the 7-parameter Bursa-Wolf values as **negative** (−163, −6, −298) because the original comment assumed RTK controllers input them in the WGS84 → Arc 1960 direction. The user has confirmed the correct Arc 1960 → WGS84 values are **positive**: dx=+163, dy=+6, dz=+298, rx=ry=rz=0, k=1 ppm.

### Changes
1. **`src/lib/coords.ts`** — Update the `ARC1960_TO_WGS84_CONTROLLER` constant:
   - `dx: 163`, `dy: 6`, `dz: 298` (positive)
   - Update the JSDoc comment to state these are the direct Arc 1960 → WGS84 controller values, no inversion needed.

2. **`src/routes/index.tsx`** — Update the datum help text around line 826-827:
   - Remove the outdated sentence claiming the signs are pre-inverted.
   - Keep the "Controller (+163,+6,+298)" label as-is since it already displays the positive values.

### Verification
- Build the app (`bun run build`) to confirm no TypeScript or bundling errors.
- Open the Datum panel in the sidebar and confirm the Controller preset now shows the positive values and the help text is accurate.