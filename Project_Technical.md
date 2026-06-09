# SF Street Transform — Technical Documentation

_Last updated: 2026-06-07_

---

## 1. Application Goals

The application aims to:

- **Enable Design & Visualization:** Users draw polygon zones or select road-aligned street segments on a live map, then apply transformation tags to them.
- **User Control:** Intuitive tools for both freehand polygon drawing and road-following segment selection.
- **Dynamic Input:** Fully user-driven — no static overlays; everything is created, named, and edited by the user in real time.
- **Inform & Inspire:** Impact panels will show derived metrics (noise reduction, tree count, safety score, cost estimate) to support community advocacy.
- **Before & After Comparison:** Split-view slider showing the current vs. transformed state of a selected street.
- **Counterpoint Mode:** Toggle perspectives (Pedestrian / Business / Fire Dept) to show how different stakeholders experience the same transformation.
- **Iterative Design:** Label, save, compare, and share multiple zone/segment designs.

---

## 2. Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| UI framework | React | 19.1.0 | Hooks-based, no Redux |
| Map rendering | MapLibre GL JS | 5.7.0 | WebGL vector tiles |
| Geospatial operations | Turf.js | 7.2.0 | Area, centroid, pathfinding helpers |
| Basemaps & geocoding | MapTiler API | cloud | Streets + Satellite styles; reverse geocoding |
| Build tool | Vite | 6.3.5 | Dev server + production build |
| Routing | React Router | 7.6.2 | Minimal usage currently |
| Persistence | localStorage | — | Client-side only; no backend yet |

**API key:** MapTiler key is hardcoded at the top of `client/src/App.jsx` (`MAPTILER_KEY`). Must be replaced before any public deployment.

---

## 3. Repository Layout

```
sf-street-transform/
├── client/                        # React app (Vite)
│   ├── src/
│   │   ├── App.jsx                # Main component (~4,800 lines) — all map logic + UI
│   │   ├── main.jsx               # React entry point
│   │   ├── theme.js               # Design tokens: colors, spacing, buttonVariants()
│   │   ├── index.css              # Minimal global styles
│   │   └── components/
│   │       └── EditForm.jsx       # Reusable form: zone & segment metadata editing
│   ├── package.json               # React, React-DOM, React-Router, Vite
│   └── vite.config.js
├── package.json                   # Root: maplibre-gl, @turf/turf
├── CLAUDE.md                      # Architecture reference for AI-assisted development
├── Project_Vision.md              # Purpose, arguments, historical context, mockups
├── Project_Technical.md           # This file
└── Mockup 1.png / 2.png / 3.png   # UI/UX design mockups
```

### Running the app

```bash
cd client
npm run dev       # Vite dev server → http://localhost:5173
npm run build     # Production build
npm run lint      # ESLint
```

---

## 4. Architecture Overview

### Single-component design
All map logic, state, rendering, and UI lives in `App.jsx`. This is intentional — tight coupling with the MapLibre `map.current` ref makes extraction risky. `EditForm.jsx` is the one extracted child component.

### Key state groups

| Group | Key variables |
|-------|--------------|
| Tool / mode | `activeTool` (`"none"`, `"polygon"`, `"street"`), `useType` (`"mixed-use"`, `"residential"`, `"commercial"`), `basemapStyle` |
| Polygon drawing | `drawnCoords`, `savedZones`, `zoneSummary`, `pendingName`, `pendingDescription`, `editingSavedIndex`, `selectedSavedIndex` |
| Street segment | `startPoint`, `endPoint`, `ephemeralStreetPath`, `savedStreetSegments`, `streetPathLengthM`, `streetPathNonce`, `editingStreetSegmentId` |
| UI locks | `streetCreationLock`, `polygonCreationLock`, `editingStreetLock` |

### Data persistence (localStorage)

| Key | Contents |
|-----|----------|
| `sfst_savedZones_v1` | `Feature<Polygon>[]` — user-drawn zones |
| `sfst_savedStreetSegments_v1` | `Feature<LineString>[]` — saved street segments |
| `sfst_debug` | `"1"` — enables verbose debug logging |
| `sfst_debug_tags` | `"path,drag"` — filters debug output by tag |

### Feature property schema

```js
{
  id: string,           // genId() — 'id-<timestamp36>-<random>'
  name: string,
  description: string,
  useType: 'mixed-use' | 'residential' | 'commercial',
  lengthM: number,      // streets only
  streets: string[],    // intersecting street names from OSM tiles
  address: {            // from MapTiler reverse geocode
    street, postalCode, neighbourhood, city, state, country
  },
  createdAt: string,    // ISO timestamp
}
```

### Zone colours (useType → hex)

| Type | Colour |
|------|--------|
| `mixed-use` | `#FFD700` (gold) |
| `residential` | `#87CEEB` (sky blue) |
| `commercial` | `#FF6347` (tomato) |

### Map layers

| Source / Layer | Content |
|----------------|---------|
| `zones` → `zones-fill`, `zones-line`, `zones-labels` | Saved polygons, coloured by useType |
| `saved-street-segments` → `saved-street-segments-line` | Persisted street segments |
| `selected-road-segment` → `selected-road-segment-layer` | In-progress / editing path |
| `street-endpoints` → `street-endpoints-layer` | Start/end point circles |
| `edit-delta` → `edit-delta-layer` | Dashed diff preview during endpoint drag |
| `polygon-vertices` → `polygon-vertices-layer` | Draggable polygon vertex circles |
| `centroids` / `saved-centroids` → `centroids-circle` | Centroid dot markers |

### Style-switch resilience
When the basemap changes, all custom sources/layers are destroyed by MapLibre and must be fully restored. Multi-stage recovery logic in the `basemapStyle` useEffect re-adds every source, layer, and paint property using cached refs. Any new persistent layer must be included in this restore flow.

### Debug system
Toggle with `?debug=1` in the URL or `localStorage.setItem('sfst_debug','1')`. Filter by tag: `localStorage.setItem('sfst_debug_tags','path,drag')`. `SILENCE_DEBUG_LOGS = true` at the top of `App.jsx` suppresses known verbose console prefixes in normal operation.

---

## 5. Milestones

### Legend
- ✅ Implemented and verified in code
- ⚠️ Partially implemented or needs verification
- ❌ Not started

---

### M1 — Core Map & Polygon MVP
**Status: DONE | Est: 30 hrs**

| Sub-task | Status | Notes |
|----------|--------|-------|
| Fullscreen MapLibre GL map | ✅ | |
| Basemap toggle: Streets / Satellite | ✅ | Via MapTiler styles |
| Custom polygon drawing (click to add vertices) | ✅ | `drawnCoords` state |
| Polygon fill + vertex circles displayed | ✅ | `polygon-vertices-layer` |
| Live area calculation (sq m + sq ft) | ✅ | `turf.area` |
| Live centroid calculation | ✅ | `turf.center` |
| Drag polygon vertices to reshape | ✅ | `mousedown`/`mousemove` on `drawn-points-layer` |
| Right-click vertex to delete | ✅ | `contextmenu` event |
| Floating help UI (dismissible + re-openable) | ✅ | `showHelpBox` toggle |
| Collapsible sidebar | ✅ | `sidebarVisible` toggle |
| Reverse geocoding for zone centroid | ✅ | MapTiler API; displays street / postal / neighbourhood / city / state / country |
| Modular code structure (`theme.js`, `EditForm.jsx`) | ✅ | |

**Exit criteria met:** All features stable.

---

### M2 — Zone Summaries & Save/Load
**Status: DONE | Est: 18 hrs | 100%**

| Sub-task | Status | Notes |
|----------|--------|-------|
| Persist user-drawn polygons to localStorage | ✅ | `sfst_savedZones_v1` |
| Display area in sidebar for user zones | ✅ | Via `zoneSummary` |
| Display geocoded address in sidebar for user zones | ✅ | Async reverse geocode on centroid |
| Display intersecting street names | ✅ | `getIntersectingStreetNames()` |
| Finalize/save polygon with name, description, useType | ✅ | `finalizeZone()` → `EditForm` → `saveZone()` |
| List saved zones in sidebar | ✅ | |
| Select saved zone from list (highlights on map) | ✅ | |
| Edit saved zone metadata (name, description, type) | ✅ | |
| Re-draw / reshape saved zone geometry and re-save in place | ✅ | `loadSavedIntoDraw()` verified working |
| Summary refreshes correctly when re-selecting a saved zone | ✅ | |

_Zone comparison / multi-zone analysis deferred to M6 (Impact Panel) and M7 (Before/After View)._

---

### M3 — Street Segment Selection
**Status: DONE | Est: 24 hrs | 100%**

| Sub-task | Status | Notes |
|----------|--------|-------|
| "Street" tool mode | ✅ | `activeTool = 'street'` |
| Click to set start point (snapped to road) | ✅ | `snapToNetwork()` |
| Click to set end point (snapped to road) | ✅ | |
| Dijkstra pathfinding on live rendered road graph | ✅ | `findShortestRoadPath()` |
| Road graph built from MapLibre tile data (drivable filter) | ✅ | `isDrivableRoad()`, `getRoadLayerIds()` |
| Path highlighted on map | ✅ | `selected-road-segment-layer` |
| Clear / reset selection | ✅ | |
| Extended drag: drag endpoints to lengthen / shorten path | ✅ | Full network re-snap on mouseup |
| Fast-path same-line slice (prevents detour bounce) | ✅ | App.jsx lines ~1194–1210, ~2830–2851 |
| Precision trimming between endpoints (Turf lineSlice) | ✅ | App.jsx lines ~3050–3074 |
| Adaptive snapping radius | ✅ | |
| Path length metric (metres, displayed in sidebar) | ✅ | `streetPathLengthM` |
| Nonce-based recompute trigger | ✅ | `streetPathNonce` |
| Performance instrumentation (25-sample ring buffer) | ✅ | `recordStreetPerf()` |
| Defensive coordinate validation in snapping | ✅ | Guards + logging in `snapToNetwork` |
| Start/end point visual markers | ✅ | `street-endpoints-layer` |

**Exit criteria met:** All sub-tasks verified in code.

---

### M3.5 — UI & Interaction Refinement
**Status: DONE | Est: 14 hrs | 100%**

| Sub-task | Status | Notes |
|----------|--------|-------|
| Dynamic street segment colour reacts to useType instantly | ✅ | `updateUseType()` triggers repaint |
| Unified contextual help panel (polygon + street in one) | ✅ | Single `showHelpBox` component |
| Path length metric displayed in sidebar | ✅ | |
| Nonce-based recompute trigger visible to user (manual refresh) | ✅ | |
| Clean tool mode switching (polygon ↔ street, no state bleed) | ✅ | |
| Terminology consistency ("Zone type" label unified) | ✅ | |
| Save segment button — visible when path is ready | ✅ | Sidebar auto-opens on path compute (`setSidebarVisible(true)`) |
| Log noise reduction (silence remaining verbose logs) | ✅ | Added 8 missing prefixes to silencer; removed stray all-caps debug logs |
| Subtle inline hints for first-time users | ✅ | `toolHint` memo; contextual text below tool buttons, updates per step |
| Tool palette / button grouping consolidation | ✅ | Removed inner grid wrapper; added `id`/`className` BEM tokens; `setSidebarVisible(true)` on path ready |

**Status: DONE 100%**

---

### M4 — Street Segment Persistence
**Status: IN PROGRESS | Est: 16 hrs | ~55% complete**

| Sub-task | Status | Notes |
|----------|--------|-------|
| Persist street segments to localStorage | ✅ | `sfst_savedStreetSegments_v1` |
| Stable unique IDs | ✅ | `genId()` |
| Create new segment (save ephemeral path) | ✅ | |
| List saved segments in sidebar | ✅ | |
| Select saved segment (highlights on map) | ✅ | |
| Inline rename | ✅ | |
| useType change with immediate recolour + persistence | ✅ | |
| Geometry re-edit (reload path → adjust → re-finalize same ID) | ✅ | |
| Auto length recompute on finalize | ✅ | |
| Delete segment | ⚠️ | Code present; needs end-to-end verification |
| Tags / metadata groundwork (for M5) | ❌ | Not started |
| Filter toggle to show/hide saved segments layer | ❌ | Not started |

**Remaining to close M4:** Verify delete flow; add tags groundwork to feature properties; consider show/hide toggle for saved segments.

---

### M5 — Transformation Menu (Phase 1)
**Status: NOT STARTED | Est: 20 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| Transformation menu UI (Trees, Bike Lane, Outdoor Seating, Stormwater Planters) | ❌ |
| Apply tag to selected zone / segment | ❌ |
| Remove tag from zone / segment | ❌ |
| Persist tags in feature `properties` | ❌ |
| Display active tags in sidebar summary | ❌ |

**Dependency:** M2 + M4 (stable zone and segment entities to attach tags to).

---

### M6 — Impact Panel (Phase 1)
**Status: NOT STARTED | Est: 14 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| Estimated tree count derived from zone area | ❌ |
| Area % calculation (of block / neighbourhood) | ❌ |
| Speed calming indicator (heuristic) | ❌ |
| Render impact metrics in sidebar Info Panel | ❌ |
| Works for both polygon zones and street segments without crashes | ❌ |

**Dependency:** M5 (tags determine which metrics to compute).

---

### M7 — Before / After View (2D)
**Status: NOT STARTED | Est: 28 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| "Before" state 2D street rendering | ❌ |
| "After" (transformed) state 2D street rendering | ❌ |
| Drag slider to compare Before vs After | ❌ |
| Stylistic overlay for transformed state | ❌ |
| Acceptable render performance | ❌ |

**Dependency:** M5 (need transformation tags to know what "After" looks like).

---

### M8 — Auth & Cloud Persistence
**Status: NOT STARTED | Est: 34 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| User authentication (email or OAuth) | ❌ |
| Cloud database setup (Firebase Firestore or equivalent) | ❌ |
| Save zones / segments to cloud on create/update | ❌ |
| Load user's saved data on login | ❌ |
| Cross-device session persistence | ❌ |

**Dependency:** M2 + M4 (stable local data shape before migrating to cloud).  
**Open question:** Is multi-user collaboration required for MVP? (Affects scope significantly.)

---

### M9 — Counterpoint Mode (Phase 1)
**Status: NOT STARTED | Est: 12 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| Perspective toggle UI (Pedestrian / Business / Fire Dept) | ❌ |
| Define metric subsets per stakeholder perspective | ❌ |
| Impact panel renders correct subset on toggle | ❌ |
| Toggle state persists during session | ❌ |

**Dependency:** M6 (Impact Panel must exist first).

---

### M10 — MVP Release
**Status: NOT STARTED | Est: 24 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| All M1–M6 features stable and verified | ❌ |
| Error handling for edge cases (no path found, empty zones, etc.) | ❌ |
| Performance passes (map render, pathfinding) | ❌ |
| Lightweight onboarding / landing content | ❌ |
| Documentation updated for all shipped features | ❌ |
| No open defects severity > medium | ❌ |

---

### M11 — 3D / Advanced Visualization (Stretch)
**Status: NOT STARTED | Est: 40 hrs | 0%**

| Sub-task | Status |
|----------|--------|
| 3D view prototype (Three.js or MapLibre 3D terrain) | ❌ |
| Load a saved design in 3D | ❌ |
| Navigate (rotate / zoom) in 3D view | ❌ |
| "Go to 3D view" button wired from main map | ❌ |

**Dependency:** M7 (Before/After 2D must exist first).

---

## 6. Milestone Summary Table

| ID | Milestone | Est (hrs) | Status | % Done |
|----|-----------|-----------|--------|--------|
| M1 | Core Map & Polygon MVP | 30 | DONE | 100% |
| M2 | Zone Summaries & Save/Load | 18 | DONE | 100% |
| M3 | Street Segment Selection | 24 | DONE | 100% |
| M3.5 | UI & Interaction Refinement | 14 | DONE | 100% |
| M4 | Street Segment Persistence | 16 | IN PROGRESS | ~55% |
| M5 | Transformation Menu Phase 1 | 20 | NOT STARTED | 0% |
| M6 | Impact Panel Phase 1 | 14 | NOT STARTED | 0% |
| M7 | Before / After View 2D | 28 | NOT STARTED | 0% |
| M8 | Auth & Cloud Persistence | 34 | NOT STARTED | 0% |
| M9 | Counterpoint Mode Phase 1 | 12 | NOT STARTED | 0% |
| M10 | MVP Release | 24 | NOT STARTED | 0% |
| M11 | 3D / Advanced Visualization (Stretch) | 40 | NOT STARTED | 0% |
| **Total** | | **274** | | |

**MVP boundary (M10):** M1–M6. Estimated remaining MVP work: ~106 hrs (M2 partial + M3.5 partial + M4 partial + M5 + M6 + M10).

---

## 7. Progress Log

| Date (UTC) | Type | Milestone(s) | Summary | Hrs |
|------------|------|-------------|---------|-----|
| 2025-09-14 | Init | Docs | Added Milestones, Suggested Next Step, tracking tables | 0.5 |
| 2025-09-14 | Feature | M3 | Path highlight: improved road-following, removed block clamp, intersection splitting | TBD |
| 2025-09-14 | Fix | M3 + M1 | Restored polygon tool via mode sync; added path length metric; cleanup on mode switch; introduced M3.5 | 0.6 |
| 2025-09-14 | UI | M3.5 | Dynamic street colour reacts instantly to zone type swatch changes | 0.2 |
| 2025-09-14 | UI | M3.5 | Merged polygon & street help into single contextual panel | 0.2 |
| 2025-09-14 | Label | M3.5 | Renamed "Segment type" → "Zone type" for consistency | 0.05 |
| 2025-09-14 | Hygiene | — | Branch renamed to `008UpdateDrawingUI` | 0.05 |
| 2025-09-16 | Feature | M3 | Extended drag: full-network re-snap; endpoints can extend path over new segments | TBD |
| 2025-09-16 | Enhancement | M3 | Added `recomputeStreetPathRef` + nonce for explicit path recomputation after drag | TBD |
| 2025-09-16 | Docs | — | Updated milestone percentages; refreshed Suggested Next Step | 0.2 |
| 2025-09-16 | Fix | M3 | Same-line fast-path slice + precision trimming to eliminate intersection bounce | 0.4 |
| 2025-09-16 | Defensive | M3 | Hardened snapping against malformed coordinates | 0.2 |
| 2025-09-17 | Feature | M4 | localStorage load/save for zones + street segments with stable IDs | TBD |
| 2025-09-17 | Enhancement | M4 | Geometry re-edit: load saved path → adjust → re-finalize updates same ID & length | TBD |
| 2025-09-17 | Enhancement | M4 | Inline rename + per-segment useType dropdown with immediate recolour & persistence | TBD |
| 2026-06-07 | Review | M1–M4 | Code audit: verified M1/M3 done; M2/M3.5/M4 partial items documented; predefined zones removed (superseded by M2) | — |
| 2026-06-07 | Feature/Fix | M2+M3.5 | Fixed reverseGeocode field mapping (place_type lookup); cross-selection clearing; empty-click deselect; description in summary cards; log silencer expanded; toolHint inline; tool palette BEM tokens + sidebar auto-open on path ready | 2.5 |

_Add an entry when a milestone advances ≥10% or completes. Log focused engineering time only (exclude context switching)._

---

## 8. Agile Process

### Sprint Cadence
1-week sprints. Each sprint: lightweight planning note (1–2 milestone increments), end-of-sprint review + retro appended to Progress Log.

### Definition of Done
(a) Code committed and builds without errors  
(b) Manual smoke test passes for the new feature  
(c) This document updated if user-facing behaviour changed  
(d) Time logged in Progress Log

### Variance Review
At each sprint close: `Variance% = (Actual - Planned) / Planned` per active milestone.

### Branching Model
Feature branches per milestone (e.g. `feature/m4-segment-tags`). Merge via PR with checklist: tests (if any), manual demo notes, docs updated.

### Risk Log
If a blocker > 1 day appears, add an entry below with: description, mitigation, owner.

| Date | Risk | Mitigation | Status |
|------|------|------------|--------|
| — | — | — | — |

---

## 9. Open Questions

1. **Multi-user collaboration (M8):** Is real-time or async collaboration needed in MVP? Significantly affects M8 scope.
3. **Street segment corridors (future M12?):** Should saved segments be mergeable into named corridors (e.g. "Market Street corridor")?
4. **Impact metric precision (M6):** Are heuristic estimates acceptable for Phase 1, or do metrics need to be modelled from real data?
5. **MapTiler API key:** Must be moved to an environment variable before any public deployment.

---

## 10. Technical References

- [React](https://react.dev/)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [MapTiler API](https://www.maptiler.com/cloud/api/)
- [Turf.js](https://turfjs.org/)
