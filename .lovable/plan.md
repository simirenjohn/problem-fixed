## Goals

Upgrade the Siana map app to feel closer to Google Earth Pro: clearer imagery, a Google-Earth-style measure tool with a live rubber-band preview, a multi-point coordinate entry workflow, multi-project save/load, and a proper collapsible left sidebar layout.

---

## 1. Clearer basemap (Google Earth–like)

Esri World Imagery is already the best free satellite source we can use without an API key, but the current setup caps it at native zoom 18 and upscales blurry tiles past that. Improvements:

- Replace the single Esri layer with a **hybrid stack**: Esri World Imagery + Esri Boundaries & Places + Esri Transportation labels (all free, no key) so streets/POIs are labeled like Google Earth.
- Add a second free high-detail option: **Google Satellite tiles** via the public `mt{s}.google.com/vt/lyrs=s` endpoint (commonly used for personal/dev work) as a selectable base layer alongside Esri. Note: Google's tile ToS technically requires the JS API for production — we'll expose it as an optional layer the user can pick, with a note in the layer name ("Google Satellite — dev only").
- Keep `maxNativeZoom` correct per provider but stop upscaling past where tiles actually exist (cleaner look, no smeared pixels). Add a small "Max detail reached" hint instead of blurry tiles.
- Add **Bing/Maxar-style imagery via Esri's "World Imagery (Clarity)"** layer where available.

User picks the basemap from the existing LayersControl.

## 2. Google-Earth-style measure tool

Current tool only draws after you click 2+ points. Rebuild as:

- **Click to add a vertex.** As you move the mouse, a dashed "rubber band" segment follows the cursor from the last vertex, with a live distance label updating in real time (just like Google Earth).
- **Running totals**: show total length (and per-segment bearing) in a floating panel near the cursor or pinned in the sidebar.
- **For area mode**: rubber-band closes back to the first point; live area + perimeter update as you move.
- **Finish**: click "Done" button or press Enter / double-click. Esc cancels. Backspace removes last vertex.
- Add an **Undo last point** button.
- After finishing, the measurement persists on the map with all segment labels, and can be cleared or saved into the current project.

Implementation: track `hoverPoint` via `mousemove` in `MeasureClickLayer`, render an extra dashed `Polyline` from last vertex → hover, and a moving tooltip with the live distance.

## 3. Multi-point coordinate entry

Replace the single-point "Go to coordinates" panel with a **points list**:

- User adds points one at a time (Lat/Lng or UTM), each gets a row in a list with label, coordinates, and remove button.
- Each saved point shows as a green pin on the map with its label.
- Buttons at the bottom of the list: **Connect as line** (draw polyline through all points, show total distance), **Close as polygon** (draw polygon, show area + perimeter), **Clear all**, **Fly to fit all**.
- Points are part of the current project (see next section), so they're saved with it.
- Optional: drag-reorder rows to change line/polygon vertex order.

## 4. Projects (save/load/switch)

Since there's no backend yet, store projects in **`localStorage`** with this shape:

```text
{
  id, name, createdAt, updatedAt,
  points: [{ id, label, lat, lng }],
  measurements: [{ id, type: 'distance'|'area', points: [[lat,lng]...] }],
  notes: string
}
```

UI:
- A **Projects** section in the left sidebar with: current project name, dropdown to switch, **New project**, **Rename**, **Duplicate**, **Delete**, **Export project (.json)**, **Import project (.json)**.
- Auto-save on every change (debounced).
- "Last saved" timestamp shown.
- When real backend is added later (Lovable Cloud), this same shape maps cleanly to a `projects` table.

## 5. Collapsible left sidebar layout

Currently everything is one floating panel. Restructure using shadcn's `Sidebar` components:

- Left `Sidebar` with `collapsible="icon"` so it shrinks to an icon strip (Google-Earth-Pro style "Places/Layers/Tools" rail).
- `SidebarTrigger` in the top-left of the map header to expand/collapse.
- Sidebar groups (each independently expandable):
  1. **Projects** — switcher + actions
  2. **Search** — parcel number search
  3. **Layers** — basemap + overlays toggles (move out of Leaflet's built-in LayersControl into the sidebar for a cleaner look; keep one or the other)
  4. **Coordinates** — multi-point list (section 3)
  5. **Measure** — mode buttons + active measurement readout
  6. **Parcel info** — appears when a parcel is selected, with export buttons
- Map fills the remaining width and resizes correctly when the sidebar toggles.
- Mobile: sidebar becomes an off-canvas drawer (shadcn handles this).

---

## File changes

**New:**
- `src/lib/projects.ts` — localStorage CRUD, types, import/export helpers
- `src/hooks/use-projects.ts` — current project state + actions
- `src/components/map/AppSidebar.tsx` — shadcn Sidebar with all the groups
- `src/components/map/panels/ProjectsPanel.tsx`
- `src/components/map/panels/CoordinatesPanel.tsx` (multi-point)
- `src/components/map/panels/MeasurePanel.tsx`
- `src/components/map/panels/LayersPanel.tsx`
- `src/components/map/panels/SearchPanel.tsx`
- `src/components/map/panels/InfoPanel.tsx`

**Updated:**
- `src/components/map/MapView.tsx` — rubber-band measure, hybrid basemap stack, multi-point markers, persisted measurements, label overlays
- `src/routes/__root.tsx` — wrap in `SidebarProvider`
- `src/routes/index.tsx` — much thinner: just composes `AppSidebar` + `MapView`, wires project state

## Out of scope
- Real backend persistence (still localStorage; Cloud later)
- 3D / terrain view (Leaflet is 2D — would need MapLibre/CesiumJS)
- Street View
- Auth / sharing projects between users

## Deliverable
A Google-Earth-Pro-style workspace: clear hybrid imagery with street labels, a live rubber-band measure tool with running totals, a multi-point coordinate workflow that can be turned into lines or polygons, named projects you can switch between and export, and a proper collapsible left sidebar.
