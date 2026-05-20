# Siana RIM Web Map — Frontend MVP Plan

A browser-based parcel viewer with demo Siana parcels overlaid on Esri World Imagery. No backend, no auth — pure frontend so you can validate the UX before wiring up Lovable Cloud + PostGIS later.

## What gets built

**Single route `/`** with a full-screen map and a collapsible left sidebar.

### Map canvas
- Leaflet map centered on Siana
- Esri World Imagery basemap (free, no API key) + Esri reference labels overlay
- Parcel polygons rendered from a local GeoJSON file
- Click a parcel → highlight + open Info panel
- Scale bar, zoom controls, attribution

### Sidebar panels
1. **Search** — input for parcel number, fuzzy match, results list; clicking flies to parcel and selects it
2. **Tools**
   - Measure distance (click points, double-click to finish)
   - Measure area (draw polygon, shows m² and hectares)
   - GPS locate (uses `navigator.geolocation`)
   - Toggle parcel layer on/off
   - Clear measurements
3. **Info panel** (appears on parcel select)
   - Parcel number, calculated area, perimeter, source
   - Export buttons: GeoJSON, KML

### Demo data
- ~12–20 sample parcel polygons in the Siana area, stored as `src/data/parcels.geojson`
- Realistic-looking parcel numbers (e.g., `SIANA/001`, `SIANA/002`)
- Easy to swap later with real digitized data

### Responsive
- Sidebar becomes a bottom sheet / drawer on mobile
- Touch-friendly controls

## Technical details

- **Stack:** TanStack Start + React + Tailwind (existing template)
- **Libraries to add:** `leaflet`, `react-leaflet`, `@turf/turf`, `tokml` (or hand-rolled KML)
- **No backend, no auth, no DB** — all data is bundled GeoJSON
- **Files:**
  - `src/routes/index.tsx` — replaces placeholder, renders the map page
  - `src/components/map/MapView.tsx` — Leaflet map + parcel layer
  - `src/components/map/Sidebar.tsx` — collapsible sidebar shell
  - `src/components/map/SearchPanel.tsx`
  - `src/components/map/ToolsPanel.tsx` — measure/GPS/layers
  - `src/components/map/InfoPanel.tsx` — selected parcel details + export
  - `src/lib/parcel-export.ts` — GeoJSON/KML serializers
  - `src/lib/measure.ts` — Turf-based distance/area helpers
  - `src/data/parcels.geojson` — demo Siana parcels
  - SEO meta on the index route (title, description)
- **Leaflet CSS:** imported once at the map component
- **SSR note:** Leaflet is client-only, so the map component is dynamically rendered/guarded with a `typeof window` check inside the route component

## Out of scope (this phase)
- Lovable Cloud / PostGIS database
- Admin panel and edit forms
- Auth
- Real parcel data import (you'll provide later)
- Phase-2 items from the doc (offline, conflict detection, registry integration)

## Deliverable
A working preview where you can pan/zoom satellite imagery over Siana, see demo parcels, click to inspect them, search by number, measure distance/area, locate yourself via GPS, and export a parcel as GeoJSON or KML.
