# GitHub Copilot Instructions

## Project Overview
SF Street Transform is an interactive map-based urban planning tool for visualizing street and neighborhood transformations in San Francisco. The app allows users to draw polygon zones and trace street segments to prototype people-centric urban redesigns that reduce car dependency.

## Architecture & Key Components

### Single-File React App (`client/src/App.jsx`)
- **Monolithic component**: 4500+ lines containing all state, map logic, and UI
- **MapLibre GL JS integration**: Uses Maptiler basemaps with custom GeoJSON layers
- **Dual geometry tools**: Polygon drawing for zones, street path tracing with routing
- **Heavy use of useEffect hooks**: ~25 effects managing map state, user interactions, and data synchronization

### State Management Patterns
```jsx
// Editing states follow this pattern:
const [editingStreetSegmentId, setEditingStreetSegmentId] = useState(null);
const [selectedSavedIndex, setSelectedSavedIndex] = useState(null);
// Live refs avoid stale closures in map event handlers:
const startPointRef = useRef(startPoint);
```

### Geospatial Operations
- **Turf.js**: Extensive use for geometry calculations, intersections, buffering
- **Road network routing**: Custom Dijkstra implementation in `findShortestRoadPath()`
- **Map layer queries**: Use `queryRenderedFeatures()` with dynamic layer filtering via `getRoadLayerIds()`

## Development Workflows

### Local Development
```bash
# Root dev command (runs client dev server):
npm run dev
# Or directly in client/:
cd client && npm run dev
```

### Debug System
```javascript
// Enable debug logs via localStorage or URL:
localStorage.setItem('sfst_debug', '1');
localStorage.setItem('sfst_debug_tags', 'path,delta,snap'); // filter by tags
// Or: ?debug=1 in URL
```

### Performance Monitoring
- Street path calculations include timing diagnostics: `recordStreetPerf()`
- Effects use performance markers: `performance.now()` for heavy operations
- Built-in validation harness: `runStreetValidation()` in dev mode

## Critical Patterns & Conventions

### Map Layer Management
```javascript
// Always check layer existence before operations:
if (m.getLayer('layer-id')) {
  m.removeLayer('layer-id');
}
if (m.getSource('source-id')) {
  m.removeSource('source-id');
}
```

### GeoJSON Feature Structure
```javascript
// Zones and street segments follow this pattern:
{
  type: 'Feature',
  properties: {
    id: genId(), // 'id-timestamp-random'
    name: 'User Name',
    useType: 'mixed-use|residential|commercial',
    lengthM: 123.45, // for streets
    areaM2: 1234.5,  // for zones
    createdAt: Date.now()
  },
  geometry: { type: 'Polygon|LineString', coordinates: [...] }
}
```

### Road Network Queries
```javascript
// Get visible drivable roads:
const roadLayerIds = getRoadLayerIds(mapInstance);
const features = mapInstance.queryRenderedFeatures({ layers: roadLayerIds });
const roads = features.flatMap(explodeToLineStrings).filter(f => isDrivableRoad(f.properties));
```

### Edit Mode State Guards
```javascript
// Multiple locks prevent conflicting operations:
const streetCreationLock = streetsActive && ephemeralStreetPathSummary && !editingStreetSegmentId;
const polygonCreationLock = polygonActive && zoneSummary && editingSavedIndex == null && !showSavePanel;
const uiLock = streetCreationLock || polygonCreationLock || editingStreetLock;
```

## External Dependencies & Integration

### Map Data Sources
- **Maptiler**: Streets and satellite basemaps with API key
- **OpenStreetMap layers**: Road network data via `transportation`/`road` source layers
- **Reverse geocoding**: Maptiler Geocoding API for address lookups

### Key Libraries
- `@turf/turf`: All geospatial calculations (distance, intersection, buffering)
- `maplibre-gl`: Map rendering and interaction
- React 19 with hooks-heavy patterns

## Common Gotchas

1. **Map style switches**: All custom sources/layers must be re-added after basemap changes
2. **Coordinate precision**: Use `turf.nearestPointOnLine()` for snapping to avoid floating-point errors  
3. **Effect dependencies**: Map interaction handlers need refs to avoid stale state closures
4. **Layer order**: Ensure proper z-index by adding layers in correct sequence
5. **Feature ID consistency**: Use `properties.id` for saved features, not GeoJSON `id` property

## File Organization
```
client/src/
├── App.jsx          # Main application (all logic)
├── theme.js         # Design tokens & color mappings
├── components/
│   └── EditForm.jsx # Reusable zone/street editing form
└── main.jsx         # React entry point
```

When working on this codebase, prioritize understanding the complex state management in `App.jsx` and the geospatial operations that power the street routing and zone analysis features.