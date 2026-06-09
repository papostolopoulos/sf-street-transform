# SF Street Transform — CLAUDE.md

## Project Overview

An interactive, map-based React web app for visualizing and prototyping street transformations in San Francisco. Goal: empower residents to redesign streets (narrower lanes, bike paths, green spaces) and reduce car dependency.

**Vision:** Users draw zones or select road segments, apply transformation tags (trees, bike lanes, etc.), and see Before/After impact panels. See `Project_Documentation.md` for full roadmap.

---

## Tech Stack

| Layer | Library | Version |
|-------|---------|---------|
| UI | React | 19.1.0 |
| Map rendering | MapLibre GL JS | 5.7.0 |
| Geospatial ops | Turf.js | 7.2.0 |
| Basemaps / geocoding | MapTiler API | cloud |
| Build tool | Vite | 6.3.5 |

**No backend yet** — client-side only, localStorage for persistence.

---

## Repository Layout

```
sf-street-transform/
├── client/                   # React app (Vite)
│   ├── src/
│   │   ├── App.jsx           # Main component (~4,800 lines) — all map logic + UI
│   │   ├── main.jsx          # React entry point
│   │   ├── theme.js          # Design tokens: colors, spacing, buttonVariants
│   │   ├── index.css         # Minimal global styles
│   │   └── components/
│   │       └── EditForm.jsx  # Reusable form for zone/segment metadata editing
│   ├── package.json          # React + Vite deps
│   └── vite.config.js
├── package.json              # Root: maplibre-gl, @turf/turf
├── Project_Documentation.md  # Full project doc, milestones, roadmap
├── Mockup 1.png / 2.png / 3.png  # UI mockups
└── CLAUDE.md                 # This file
```

---

## Running the App

```bash
cd client
npm run dev       # Vite dev server (default: http://localhost:5173)
npm run build     # Production build
npm run lint      # ESLint
```

MapTiler API key is hardcoded at top of `App.jsx` (`MAPTILER_KEY`).

---

## Architecture

### Single-component design
All map logic, state, and UI lives in `client/src/App.jsx`. This is intentional — tight coupling with the MapLibre `map.current` ref makes extraction complex. `EditForm.jsx` is the one extracted child component.

### Key state groups (all in App.jsx)

**Mode / tool:**
- `activeTool` — `"none" | "polygon" | "street"`
- `useType` — `"mixed-use" | "residential" | "commercial"`
- `basemapStyle` — `"streets" | "satellite"`

**Polygon (zone) drawing:**
- `drawnCoords` — current vertices `[lng, lat][]`
- `savedZones` — persisted `Feature<Polygon>[]`
- `zoneSummary` — `{ area, centroidPt, streets, address }` (derived)
- `pendingName`, `pendingDescription` — unsaved form state
- `editingSavedIndex` — index of zone being edited
- `selectedSavedIndex` — currently highlighted zone

**Street segment selection:**
- `startPoint`, `endPoint` — route endpoints `[lng, lat]`
- `ephemeralStreetPath` — current in-progress `Feature<LineString>`
- `savedStreetSegments` — persisted `Feature<LineString>[]`
- `streetPathLengthM` — live computed length
- `streetPathNonce` — increment to force path recomputation
- `editingStreetSegmentId` — UUID of segment under geometry edit

**UI locks (prevent conflicting interactions):**
- `streetCreationLock`, `polygonCreationLock`, `editingStreetLock`

### Key refs
```js
drawnCoordsRef        // polygon vertices (stable in drag handlers)
startPointRef         // current street start
endPointRef           // current street end
editingStreetSegmentIdRef
selectedRoadSegmentRef  // cached path for basemap-switch restore
streetEndpointsFCRef    // cached endpoints for basemap-switch restore
initialStartRef / initialEndRef  // original endpoints when entering edit
```

### Core functions

| Function | Purpose |
|----------|---------|
| `findShortestRoadPath(map, startPt, endPt)` | Dijkstra on live road network graph from rendered tiles |
| `snapToNetwork(lngLatArr)` | Snaps a point to nearest drivable road segment |
| `isDrivableRoad(props)` | Filters OSM road types (excludes footways, private, etc.) |
| `getRoadLayerIds(map)` | Finds road layers in current style by name tokens |
| `ensureSourcesAndLayers(map)` | Idempotent: creates/updates all GeoJSON sources + layers |
| `refreshMapData(map, coords, useType, savedZones)` | Re-renders all saved zones with color-by-use |
| `renderAllStreetSegments(map, segments, ...)` | Renders saved + ephemeral street layers |
| `calculateStreetAppearance(useType, isEditing)` | Returns paint props (color, width) per use type |
| `getIntersectingStreetNames(map, polygon)` | Queries rendered tiles for street names inside zone |
| `reverseGeocode(lng, lat)` | MapTiler API → `{ street, postalCode, neighborhood, city, ... }` |
| `finalizeZone()` | Validates polygon (≥3 pts), triggers save panel |
| `finalizeStreetSelection()` | Commits ephemeral path → savedStreetSegments |

### Map layers (managed by `ensureSourcesAndLayers`)

| Source / Layer | Content |
|----------------|---------|
| `zones` → `zones-fill`, `zones-line`, `zones-labels` | Saved polygons, colored by useType |
| `saved-street-segments` → `saved-street-segments-line` | Persisted street segments |
| `selected-road-segment` → `selected-road-segment-layer` | In-progress / editing path |
| `street-endpoints` → `street-endpoints-layer` | Start/end point circles |
| `edit-delta` → `edit-delta-layer` | Dashed diff preview during endpoint drag |
| `polygon-vertices` → `polygon-vertices-layer` | Draggable polygon vertex circles |
| `centroids` / `saved-centroids` → `centroids-circle` | Centroid markers |

---

## Data Persistence (localStorage)

| Key | Type | Contents |
|-----|------|----------|
| `sfst_savedZones_v1` | `Feature<Polygon>[]` | User-drawn zones |
| `sfst_savedStreetSegments_v1` | `Feature<LineString>[]` | Saved street segments |
| `sfst_debug` | `"1"` | Enable verbose debug logging |
| `sfst_debug_tags` | `"path,drag"` | Filter debug output by tag |

### Feature property schema
```js
{
  id: string,          // genId() — 'id-<timestamp36>-<random>'
  name: string,
  description: string,
  useType: 'mixed-use' | 'residential' | 'commercial',
  lengthM: number,     // streets only
  streets: string[],   // intersecting street names
  address: { street, postalCode, neighbourhood, city, state, country },
  createdAt: string,   // ISO timestamp
}
```

---

## Zone Colors (useType → color)

Defined in `theme.js` and mirrored in `App.jsx`:
- `mixed-use` → `#FFD700` (gold)
- `residential` → `#87CEEB` (sky blue)
- `commercial` → `#FF6347` (tomato)

---

## Debug System

Toggle via URL `?debug=1` or `localStorage.setItem('sfst_debug','1')`.  
Filter tags: `localStorage.setItem('sfst_debug_tags','path,drag')`.  
`SILENCE_DEBUG_LOGS = true` at top of `App.jsx` suppresses known verbose prefixes in console.

---

## Coding Conventions

### Comments in App.jsx

App.jsx is large (~4,800+ lines) and mixes map logic, state, and UI. Comments are required and must explain **what a block does and why** — not just restate the code.

**Required in every case:**
- Top of every `useEffect`: one-line description of its purpose and trigger, e.g.:
  ```js
  // Deselect saved zone/segment when user clicks on empty map area (neutral mode only)
  useEffect(() => { ... }, [...]);
  ```
- Top of every named function: one-line description if not already obvious from the name alone.
- Any MapLibre source/layer manipulation that isn't self-evident.
- Any cross-cutting side effect (e.g. clearing state belonging to another feature, style-switch restoration logic).

**Use section dividers for logical groups:**
```js
// --- Save / finalize helpers -----------------------------------
// --- Map layer management -------------------------------------
// --- Street segment drag logic --------------------------------
```

**Do not write comments that just restate the code:**
```js
// ❌ Set state to null
setSelectedSavedIndex(null);

// ✅ Clear zone selection so the street summary can render alone
setSelectedSavedIndex(null);
```

---

### HTML Classes and IDs

All rendered elements must have a `className` and/or `id` that clearly communicates their role.

**Naming convention — BEM (Block__Element--Modifier):**

| Pattern | Example | Use for |
|---------|---------|---------|
| Block | `summary-card` | A standalone UI section |
| Block__Element | `summary-card__zone` | A child within that section |
| Block--Modifier | `btn--delete` | A variant or state of a block |
| State class | `is-selected`, `is-open`, `is-disabled` | Dynamic state added/removed in JSX |

**Existing class vocabulary to reuse (do not reinvent):**

*Layout:*
- `sidebar`, `sidebar__toggle`, `sidebar__resizer`
- `basemap-toggle`, `basemap-toggle__options`, `basemap-toggle__btn`

*Summary card:*
- `summary-card`, `summary-card__zone`, `summary-card__street`
- `summary-card__address`, `summary-card__streets`

*Lists:*
- `list-item`, `zone-item`, `street-item`

*Buttons:*
- `btn` (base), `btn--select`, `btn--deselect`, `btn--edit`, `btn--delete`
- `btn--finalize`, `btn--save`, `btn--cancel`

*State modifiers:*
- `is-selected`, `is-open`, `is-closed`, `is-active`, `is-disabled`

**IDs** are reserved for key structural anchor points that CSS, tests, or external tools may need to target:
- `#summary-card`, `#sidebar`, `#sidebar-toggle`, `#sidebar-resizer`
- `#basemap-toggle`
- Form fields: `#zone-edit-name`, `#street-edit-name`, `#street-name`, `#street-desc`

**Every new element must follow this pattern.** If no existing class fits, create a new BEM name and note it here.

---

## Style-Switch Resilience

When the basemap style changes, all custom sources/layers are destroyed and must be restored. Multi-stage recovery logic (in the `basemapStyle` useEffect) re-adds sources, layers, and paints using cached refs. Always account for this when adding new persistent map layers.

---

## Milestones at a Glance

| ID | Milestone | Status |
|----|-----------|--------|
| M1 | Core Map & Polygon MVP | DONE |
| M2 | Zone Summaries & Save/Load | ~40% in progress |
| M3 | Street Segment Selection | DONE |
| M3.5 | UI & Interaction Refinement | ~55% |
| M4 | Street Segment Persistence | ~55% |
| M5–M11 | Transformation menu, impact panel, before/after, auth, 3D | NOT STARTED |

Full milestone table and roadmap: `Project_Documentation.md` §11.
