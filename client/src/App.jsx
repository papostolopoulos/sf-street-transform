const MAPTILER_KEY = "DyVFUZmyKdCywxRTVU9B";
import React, { useState, useRef, useEffect } from "react";
import * as turf from "@turf/turf";
import maplibregl from "maplibre-gl";
// Simple id generator (not crypto strong but stable enough for local features)
function genId() {
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9);
}
// Utility: Explode GeoJSON features to array of LineStrings
function explodeToLineStrings(feature) {

  if (!feature) return [];
  if (feature.type === "FeatureCollection") {
    return feature.features.flatMap(explodeToLineStrings);
  }
  if (feature.type === "Feature") {
    if (feature.geometry?.type === "LineString") return [feature];
    if (feature.geometry?.type === "MultiLineString") {
      return feature.geometry.coordinates.map(coords => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: feature.properties || {},
      }));
    }
    return [];
  }
  return [];
}


export default function App() {
  // Show save panel state
  const [showSavePanel, setShowSavePanel] = useState(false);
  // Map instance ref
  const map = useRef(null);
  // Use type to color mapping
  const colorByUse = {
    "mixed-use": "#FFD700",      // gold
    "residential": "#87CEEB",    // sky blue
    "commercial": "#FF6347",     // tomato
    // Add more use types and colors as needed
  };
  // Map container ref
  const mapContainer = useRef(null);
  // Pending name state
  const [pendingName, setPendingName] = useState("");
  // Pending description (used in save panel)
  const [pendingDescription, setPendingDescription] = useState("");
  // Summary context state
  const [summaryContext, setSummaryContext] = useState(null);
  // Zone summary state
  const [zoneSummary, setZoneSummary] = useState(null);
  // Unified active tool: 'none' | 'polygon' | 'street'
  const [activeTool, setActiveTool] = useState('none');
  // --- React state hooks ---

  // --- Derived constants ---
  const polygonActive = activeTool === 'polygon';
  const streetsActive = activeTool === 'street';
  // End point for segment selection
  const [endPoint, setEndPoint] = useState(null);
  // Start point for segment selection
  const [startPoint, setStartPoint] = useState(null);
  // Derived start/end selection mode from active tool
  const startEndMode = streetsActive;
  // Length (meters) of current highlighted street path (M3 diagnostic / UX)
  const [streetPathLengthM, setStreetPathLengthM] = useState(null);
  // Manual recompute trigger (nonce) & ref helper for external callers (e.g., drag commit)
  const [streetPathNonce, setStreetPathNonce] = useState(0);
  const recomputeStreetPathRef = useRef(null); // will point to () => setStreetPathNonce(n=>n+1)
  // Saved street segments (M4 slice)
  const [savedStreetSegments, setSavedStreetSegments] = useState([]); // Feature<LineString>[]
  const [selectedStreetSegmentIndex, setSelectedStreetSegmentIndex] = useState(null);
  // Unified selection clearing when tool switches
  useEffect(()=>{
    if (polygonActive) {
      // Clear street selection state when switching to polygon tool
      setSelectedStreetSegmentIndex(null);
      setEditingStreetSegmentId(null);
    } else if (streetsActive) {
      // Clear polygon selection/editing when switching to street tool
      setSelectedSavedIndex(null);
      setEditingSavedIndex(null);
    }
  }, [polygonActive, streetsActive]);

  // Derive currently selected saved street segment
  const selectedStreetSegment = (typeof selectedStreetSegmentIndex === 'number' && selectedStreetSegmentIndex >=0) ? savedStreetSegments[selectedStreetSegmentIndex] : null;

  // Build a lightweight street segment summary similar to zone summary
  const streetSegmentSummary = React.useMemo(()=>{
    if (!selectedStreetSegment) return null;
    try {
      const coords = selectedStreetSegment.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const lenM = selectedStreetSegment.properties?.lengthM ?? (()=>{ try { return turf.length(selectedStreetSegment,{units:'meters'}) } catch { return null; } })();
      const start = coords[0];
      const end = coords[coords.length-1];
      return {
        id: selectedStreetSegment.properties?.id,
        name: selectedStreetSegment.properties?.name,
        useType: selectedStreetSegment.properties?.useType,
        lengthM: lenM,
        start,
        end
      };
    } catch { return null; }
  }, [selectedStreetSegment]);
  // Editing an existing saved street segment geometry
  const [editingStreetSegmentId, setEditingStreetSegmentId] = useState(null);
  // Performance samples for street path build (last N)
  const [streetPerfSamples, setStreetPerfSamples] = useState([]); // each: { total, featureQuery, graphBuild, pathSolve, renderUpdate, ts }

  function recordStreetPerf(sample) {
    setStreetPerfSamples(prev => {
      const next = [...prev, sample];
      // keep last 25 samples
      return next.slice(-25);
    });
  }
  // Zone type state
  const [useType, setUseType] = useState("mixed-use");
  // Ephemeral summary (unsaved street path) for fresh load first street action (placed after dependent state declarations)
  const ephemeralStreetPathSummary = React.useMemo(()=>{
    if (!streetsActive) return null;
    if (!startPoint || !endPoint) return null;
    if (streetPathLengthM == null) return null;
    if (editingStreetSegmentId) return null; // editing existing feature handled via saved summary
    if (selectedStreetSegment) return null; // saved selection takes precedence
    return {
      id: null,
      name: 'Unsaved Segment',
      useType,
      lengthM: streetPathLengthM,
      start: startPoint,
      end: endPoint,
      transient: true
    };
  }, [streetsActive, startPoint, endPoint, streetPathLengthM, useType, selectedStreetSegment, editingStreetSegmentId]);
  // Drawn coordinates state
  const [drawnCoords, setDrawnCoords] = useState([]);
  // Editing saved zone index state
  const [editingSavedIndex, setEditingSavedIndex] = useState(null);
  // Drawing mode state
  const [drawMode, setDrawMode] = useState(false);
  // Selected saved zone index state
  const [selectedSavedIndex, setSelectedSavedIndex] = useState(null);
  // Saved zones state
  const [savedZones, setSavedZones] = useState([]);
  // --- Persistence load (zones + street segments) ---
  useEffect(()=>{
    try {
      const zRaw = localStorage.getItem('sfst_savedZones_v1');
      if (zRaw) {
        const arr = JSON.parse(zRaw);
        if (Array.isArray(arr)) {
          const sanitized = arr.filter(f => f && f.geometry && f.geometry.type === 'Polygon' && Array.isArray(f.geometry.coordinates));
          setSavedZones(sanitized);
        }
      }
    } catch {}
    try {
      const sRaw = localStorage.getItem('sfst_savedStreetSegments_v1');
      if (sRaw) {
        const arr = JSON.parse(sRaw);
        if (Array.isArray(arr)) {
          const sanitized = arr.filter(f => f && f.geometry && f.geometry.type === 'LineString' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2);
          setSavedStreetSegments(sanitized);
        }
      }
    } catch {}
  }, []);
  // Persist on change
  useEffect(()=>{
    try { localStorage.setItem('sfst_savedZones_v1', JSON.stringify(savedZones)); } catch {}
  }, [savedZones]);
  useEffect(()=>{
    try { localStorage.setItem('sfst_savedStreetSegments_v1', JSON.stringify(savedStreetSegments)); } catch {}
  }, [savedStreetSegments]);
  // Basemap style state
  const [basemapStyle, setBasemapStyle] = useState("streets");
  // Help box visibility for drawing instructions
  const [showHelpBox, setShowHelpBox] = useState(true);
  // Sidebar visibility & width (was referenced but not defined)
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(380);

  // Helper used by flyToSaved for padding with sidebar
  function getMapPadding() {
    return {
      left: 16,
      right: sidebarVisible ? sidebarWidth + 16 : 16,
      top: 16,
      bottom: 16,
    };
  }
  // --- Maptiler styles ---
  const maptilerStyles = {
    streets: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
    satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`
  };

  // --- helpers ----------------------------------------------------

  function convertToSquareFeet(squareMeters) {
    return squareMeters * 10.7639;
  }

  // Visible road/name layers in current style (include symbol labels)
  function getRoadLayerIds(mapInstance) {
    const style = mapInstance.getStyle();
    if (!style?.layers) return [];
    const tokens = ["transportation", "road", "street", "highway"];
    return style.layers
      .filter((lyr) => {
        const id = (lyr.id || "").toLowerCase();
        const sl = (lyr["source-layer"] || "").toLowerCase();
        const isLineOrSymbol = lyr.type === "line" || lyr.type === "symbol";
        const matches = tokens.some((t) => id.includes(t) || sl.includes(t));
        return isLineOrSymbol && matches;
      })
      .map((lyr) => lyr.id);
  }

  // Reverse geocode for centroid {lng,lat}
  async function reverseGeocode(lng, lat) {
    const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${MAPTILER_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      const f = data?.features || [];
      return {
        street: f[0]?.text_en || null,
        postalCode: f[1]?.text_en || null,
        neighborhood: f[2]?.text_en || null,
        city: f[3]?.text_en || null,
        state: f[4]?.text_en || null,
        country: f[5]?.text_en || null,
      };
    } catch {
      return null;
    }
  }

  // Streets that intersect the polygon (works with lines & symbol labels)
  function getIntersectingStreetNames(mapInstance, polygon) {
    const layerIds = getRoadLayerIds(mapInstance);
    if (!mapInstance) return [];

    // Build a pixel bbox: [[minX,minY], [maxX,maxY]]
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(polygon);
    const p1 = mapInstance.project([minLng, minLat]);
    const p2 = mapInstance.project([maxLng, maxLat]);
    const pad = 12;
    const minX = Math.min(p1.x, p2.x) - pad;
    const minY = Math.min(p1.y, p2.y) - pad;
    const maxX = Math.max(p1.x, p2.x) + pad;
    const maxY = Math.max(p1.y, p2.y) + pad;
    const pixelBox = [
      [minX, minY],
      [maxX, maxY],
    ];

    const options = layerIds.length ? { layers: layerIds } : undefined;

    // First try just the bbox; if empty, fall back to whole viewport.
    let candidates = mapInstance.queryRenderedFeatures(pixelBox, options);
    if (!candidates || candidates.length === 0) {
      candidates = mapInstance.queryRenderedFeatures(options);
    }

    const names = new Set();
    const nameKeys = [
      "name",
      "name_en",
      "name:en",
      "name:latin",
      "street",
      "ref",
    ];

    for (const feat of candidates) {
      // pick a readable name
      let name = null;
      for (const k of nameKeys) {
        if (feat.properties?.[k]) {
          name = feat.properties[k];
          break;
        }
      }
      if (!name && feat.properties?.class) name = feat.properties.class;
      if (!name) continue;

      const g = feat.geometry?.type;
      if (g === "LineString" || g === "MultiLineString") {
        const asTurf =
          g === "LineString"
            ? turf.lineString(feat.geometry.coordinates)
            : turf.multiLineString(feat.geometry.coordinates);
        if (turf.booleanIntersects(asTurf, polygon)) names.add(name);
      } else if (g === "Point") {
        const pt = turf.point(feat.geometry.coordinates);
        if (turf.booleanPointInPolygon(pt, polygon)) names.add(name);
      } else if (g === "MultiPoint") {
        for (const c of feat.geometry.coordinates || []) {
          const pt = turf.point(c);
          if (turf.booleanPointInPolygon(pt, polygon)) {
            names.add(name);
            break;
          }
        }
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  // Ensure sources and layers exist after load/style switch
  function ensureSourcesAndLayers(mapInstance) {
    // Add source for drawn line if not present
    if (!mapInstance.getSource("drawn-line")) {
      mapInstance.addSource("drawn-line", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    // Add layer for drawn line if not present
    if (!mapInstance.getLayer("drawn-line-layer")) {
      mapInstance.addLayer({
        id: "drawn-line-layer",
        type: "line",
        source: "drawn-line",
        paint: {
          "line-color": "#0074D9",
          "line-width": 4,
        },
      });
    }
    // GeoJSON sources for current in-progress zone
    if (!mapInstance.getSource("zones")) {
      mapInstance.addSource("zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!mapInstance.getSource("centroids")) {
      mapInstance.addSource("centroids", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!mapInstance.getSource("drawn-points")) {
      mapInstance.addSource("drawn-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    // Sources for saved zones
    if (!mapInstance.getSource("saved-zones")) {
      mapInstance.addSource("saved-zones", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!mapInstance.getSource("saved-centroids")) {
      mapInstance.addSource("saved-centroids", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    // In-progress layers
    if (!mapInstance.getLayer("zones-fill")) {
      mapInstance.addLayer({
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "useType"],
            "mixed-use",
            colorByUse["mixed-use"],
            "residential",
            colorByUse["residential"],
            "commercial",
            colorByUse["commercial"],
            "#888888",
          ],
          "fill-opacity": 0.35,
        },
      });
    }
    if (!mapInstance.getLayer("zones-outline")) {
      mapInstance.addLayer({
        id: "zones-outline",
        type: "line",
        source: "zones",
        paint: { "line-color": "#333", "line-width": 1.5 },
      });
    }

    if (!mapInstance.getLayer("centroids-circle")) {
      mapInstance.addLayer({
        id: "centroids-circle",
        type: "circle",
        source: "centroids",
        paint: {
          "circle-radius": 5,
          "circle-color": "#111",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
        },
      });
    }

    if (!mapInstance.getLayer("drawn-points-layer")) {
      mapInstance.addLayer({
        id: "drawn-points-layer",
        type: "circle",
        source: "drawn-points",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ff0000",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });
    }

    // Saved zones layers
    if (!mapInstance.getLayer("saved-zones-fill")) {
      mapInstance.addLayer({
        id: "saved-zones-fill",
        type: "fill",
        source: "saved-zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "useType"],
            "mixed-use",
            colorByUse["mixed-use"],
            "residential",
            colorByUse["residential"],
            "commercial",
            colorByUse["commercial"],
            "#888888",
          ],
          "fill-opacity": 0.18,
        },
      });
    }
    if (!mapInstance.getLayer("saved-zones-outline")) {
      mapInstance.addLayer({
        id: "saved-zones-outline",
        type: "line",
        source: "saved-zones",
        paint: { "line-color": "#222", "line-width": 1 },
      });
    }

    // Selected highlight layers with a filter
    if (!mapInstance.getLayer("saved-zones-fill-selected")) {
      mapInstance.addLayer({
        id: "saved-zones-fill-selected",
        type: "fill",
        source: "saved-zones",
        paint: {
          "fill-color": [
            "match",
            ["get", "useType"],
            "mixed-use",
            colorByUse["mixed-use"],
            "residential",
            colorByUse["residential"],
            "commercial",
            colorByUse["commercial"],
            "#888888",
          ],
          "fill-opacity": 0.35,
        },
        filter: ["==", ["get", "__sid"], -999],
      });
    }
    if (!mapInstance.getLayer("saved-zones-outline-selected")) {
      mapInstance.addLayer({
        id: "saved-zones-outline-selected",
        type: "line",
        source: "saved-zones",
        paint: { "line-color": "#000", "line-width": 3 },
        filter: ["==", ["get", "__sid"], -999],
      });
    }

    // Saved street segments
    if (!mapInstance.getSource('saved-street-segments')) {
      mapInstance.addSource('saved-street-segments', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }
    if (!mapInstance.getLayer('saved-street-segments-casing')) {
      mapInstance.addLayer({
        id: 'saved-street-segments-casing',
        type: 'line',
        source: 'saved-street-segments',
        paint: {
          'line-color': '#111',
          'line-width': 8,
          'line-opacity': 0.25
        }
      });
    }
    if (!mapInstance.getLayer('saved-street-segments-line')) {
      mapInstance.addLayer({
        id: 'saved-street-segments-line',
        type: 'line',
        source: 'saved-street-segments',
        paint: {
          'line-color': ['match', ['get','useType'], 'residential', '#87CEEB', 'commercial', '#FF6347', 'mixed-use', '#FFD700', '#FFD700'],
          'line-width': 5,
          'line-opacity': 0.9
        }
      });
    }
    if (!mapInstance.getLayer('saved-street-segments-selected')) {
      mapInstance.addLayer({
        id: 'saved-street-segments-selected',
        type: 'line',
        source: 'saved-street-segments',
        filter: ['==',['get','__sid'], -999],
        paint: {
          'line-color': '#222',
          'line-width': 9,
          'line-opacity': 0.35
        }
      });
    }
  }

  // Update selected filters
  function applySelectedFilter(mapInstance, idx) {
    if (!mapInstance) return;
    const filt =
      typeof idx === "number"
        ? ["==", ["get", "__sid"], idx]
        : ["==", ["get", "__sid"], -999];
    if (mapInstance.getLayer("saved-zones-fill-selected")) {
      mapInstance.setFilter("saved-zones-fill-selected", filt);
    }
    if (mapInstance.getLayer("saved-zones-outline-selected")) {
      mapInstance.setFilter("saved-zones-outline-selected", filt);
    }
  }

  // Push current state into map sources
  function refreshMapData(mapInstance, coords, currentUseType, savedList) {
    // In-progress zone FC
    let zonesFC = { type: "FeatureCollection", features: [] };
    let centroidsFC = { type: "FeatureCollection", features: [] };

    if (coords.length >= 3) {
      const closed = [...coords, coords[0]];
      const poly = turf.polygon([closed], {
        id: "zone-1",
        name: "Custom Zone",
        useType: currentUseType,
      });
      zonesFC = { type: "FeatureCollection", features: [poly] };

      const ctr = turf.centroid(poly);
      const centroidFeature = {
        type: "Feature",
        properties: { id: "zone-1" },
        geometry: ctr.geometry,
      };
      centroidsFC = { type: "FeatureCollection", features: [centroidFeature] };
    }

    const pointsFC = {
      type: "FeatureCollection",
      features: coords.map((coord, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: { id: i },
      })),
    };

    // Saved zones FCs with stable index property for filtering
    const savedListWithSid = (savedList || []).map((f, i) => {
      const clone = JSON.parse(JSON.stringify(f));
      clone.properties = { ...(clone.properties || {}), __sid: i };
      return clone;
    });
    const savedZonesFC = {
      type: "FeatureCollection",
      features: savedListWithSid,
    };
    const savedCentroidsFC = {
      type: "FeatureCollection",
      features: savedListWithSid
        .map((f, i) => {
          try {
            const ctr = turf.centroid(f);
            return {
              type: "Feature",
              properties: { id: i },
              geometry: ctr.geometry,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    };

    mapInstance.getSource("zones")?.setData(zonesFC);
    mapInstance.getSource("centroids")?.setData(centroidsFC);
    mapInstance.getSource("drawn-points")?.setData(pointsFC);
    mapInstance.getSource("saved-zones")?.setData(savedZonesFC);
    mapInstance.getSource("saved-centroids")?.setData(savedCentroidsFC);

    // Saved street segments
    const segsFC = {
      type: 'FeatureCollection',
      features: (savedStreetSegments || []).map((f,i) => ({
        ...f,
        properties: { ...(f.properties||{}), __sid: i }
      }))
    };
    mapInstance.getSource('saved-street-segments')?.setData(segsFC);
    if (mapInstance.getLayer('saved-street-segments-selected')) {
      const filt = typeof selectedStreetSegmentIndex === 'number' ? ['==',['get','__sid'], selectedStreetSegmentIndex] : ['==',['get','__sid'], -999];
      try { mapInstance.setFilter('saved-street-segments-selected', filt); } catch {}
    }
  }

  // Build a zone summary from any Feature<Polygon>
  // typeFallback is used if the feature has no useType prop
  async function buildSummaryFromFeature(mapInstance, feature, typeFallback) {
    try {
      if (!mapInstance || !feature) return null;
      const geom = feature.geometry;
      if (!geom) return null;
      let polygonLike = null;
      if (geom.type === 'Polygon') {
        polygonLike = feature;
      } else if (geom.type === 'MultiPolygon') {
        // Use the largest polygon for summary stats
        let maxArea = -Infinity;
        let best = null;
        for (const coords of geom.coordinates) {
          const poly = turf.polygon(coords, feature.properties || {});
            const a = turf.area(poly);
            if (a > maxArea) { maxArea = a; best = poly; }
        }
        polygonLike = best;
      } else {
        // Not a polygonal feature
        return null;
      }
      if (!polygonLike) return null;

      const areaM2 = turf.area(polygonLike);
      const areaFt2 = convertToSquareFeet(areaM2);
      const centroidPt = turf.centroid(polygonLike).geometry.coordinates;
      const useType = feature.properties?.useType || typeFallback || 'mixed-use';

      // Reuse stored address if available, otherwise fetch (async)
      let address = feature.properties?.address || null;
      if (!address) {
        try {
          address = await reverseGeocode(centroidPt[0], centroidPt[1]);
        } catch {}
      }

      // Intersecting street names using existing helper
      let streets = [];
      try { streets = getIntersectingStreetNames(mapInstance, polygonLike); } catch { streets = []; }

      return {
        areaM2,
        areaFt2,
        centroid: centroidPt,
        address,
        streets,
        useType,
      };
    } catch (err) {
      console.warn('buildSummaryFromFeature failed:', err);
      return null;
    }
  }

  // Pick the closest drivable road line at the click
  function pickClosestRoadLineAtClick(mapInstance, e) {
    const layerIds = getRoadLineLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;
    const radiusPx = 60;
    const box = [[e.point.x - radiusPx, e.point.y - radiusPx],[e.point.x + radiusPx, e.point.y + radiusPx]];
    const pt = turf.point([e.lngLat.lng, e.lngLat.lat]);

    const candidates = (mapInstance.queryRenderedFeatures(box, opts) || [])
      .flatMap(explodeToLineStrings)
      .filter(f => isDrivableRoad(f.properties));

    let best = null, bestD = Infinity;
    for (const lf of candidates) {
      try {
        const d = turf.pointToLineDistance(pt, lf, { units: "meters" });
        if (d < bestD) { bestD = d; best = lf; }
      } catch {}
    }
    return best;
  }

  // Merge pieces of the same way/name into one long line
  // Minimal pathfinding: build graph from visible drivable segments and find shortest path
  function findShortestRoadPath(mapInstance, startPt, endPt) {
    // Get all visible drivable road segments
    const roadLayerIds = getRoadLayerIds(mapInstance);
    const opts = roadLayerIds.length ? { layers: roadLayerIds } : undefined;
    let featuresRaw = [];
    try {
      featuresRaw = mapInstance.queryRenderedFeatures(opts);
    } catch (err) {
      return null;
    }
    // Get all drivable road segments as LineStrings
    const segments = featuresRaw.flatMap(explodeToLineStrings).filter(f => isDrivableRoad(f.properties));
      // ...existing code...

      // Snap start/end to nearest segment
      function snapToSegment(pt) {
        let best = null, bestDist = Infinity, bestSeg = null, bestIdx = null;
        segments.forEach(f => {
          let coords = f.geometry.type === "LineString" ? f.geometry.coordinates : [].concat(...f.geometry.coordinates);
          const snapped = turf.nearestPointOnLine(turf.lineString(coords), turf.point(pt), {units: "meters"});
          if (snapped.properties.dist < bestDist) {
            bestDist = snapped.properties.dist;
            best = snapped.geometry.coordinates;
            bestSeg = coords;
            bestIdx = snapped.properties.index;
          }
        });
        return best ? { point: best, seg: bestSeg, idx: bestIdx } : null;
      }

      const startSnap = snapToSegment(startPt);
      const endSnap = snapToSegment(endPt);
    // ...existing code...
    const nodes = new Map(); // key: stringified [lng,lat], value: array of connected nodes
    const edges = new Map(); // key: nodeA|nodeB, value: segment
    segments.forEach(seg => {
      const coords = seg.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const a = coords[i], b = coords[i + 1];
        const aKey = a.join(","), bKey = b.join(",");
        if (!nodes.has(aKey)) nodes.set(aKey, []);
        if (!nodes.has(bKey)) nodes.set(bKey, []);
        nodes.get(aKey).push(bKey);
        nodes.get(bKey).push(aKey);
        edges.set(`${aKey}|${bKey}`, [a, b]);
        edges.set(`${bKey}|${aKey}`, [b, a]);
      }
    });
    // Snap start/end to nearest point on any segment
    function nearestPointOnSegments(pt) {
      let minDist = Infinity, best = null, bestSeg = null;
      for (const seg of segments) {
        const line = turf.lineString(seg.geometry.coordinates);
        const snapped = turf.nearestPointOnLine(line, turf.point(pt), { units: "meters" });
        if (snapped.properties.dist < minDist) {
          minDist = snapped.properties.dist;
          best = snapped.geometry.coordinates;
          bestSeg = seg;
        }
      }
      return { coord: best, seg: bestSeg };
    }
    // Helper: Snap to nearest point on any segment
    function nearestPointOnSegments(pt) {
      let best = null, bestDist = Infinity, bestSeg = null, bestIdx = null;
      segments.forEach(f => {
        let coords = f.geometry.type === "LineString" ? f.geometry.coordinates : [].concat(...f.geometry.coordinates);
        const snapped = turf.nearestPointOnLine(turf.lineString(coords), turf.point(pt), {units: "meters"});
        if (snapped.properties.dist < bestDist) {
          bestDist = snapped.properties.dist;
          best = snapped.geometry.coordinates;
          bestSeg = coords;
          bestIdx = snapped.properties.index;
        }
      });
      return best ? { point: best, seg: bestSeg, idx: bestIdx } : null;
    }
    // Only one correct declaration of startSnap and endSnap should exist in this function
    if (!startSnap.coord || !endSnap.coord) return null;
    // Insert snapped points as temporary nodes
    const startKey = startSnap.coord.join(",");
    const endKey = endSnap.coord.join(",");
    // Connect snapped start to its segment endpoints
    if (startSnap.seg) {
      const coords = startSnap.seg.geometry.coordinates;
      const aKey = coords[0].join(","), bKey = coords[coords.length - 1].join(",");
      if (!nodes.has(startKey)) nodes.set(startKey, []);
      nodes.get(startKey).push(aKey);
      nodes.get(aKey).push(startKey);
      nodes.get(startKey).push(bKey);
      nodes.get(bKey).push(startKey);
      edges.set(`${startKey}|${aKey}`, [startSnap.coord, coords[0]]);
      edges.set(`${aKey}|${startKey}`, [coords[0], startSnap.coord]);
      edges.set(`${startKey}|${bKey}`, [startSnap.coord, coords[coords.length - 1]]);
      edges.set(`${bKey}|${startKey}`, [coords[coords.length - 1], startSnap.coord]);
    }
    // Connect snapped end to its segment endpoints
    if (endSnap.seg) {
      const coords = endSnap.seg.geometry.coordinates;
      const aKey = coords[0].join(","), bKey = coords[coords.length - 1].join(",");
      if (!nodes.has(endKey)) nodes.set(endKey, []);
      nodes.get(endKey).push(aKey);
      nodes.get(aKey).push(endKey);
      nodes.get(endKey).push(bKey);
      nodes.get(bKey).push(endKey);
      edges.set(`${endKey}|${aKey}`, [endSnap.coord, coords[0]]);
      edges.set(`${aKey}|${endKey}`, [coords[0], endSnap.coord]);
      edges.set(`${endKey}|${bKey}`, [endSnap.coord, coords[coords.length - 1]]);
      edges.set(`${bKey}|${endKey}`, [coords[coords.length - 1], endSnap.coord]);
    }
    // Dijkstra's algorithm
    const visited = new Set();
    const prev = new Map();
    const dist = new Map();
    for (const key of nodes.keys()) dist.set(key, Infinity);
    dist.set(startKey, 0);
    const queue = [startKey];
    while (queue.length) {
      queue.sort((a, b) => dist.get(a) - dist.get(b));
      const cur = queue.shift();
      if (cur === endKey) break;
      visited.add(cur);
      for (const neighbor of nodes.get(cur) || []) {
        if (visited.has(neighbor)) continue;
        const seg = edges.get(`${cur}|${neighbor}`);
        if (!seg) continue;
        const segLen = turf.length(seg, { units: 'meters' });
        const alt = dist.get(cur) + segLen;
        if (alt < dist.get(neighbor)) {
          dist.set(neighbor, alt);
          prev.set(neighbor, cur);
          queue.push(neighbor);
        }
      }
    }
    // Reconstruct path
    let path = [];
    let cur = endKey;
    while (cur && prev.has(cur)) {
      const prevKey = prev.get(cur);
      const seg = edges.get(`${prevKey}|${cur}`);
      if (seg) path.unshift(seg);
      cur = prevKey;
    }
    // If path is empty, fallback to direct line
    if (!path.length) {
      return null;
    }
    // Flatten path segments, slicing first/last for exact start/end
    let coords = [];
    for (let i = 0; i < path.length; i++) {
      let segCoords = path[i].geometry.coordinates;
      // For first segment, snap start
      if (i === 0) segCoords[0] = startPt;
      // For last segment, snap end
      if (i === path.length - 1) segCoords[segCoords.length - 1] = endPt;
      // Avoid duplicate points between segments
      if (i > 0 && coords.length && coords[coords.length - 1][0] === segCoords[0][0] && coords[coords.length - 1][1] === segCoords[0][1]) {
        segCoords = segCoords.slice(1);
      }
      coords.push(...segCoords);
    }
    return turf.lineString(coords);
  }

  // Stitch together all connected drivable roads of the same way/name as baseLine
  function stitchClickedRoad(mapInstance, baseLine) {
    const layerIds = getRoadLineLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;

    const all = (mapInstance.queryRenderedFeatures(opts) || [])
      .flatMap(explodeToLineStrings)
      .filter(f => isDrivableRoad(f.properties));

    const idKeys = ["osm_id","osm_way_id","id"];
    const getId = (p={}) => idKeys.map(k => p[k]).find(v => v != null);
    const baseId = getId(baseLine.properties);
    const baseName = streetNameFromProps(baseLine.properties);

      let featuresRaw = [];
      try {
        featuresRaw = m.queryRenderedFeatures(box, { layers: roadLayerIds });
      } catch (err) {
        console.warn('queryRenderedFeatures failed:', err);
        return null;
      }
      console.log('Candidate features from queryRenderedFeatures:', featuresRaw);
      featuresRaw.forEach((f, i) => {
        console.log(`Feature #${i} layer.id:`, f.layer?.id, 'properties:', f.properties);
      });
      featuresRaw.forEach((f, i) => {
        console.log(`Feature #${i} properties:`, f.properties);
        if (f.geometry?.type === "LineString") {
          const coords0 = baseLine.geometry?.coordinates?.[0];
          if (coords0) {
            const pt = turf.point(coords0);
            const line = turf.lineString(f.geometry.coordinates);
            const snapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
            console.log(`Feature #${i} snapped distance:`, snapped.properties.dist);
          }
        }
      });
      // Filter only drivable roads
      const features = featuresRaw.filter(f => f.geometry?.type === "LineString" && isDrivableRoad(f.properties));
      const coords0 = baseLine.geometry?.coordinates?.[0];
      const pt = coords0 ? turf.point(coords0) : null;
      let best = null, bestDist = Infinity;
  }

  // Split the stitched line by all intersecting block-bounding roads
  function sliceOneBlockBySplitting(mapInstance, stitchedLine, e) {
    const layerIds = getRoadLineLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;

    // Query a generous neighborhood
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(stitchedLine);
    const p1 = mapInstance.project([minLng, minLat]);
    const p2 = mapInstance.project([maxLng, maxLat]);
    const zoom = mapInstance.getZoom();
    const padPx = Math.max(160, Math.min(320, 28 * (zoom - 7)));
    const box = [
      [Math.min(p1.x, p2.x) - padPx, Math.min(p1.y, p2.y) - padPx],
      [Math.max(p1.x, p2.x) + padPx, Math.max(p1.y, p2.y) + padPx],
    ];

    let world = (mapInstance.queryRenderedFeatures(box, opts) || [])
      .flatMap(explodeToLineStrings)
      .filter((f) => isBlockBoundingRoad(f.properties));

    if (!world.length) {
      world = (mapInstance.queryRenderedFeatures(opts) || [])
        .flatMap(explodeToLineStrings)
        .filter((f) => isBlockBoundingRoad(f.properties));
    }

    // Sequentially split the stitched line by each neighbor
    let frags = [stitchedLine];
    for (const nb of world) {
      const next = [];
      for (const frag of frags) {
        try {
          const out = turf.lineSplit(frag, nb);
          if (out?.features?.length) next.push(...out.features);
          else next.push(frag);
        } catch {
          next.push(frag);
        }
      }
      frags = next;
    }

    // Pick the fragment closest to the click
    const clickPt = turf.point([e.lngLat.lng, e.lngLat.lat]);
    frags.sort(
      (a, b) =>
        turf.pointToLineDistance(clickPt, a, { units: "meters" }) -
        turf.pointToLineDistance(clickPt, b, { units: "meters" })
    );
    return frags[0] || null;
  }

  // More robust: find intersections (exact or approximate) and slice between them  
  function sliceBetweenIntersections(mapInstance, stitchedLine, e) {
    const layerIds = getRoadLineLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;

    const [minLng, minLat, maxLng, maxLat] = turf.bbox(stitchedLine);
    const p1 = mapInstance.project([minLng, minLat]);
    const p2 = mapInstance.project([maxLng, maxLat]);
    const zoom = mapInstance.getZoom();
    const padPx = Math.max(160, Math.min(320, 28 * (zoom - 7)));
    const box = [
      [Math.min(p1.x, p2.x) - padPx, Math.min(p1.y, p2.y) - padPx],
      [Math.max(p1.x, p2.x) + padPx, Math.max(p1.y, p2.y) + padPx],
    ];

    const pull = (predicate) =>
      (mapInstance.queryRenderedFeatures(box, opts) || [])
        .flatMap(explodeToLineStrings)
        .filter((f) => predicate(f.properties));

    // 1) exact intersections with block-bounding roads
    let world = pull(isBlockBoundingRoad);

    // Fallback #1: whole viewport if the bbox is empty
    if (!world.length) {
      world = (mapInstance.queryRenderedFeatures(opts) || [])
        .flatMap(explodeToLineStrings)
        .filter((f) => isBlockBoundingRoad(f.properties));
    }

    const baseName = streetNameFromProps(stitchedLine.properties);
    const idKeys = ["osm_id", "osm_way_id", "id"];
    const sameWay = (a, b) =>
      idKeys.some((k) => a?.properties?.[k] != null && a.properties[k] === b?.properties?.[k]);

    let intersections = [];
    for (const nb of world) {
      const sameName = baseName && streetNameFromProps(nb.properties) === baseName;
      if (sameWay(nb, stitchedLine) || sameName) continue;
      try {
        const ints = turf.lineIntersect(stitchedLine, nb);
        for (const f of ints.features || []) {
          intersections.push(turf.nearestPointOnLine(stitchedLine, f));
        }
      } catch {}
    }

    // Fallback #2: try drivable roads if exact hits are scarce
    const needApprox = intersections.length < 2;
    if (needApprox) {
      const world2 = pull(isDrivableRoad);
      const GAP_M = 8; // treat close-but-not-touching as connected
      for (const nb of world2) {
        if (sameWay(nb, stitchedLine)) continue;
        // test both ends; if close, project onto stitched line
        for (const end of [nb.geometry.coordinates[0], nb.geometry.coordinates.at(-1)]) {
          const proj = turf.nearestPointOnLine(stitchedLine, turf.point(end));
          const d = proj.properties?.dist ?? turf.distance(turf.point(end), proj, { units: "meters" });
          if (d <= GAP_M) intersections.push(proj);
        }
      }
    }

    // Always include ends as guards
    const coords = stitchedLine.geometry.coordinates;
    intersections.push(turf.point(coords[0]), turf.point(coords[coords.length - 1]));

    // Distance along line from start
    const start = turf.point(coords[0]);
    const distAlong = (pt) =>
      turf.length(turf.lineSlice(start, pt, stitchedLine), { units: "meters" });

    // Deduplicate & sort; filter micro-gaps (crosswalk junk)
    const seen = new Set();
    let measures = intersections
      .map((pt) => {
        const key = pt.geometry.coordinates.map((c) => +c.toFixed(7)).join(",");
        if (seen.has(key)) return null;
        seen.add(key);
        return { pt, m: distAlong(pt) };
      })
      .filter(Boolean)
      .sort((a, b) => a.m - b.m);

    const MIN_GAP_M = 12;
    measures = measures.filter((cur, i, arr) => i === 0 || cur.m - arr[i - 1].m >= MIN_GAP_M);

    // Use neighbors around the click
    const clickM = distAlong(
      turf.nearestPointOnLine(stitchedLine, turf.point([e.lngLat.lng, e.lngLat.lat]))
    );
    let before = measures[0], after = measures[measures.length - 1];
    for (const cur of measures) {
      if (cur.m <= clickM) before = cur;
      if (cur.m >= clickM) { after = cur; break; }
    }
    if (before.m === after.m) {
      const idx = measures.findIndex((x) => x.m === before.m);
      if (idx > 0) before = measures[idx - 1];
      if (idx < measures.length - 1) after = measures[idx + 1];
    }

    try {
      let sliced = turf.lineSlice(before.pt, after.pt, stitchedLine);

      // Fallback #3: if insanely long (e.g., intersections still missing), clamp to ~1 block
      const MAX_BLOCK_M = 260;
      const len = turf.length(sliced, { units: "meters" });
      if (len > MAX_BLOCK_M) {
        const center = turf.nearestPointOnLine(
          stitchedLine,
          turf.point([e.lngLat.lng, e.lngLat.lat])
        );
        const half = MAX_BLOCK_M / 2;
        const forward = turf.along(stitchedLine, Math.max(0, clickM + half), { units: "meters" });
        const back = turf.along(stitchedLine, Math.max(0, clickM - half), { units: "meters" });
        sliced = turf.lineSlice(back, forward, stitchedLine);
      }

      return sliced;
    } catch {
      return null;
    }
  }

  // From the two slicing heuristics, pick the best candidate segment
  // and clamp to reasonable lengths if needed
  function pickBestBlockSegment(mapInstance, stitchedLine, e) {
    const a = sliceOneBlockBySplitting(mapInstance, stitchedLine, e);
    const b = sliceBetweenIntersections(mapInstance, stitchedLine, e);

    const cand = [a, b].filter(Boolean);
    if (!cand.length) return null;

    const lenM = (ln) => turf.length(ln, { units: "meters" });
    cand.sort((x, y) => lenM(x) - lenM(y));

    const MIN_M = 40;   // avoid tiny stubs (crosswalk slivers)
    const MAX_M = 230;  // typical city block upper bound

    // Prefer the shortest candidate in-range
    let best = cand.find(c => {
      const L = lenM(c);
      return L >= MIN_M && L <= MAX_M;
    }) || cand[0];

    // If still too long, clamp around the click point
    const L = lenM(best);
    if (L > MAX_M) {
      const click = turf.point([e.lngLat.lng, e.lngLat.lat]);
      const clickOn = turf.nearestPointOnLine(stitchedLine, click);
      const start = turf.point(stitchedLine.geometry.coordinates[0]);
      const mClick = turf.length(turf.lineSlice(start, clickOn, stitchedLine), { units: "meters" });
      const half = MAX_M / 2;
      const back = turf.along(stitchedLine, Math.max(0, mClick - half), { units: "meters" });
      const fwd  = turf.along(stitchedLine, mClick + half, { units: "meters" });
      best = turf.lineSlice(back, fwd, stitchedLine);
    }

    return best;
  }


  // Heuristic: public, drivable roads only (OSM + OpenMapTiles)
  function isDrivableRoad(p = {}) {
    const hw   = (p.highway || "").toLowerCase();
    const cls  = (p.class || p.kind || "").toLowerCase();
    const sub  = (p.subclass || "").toLowerCase();
    const svc  = (p.service || "").toLowerCase();
    const accs = [
      (p.access || "").toLowerCase(),
      (p.motor_vehicle || "").toLowerCase(),
      (p.motorcar || "").toLowerCase(),
      (p.vehicle || "").toLowerCase(),
    ];

    // Access restrictions
    if (accs.some(v => v === "no" || v === "private" || v === "destination")) return false;

    const ALLOW_HW = new Set([
      "motorway","trunk","primary","secondary","tertiary",
      "unclassified","residential","living_street",
      "motorway_link","trunk_link","primary_link","secondary_link","tertiary_link","road"
    ]);
    const DENY_HW = new Set([
      "service","track","path","footway","cycleway","pedestrian","steps",
      "corridor","bridleway","construction","raceway","proposed"
    ]);
    const ALLOW_CLASS = new Set([
      "motorway","trunk","primary","secondary","tertiary",
      "minor","residential","living_street","street","link"
    ]);

    if (DENY_HW.has(hw)) return false;
    if (cls === "service" || sub === "service") return false;

    if (ALLOW_HW.has(hw)) return true;
    if (ALLOW_CLASS.has(cls)) return true;
    return false;
  }

  // REMOVE: useEffect for segmentMode and segmentWidthMeters (onClick handler for segment selection)

  // --- effects ----------------------------------------------------

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: maptilerStyles[basemapStyle],
      center: [-122.422, 37.7749],
      zoom: 15,
    });

    map.current.addControl(new maplibregl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      ensureSourcesAndLayers(map.current);
      refreshMapData(map.current, drawnCoords, useType, savedZones);
      applySelectedFilter(map.current, selectedSavedIndex);
    });
  }, []);

  // Style switch restore
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(maptilerStyles[basemapStyle]);

    // Wait for the new style to finish loading sources/layers
    map.current.once("styledata", () => {
      ensureSourcesAndLayers(map.current);
      refreshMapData(map.current, drawnCoords, useType, savedZones);
      applySelectedFilter(map.current, selectedSavedIndex);
      // ensure street layers match current tool
  const visStreets = activeTool === 'street' ? 'visible' : 'none';
      ["street-selections-line","street-selections-casing","street-buffer-fill","street-buffer-outline"]
      .forEach(id => map.current.getLayer(id) && map.current.setLayoutProperty(id, "visibility", visStreets));
    });
  }, [basemapStyle]);

  // Repaint saved zones if the list changes
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
    // Clear selection if index is now out of range
    setSelectedSavedIndex((idx) =>
      idx != null && idx < savedZones.length ? idx : null
    );
  }, [savedZones]);

  // Apply highlight when selection changes
  useEffect(() => {
    if (!map.current) return;
    applySelectedFilter(map.current, selectedSavedIndex);
  }, [selectedSavedIndex]);

  // Auto-open sidebar when selecting a saved zone
  useEffect(() => {
    if (selectedSavedIndex != null) setSidebarVisible(true);
  }, [selectedSavedIndex]);

  // Handle clicks in draw mode
  useEffect(() => {
    if (!map.current) return;

    const handleMapClick = (e) => {
      if (!drawMode) return;
      const lngLat = [e.lngLat.lng, e.lngLat.lat];
      setDrawnCoords((prev) => [...prev, lngLat]);
    };

    map.current.on("click", handleMapClick);
    return () => map.current && map.current.off("click", handleMapClick);
  }, [drawMode]);

  // Click on saved zones to select
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;

    const onClickSaved = (e) => {
      // Prevent selecting a different zone while editing geometry of another
      if (editingSavedIndex != null) return;
      const f = e.features?.[0];
      if (!f) return;
      const idx = f.properties?.__sid;
      if (typeof idx === "number") {
        setSelectedSavedIndex(idx);
        applySelectedFilter(m, idx);
        // Also fly to the zone on map-click
        const feature = savedZones[idx];
        if (feature) flyToSaved(feature);
      }
    };

    m.on("click", "saved-zones-fill", onClickSaved);

    return () => {
      m.off("click", "saved-zones-fill", onClickSaved);
    };
  }, [savedZones, editingSavedIndex, basemapStyle]);

  // Enter/exit draw mode housekeeping
  useEffect(() => {
    if (!map.current) return;
    const mapRef = map.current;

    if (!drawMode) {
      setDrawnCoords([]);
      setZoneSummary(null);
      setShowSavePanel(false);
      setEditingSavedIndex(null);
      setSummaryContext(null);
      refreshMapData(mapRef, [], useType, savedZones);
    } else {
      // Entering draw mode: keep summaryContext as set by loadSavedIntoDraw()
      setSelectedSavedIndex(null);
      setShowHelpBox(true);
    }
  }, [drawMode]);

  // Keep drawMode in sync with active tool & clear when switching away
  useEffect(() => {
    const polygonSelected = activeTool === 'polygon';
    setDrawMode(polygonSelected);
    if (!polygonSelected) {
      // Clear any in-progress polygon when leaving polygon tool
      setDrawnCoords([]);
      setZoneSummary(null);
      setShowSavePanel(false);
      setEditingSavedIndex(null);
      setSummaryContext(null);
    }
    // If switching away from street tool, cleanup points/line
    if (activeTool !== 'street') {
      setStartPoint(null);
      setEndPoint(null);
      if (map.current) {
        const m = map.current;
        if (m.getLayer('selected-road-segment-layer')) m.removeLayer('selected-road-segment-layer');
        if (m.getSource('selected-road-segment')) m.removeSource('selected-road-segment');
        if (m.getLayer('start-end-points-layer')) m.removeLayer('start-end-points-layer');
        if (m.getSource('start-end-points')) m.removeSource('start-end-points');
      }
      setStreetPathLengthM(null);
    }
  }, [activeTool]);

  // Render updates when coords change
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
  }, [drawnCoords]);

  // Recolor in-progress polygon immediately when Type changes
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
  }, [useType]);

  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
  }, [savedStreetSegments, selectedStreetSegmentIndex]);

  // Point drag + delete
  useEffect(() => {
    if (!map.current) return;

    const mapRef = map.current;
    let isDragging = false;
    let dragIndex = null;
    let coordsRef = [...drawnCoords];

    const handleMouseDown = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;
      dragIndex = feature.properties.id;
      isDragging = true;
      mapRef.getCanvas().style.cursor = "grabbing";
      mapRef.dragPan.disable();
    };

    const handleMouseMove = (e) => {
      if (!isDragging || dragIndex === null) return;
      const { lng, lat } = e.lngLat;
      coordsRef[dragIndex] = [lng, lat];
      refreshMapData(mapRef, coordsRef, useType, savedZones);
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      dragIndex = null;
      setDrawnCoords(coordsRef);
      coordsRef = [...coordsRef];
      mapRef.getCanvas().style.cursor = "";
      mapRef.dragPan.enable();
    };

    const handleRightClick = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;
      const idToRemove = feature.properties.id;
      const updated = [...drawnCoords];
      updated.splice(idToRemove, 1);
      setDrawnCoords(updated);
      e.preventDefault();
    };

    mapRef.on("mousedown", "drawn-points-layer", handleMouseDown);
    mapRef.on("mousemove", handleMouseMove);
    mapRef.on("mouseup", "drawn-points-layer", handleMouseUp);
    mapRef.on("contextmenu", "drawn-points-layer", handleRightClick);

    return () => {
      mapRef.off("mousedown", "drawn-points-layer", handleMouseDown);
      mapRef.off("mousemove", handleMouseMove);
      mapRef.off("mouseup", "drawn-points-layer", handleMouseUp);
      mapRef.off("contextmenu", "drawn-points-layer", handleRightClick);
    };
  }, [drawnCoords, useType, savedZones]);

  // Build Zone Summary when polygon has 3+ points (drawing)
  useEffect(() => {
    if (!map.current || drawnCoords.length < 3) return;

    const closed = [...drawnCoords, drawnCoords[0]];
    const poly = turf.polygon([closed], { useType });

    const areaM2 = turf.area(poly);
    const areaFt2 = convertToSquareFeet(areaM2);

    const centroidPt = turf.centroid(poly).geometry.coordinates; // [lng, lat]

    const streets = getIntersectingStreetNames(map.current, poly);

    reverseGeocode(centroidPt[0], centroidPt[1]).then((addr) => {
      setZoneSummary({
        areaM2,
        areaFt2,
        centroid: centroidPt,
        address: addr,
        streets,
        useType,
      });
      setSummaryContext("draw");
    });
  }, [drawnCoords, useType]);

  // Compute summary when a saved zone is selected
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    // Don’t rebuild from "saved" while we’re editing
    if (drawMode && editingSavedIndex != null) return;

    if (selectedSavedIndex == null) {
      if (!drawMode) {
        setZoneSummary(null);
        setSummaryContext(null);
      }
      return;
    }

    const f = savedZones[selectedSavedIndex];
    if (!f) return;

    const build = async () => {
      const summary = await buildSummaryFromFeature(
        m,
        f,
        f?.properties?.useType
      );
      if (summary) {
        setZoneSummary(summary);
        setSummaryContext("saved");
      }
    };

    // If the map is still moving (from flyTo), wait until it settles
    if (m.isMoving()) {
      const onIdle = () => {
        m.off("idle", onIdle);
        build();
      };
      m.on("idle", onIdle);
    } else {
      build();
    }
  }, [selectedSavedIndex, savedZones, drawMode, editingSavedIndex]);

  // Keep street sources in sync initially and after style change
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
  }, []);

  // When width or selection changes, repaint buffer
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
  }, [drawnCoords, useType]);

  // [START/END SEGMENT SELECTION] handle clicks
  useEffect(() => {
    console.log('startEndMode changed:', startEndMode);
    if (!map.current) return;
    if (!startEndMode) return;
    const m = map.current;

    // Helper: Snap to nearest point on any road (LineString)
    function getNearestRoadPoint(lngLat) {
      // Use a generous pixel box around the click for candidate roads
      const projected = m.project([lngLat.lng, lngLat.lat]);
      if (!projected || typeof projected.x !== 'number' || typeof projected.y !== 'number') {
        console.warn('Map.project returned invalid value for', lngLat, projected);
        return [lngLat.lng, lngLat.lat];
      }
      const radiusPx = 60;
      const box = [
        [projected.x - radiusPx, projected.y - radiusPx],
        [projected.x + radiusPx, projected.y + radiusPx]
      ];
      const roadLayerIds = getRoadLayerIds(m);
      console.log('getRoadLayerIds:', roadLayerIds);

      let featuresRaw = [];
      try {
        featuresRaw = m.queryRenderedFeatures(box, { layers: roadLayerIds });
      } catch (err) {
        console.warn('queryRenderedFeatures failed:', err);
        return [lngLat.lng, lngLat.lat];
      }
      console.log('Candidate features from queryRenderedFeatures:', featuresRaw);
    featuresRaw.forEach((f, i) => {
      const isDrivable = isDrivableRoad(f.properties);
      let snappedDist = "N/A";
      if (f.geometry?.type === "LineString") {
        const pt = turf.point([lngLat.lng, lngLat.lat]);
        const line = turf.lineString(f.geometry.coordinates);
        const snapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
        snappedDist = snapped.properties.dist;
      } else if (f.geometry?.type === "MultiLineString") {
        const pt = turf.point([lngLat.lng, lngLat.lat]);
        let minDist = Infinity;
        let bestSnapped = null;
        f.geometry.coordinates.forEach((coords, segIdx) => {
          const line = turf.lineString(coords);
          const snapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
          if (snapped.properties.dist < minDist) {
            minDist = snapped.properties.dist;
            bestSnapped = snapped;
          }
          console.log(`Feature #${i} segment #${segIdx} snapped distance: ${snapped.properties.dist}`);
        });
        if (bestSnapped) {
          snappedDist = bestSnapped.properties.dist;
        }
      }
      console.log(`Feature #${i} layer.id: ${f.layer?.id} isDrivable: ${isDrivable} snapped distance: ${snappedDist} geometry.type: ${f.geometry?.type} properties:`, f.properties);
      if (f.geometry?.type !== "LineString") {
        console.log(`Feature #${i} full object:`, f);
      }
    });

    // Filter only drivable roads
    const features = featuresRaw.filter(f => (f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString") && isDrivableRoad(f.properties));
    const pt = turf.point([lngLat.lng, lngLat.lat]);
    let best = null, bestDist = Infinity;
    // Detailed logging for each drivable candidate
    for (const feat of features) {
      let snapped = null;
      let dist = null;
      if (feat.geometry?.type === "LineString") {
        const line = turf.lineString(feat.geometry.coordinates);
        snapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
        dist = snapped.properties.dist;
      } else if (feat.geometry?.type === "MultiLineString") {
        let minDist = Infinity;
        let bestSnapped = null;
        feat.geometry.coordinates.forEach((coords, segIdx) => {
          const line = turf.lineString(coords);
          const segSnapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
          if (segSnapped.properties.dist < minDist) {
            minDist = segSnapped.properties.dist;
            bestSnapped = segSnapped;
          }
        });
        snapped = bestSnapped;
        dist = minDist;
      }
      console.log('Drivable candidate:', {
        snappedDistance: dist,
        snappedCoords: snapped?.geometry?.coordinates,
        clickCoords: [lngLat.lng, lngLat.lat],
        properties: feat.properties
      });
      if (dist !== null && dist < bestDist) {
        bestDist = dist;
        best = snapped.geometry.coordinates;
      }
    }
    // Only snap if within 80 meters (TEMPORARY for debugging)
    if (best && bestDist <= 80) {
      return best;
    } else {
      console.warn('No drivable road within 30 meters of click:', lngLat);
      return null;
    }
    }

    const handleStartEndClick = (e) => {
      const lngLat = e.lngLat;
      const snapped = getNearestRoadPoint(lngLat);
      if (!snapped) {
        // Optionally show a warning to the user here
        console.warn('Click ignored: no drivable road nearby');
        return;
      }
      if (!startPoint) {
        setStartPoint(snapped);
        console.log('Start point:', JSON.stringify(snapped));
      } else if (!endPoint) {
        setEndPoint(snapped);
        console.log('End point:', JSON.stringify(snapped));
      } else {
        // Clear previous line and points before starting new selection
        const m = map.current;
        if (m) {
          if (m.getLayer('selected-road-segment-layer')) m.removeLayer('selected-road-segment-layer');
          if (m.getSource('selected-road-segment')) m.removeSource('selected-road-segment');
          if (m.getLayer('start-end-points-layer')) m.removeLayer('start-end-points-layer');
          if (m.getSource('start-end-points')) m.removeSource('start-end-points');
        }
        setStartPoint(snapped);
        setEndPoint(null);
  console.log('Resetting selection, new start:', JSON.stringify(snapped));
      }
    };

    m.on("click", handleStartEndClick);
    return () => m.off("click", handleStartEndClick);
  }, [startEndMode, startPoint, endPoint]);

  // [START/END SEGMENT SELECTION] Visual feedback + extended drag (can lengthen path)
  useEffect(() => {
    if (!map.current) return;
    if (!startEndMode) return;
    const m = map.current;
    if (!m.getSource('start-end-points')) {
      m.addSource('start-end-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      m.addLayer({
        id: 'start-end-points-layer',
        type: 'circle',
        source: 'start-end-points',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'type'], 'start', '#28a745', 'end', '#ffc107', '#888'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });
    }
    function updatePoints(temp) {
      const s = temp?.start ?? startPoint;
      const e = temp?.end ?? endPoint;
      const features = [];
      if (s) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: s }, properties: { type: 'start' } });
      if (e) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: e }, properties: { type: 'end' } });
      try { m.getSource('start-end-points').setData({ type: 'FeatureCollection', features }); } catch {}
    }
    updatePoints();

    let isDragging = false;
    let dragType = null; // 'start' | 'end'
    let pending = null;
    let lastTs = 0;
    const original = { start: startPoint, end: endPoint };

    function snapToRoad(lng, lat) {
      const roadLayerIds = getRoadLayerIds(m);
      const opts = roadLayerIds.length ? { layers: roadLayerIds } : undefined;
      const pt = turf.point([lng, lat]);
      const proj = m.project([lng, lat]);
      // adaptive radius grows as you drag outward
      let distPx = 0;
      if (dragType && original[dragType]) {
        const op = m.project(original[dragType]);
        distPx = Math.hypot(op.x - proj.x, op.y - proj.y);
      }
      const r = Math.min(320, 90 + distPx * 0.45);
      let feats = [];
      try { feats = m.queryRenderedFeatures([[proj.x - r, proj.y - r],[proj.x + r, proj.y + r]], opts); } catch {}
      const lines = feats
        .flatMap(explodeToLineStrings)
        .filter(f => f.geometry?.type === 'LineString' && isDrivableRoad(f.properties));
      if (!lines.length) return null;
      let best = null; let bestDist = Infinity;
      for (const ln of lines) {
        try {
          const snapped = turf.nearestPointOnLine(ln, pt, { units: 'meters' });
          if (snapped && snapped.properties.dist < bestDist) {
            bestDist = snapped.properties.dist;
            best = snapped.geometry.coordinates;
          }
        } catch {}
      }
      if (best && bestDist < 130) return best;
      return null;
    }

    function onMouseDown(e) {
      if (!e.features?.length) return;
      const f = e.features[0];
      if (f.layer.id !== 'start-end-points-layer') return;
      dragType = f.properties?.type;
      if (!dragType) return;
      isDragging = true;
      m.getCanvas().style.cursor = 'grabbing';
      m.dragPan.disable();
    }
    function onMouseMove(e) {
      if (!isDragging || !dragType) return;
      const now = performance.now();
      if (now - lastTs < 33) return; // throttle ~30fps
      lastTs = now;
      const snapped = snapToRoad(e.lngLat.lng, e.lngLat.lat);
      if (snapped) {
        pending = snapped;
        if (dragType === 'start') updatePoints({ start: pending }); else updatePoints({ end: pending });
      }
    }
    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      m.getCanvas().style.cursor = '';
      m.dragPan.enable();
      if (pending && dragType) {
        if (dragType === 'start') setStartPoint(pending); else setEndPoint(pending);
        // If both endpoints exist after this update, request an explicit path recompute
        setTimeout(() => {
          const hasBoth = (dragType === 'start' ? pending : startPoint) && (dragType === 'end' ? pending : endPoint);
          if (hasBoth && recomputeStreetPathRef.current) {
            recomputeStreetPathRef.current();
          }
        }, 0);
      }
      pending = null;
      dragType = null;
      updatePoints();
    }
    m.on('mousedown', 'start-end-points-layer', onMouseDown);
    m.on('mousemove', onMouseMove);
    m.on('mouseup', onMouseUp);
    return () => {
      m.off('mousedown', 'start-end-points-layer', onMouseDown);
      m.off('mousemove', onMouseMove);
      m.off('mouseup', onMouseUp);
    };
  }, [startEndMode, startPoint, endPoint]);

  // [START/END SEGMENT SELECTION] Highlight selected road segment and clear on exit
  useEffect(() => {
    // expose a stable recompute function via ref (even if early returns happen)
    recomputeStreetPathRef.current = () => setStreetPathNonce(n => n + 1);
    if (!map.current) return;
    const m = map.current;

    // Only remove highlight and start/end points when exiting start/end mode
    if (!startEndMode) {
      if (m.getLayer('selected-road-segment-layer')) {
        m.removeLayer('selected-road-segment-layer');
      }
      if (m.getLayer('selected-road-segment')) {
        m.removeLayer('selected-road-segment');
      }
      if (m.getSource('selected-road-segment')) {
        m.removeSource('selected-road-segment');
      }
      if (m.getLayer('start-end-points-layer')) {
        m.removeLayer('start-end-points-layer');
      }
      if (m.getSource('start-end-points')) {
        m.removeSource('start-end-points');
      }
  setStreetPathLengthM(null);
      return;
    }

    // Only highlight if both points are set and startEndMode is active
    if (startEndMode && startPoint && endPoint) {
      const t0 = performance.now();
      // Always snap both points to nearest road segment using all visible drivable roads
      const roadLayerIds = getRoadLayerIds(m);
      let featuresRaw = [];
      try {
        featuresRaw = m.queryRenderedFeatures({ layers: roadLayerIds });
      } catch (err) {
        console.error('Error querying rendered features:', err);
        return;
      }
      const t1 = performance.now();
      // Only drivable road segments
      const roadNetwork = featuresRaw.flatMap(feat => {
        if (feat.geometry?.type === "LineString" && isDrivableRoad(feat.properties)) {
          return [turf.lineString(feat.geometry.coordinates, feat.properties)];
        } else if (feat.geometry?.type === "MultiLineString" && isDrivableRoad(feat.properties)) {
          return feat.geometry.coordinates.map(coords => turf.lineString(coords, feat.properties));
        }
        return [];
      });
      // graph build & snapping timing occurs inside shortestPathOnNetwork; capture intermediate markers
      // Snap both points to the nearest road segment in the network
      function findNearestPointOnNetwork(point, network) {
        // Validate incoming point
        if (!point || !Array.isArray(point) || point.length < 2 || !isFinite(point[0]) || !isFinite(point[1])) {
          return point; // pass through; higher-level logic will fallback
        }
        let nearest = null;
        let minDist = Infinity;
        for (const line of network) {
          try {
            if (!line || line.geometry?.type !== 'LineString') continue;
            const coords = line.geometry.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;
            // Basic coordinate sanity (first & last)
            const first = coords[0];
            if (!first || first.length < 2 || !isFinite(first[0]) || !isFinite(first[1])) continue;
            const snapped = turf.nearestPointOnLine(line, turf.point(point), { units: 'meters' });
            if (!snapped || !snapped.geometry?.coordinates) continue;
            const dist = snapped.properties?.dist;
            if (typeof dist !== 'number' || !isFinite(dist)) continue;
            if (dist < minDist) {
              minDist = dist;
              nearest = snapped.geometry.coordinates;
            }
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[snap] skipped line due to error', e);
          }
        }
        return nearest || point;
      }
      const startSnapped = findNearestPointOnNetwork(startPoint, roadNetwork);
      const endSnapped = findNearestPointOnNetwork(endPoint, roadNetwork);
      const t2 = performance.now();

      // Build a graph of road vertices and compute the shortest path along roads
      function coordKey(c) {
        // reduce floating noise so vertices merge reliably
        return `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
      }
      function edgePenalty(a, b) {
        // Prefer car roads over paths; if any endpoint looks like a path segment vertex, add a small penalty
        // We don't have per-edge props here, so keep it minimal; distance dominates.
        return 0; // placeholder for future tuning if needed
      }
      function lineLen(coords) {
        try {
          const d = turf.length(turf.lineString(coords), { units: 'meters' });
          return d + edgePenalty(coords[0], coords[1]);
        } catch { return Infinity; }
      }
      function buildGraph(lines) {
        const adj = new Map(); // key -> [{ to, coords }]
        function ensure(k) { if (!adj.has(k)) adj.set(k, []); }
        for (const ln of lines) {
          const cs = ln.geometry.coordinates;
          for (let i = 0; i < cs.length - 1; i++) {
            const a = cs[i], b = cs[i + 1];
            const ka = coordKey(a), kb = coordKey(b);
            ensure(ka); ensure(kb);
            adj.get(ka).push({ to: kb, coords: [a, b] });
            adj.get(kb).push({ to: ka, coords: [b, a] });
          }
        }
        return adj;
      }
      function removeUndirectedEdge(graph, k1, k2) {
        if (!graph) return;
        if (graph.has(k1)) {
          const arr = graph.get(k1);
          graph.set(k1, arr.filter(e => e.to !== k2));
        }
        if (graph.has(k2)) {
          const arr = graph.get(k2);
          graph.set(k2, arr.filter(e => e.to !== k1));
        }
      }
      function nearestSnap(lines, pt) {
        let best = null;
        let bestLine = null;
        let bestIdx = null;
        let minD = Infinity;
        const target = turf.point(pt);
        for (const ln of lines) {
          try {
            const snapped = turf.nearestPointOnLine(ln, target, { units: 'meters' });
            if (snapped && snapped.properties.dist < minD) {
              minD = snapped.properties.dist;
              best = snapped.geometry.coordinates;
              bestLine = ln;
              bestIdx = snapped.properties.index ?? null; // index of segment start
            }
          } catch {}
        }
        return best ? { coord: best, line: bestLine, segIndex: bestIdx } : null;
      }
      function shortestPathOnNetwork(lines, a, b) {
        const graph = buildGraph(lines);
        if (!graph || graph.size === 0) return null;
        // Helper to attach a point sitting on a line's segment into the graph by splitting that segment
        function attachPointOnLine(g, ln, c) {
          try {
            const snap = turf.nearestPointOnLine(ln, turf.point(c));
            const idx = Math.min(Math.max(0, snap.properties.index ?? 0), ln.geometry.coordinates.length - 2);
            const A = ln.geometry.coordinates[idx];
            const B = ln.geometry.coordinates[idx + 1];
            const kA = coordKey(A), kB = coordKey(B), kC = coordKey(snap.geometry.coordinates);
            if (!g.has(kA)) g.set(kA, []);
            if (!g.has(kB)) g.set(kB, []);
            if (!g.has(kC)) g.set(kC, []);
            // remove the original A<->B so we truly split at C
            removeUndirectedEdge(g, kA, kB);
            // bi-directional connections
            g.get(kA).push({ to: kC, coords: [A, snap.geometry.coordinates] });
            g.get(kC).push({ to: kA, coords: [snap.geometry.coordinates, A] });
            g.get(kB).push({ to: kC, coords: [B, snap.geometry.coordinates] });
            g.get(kC).push({ to: kB, coords: [snap.geometry.coordinates, B] });
            return kC;
          } catch { return null; }
        }
        // Insert virtual nodes at true line intersections to improve connectivity
        for (let i = 0; i < lines.length; i++) {
          for (let j = i + 1; j < lines.length; j++) {
            try {
              const ints = turf.lineIntersect(lines[i], lines[j]);
              if (!ints?.features?.length) continue;
              for (const f of ints.features) {
                const c = f.geometry.coordinates;
                attachPointOnLine(graph, lines[i], c);
                attachPointOnLine(graph, lines[j], c);
              }
            } catch {}
          }
        }
        const s = nearestSnap(lines, a);
        const t = nearestSnap(lines, b);
        if (!s || !t) return null;

        // Fast path: if both snaps land on the exact same underlying line feature, just slice that line.
        // This prevents the "bounce" behavior where we remove the original A<->B edge twice and force
        // Dijkstra to route out toward an intersection and back when shortening a segment.
        try {
          if (s.line && t.line && s.line === t.line) {
            const sliceA = turf.nearestPointOnLine(s.line, turf.point(s.coord));
            const sliceB = turf.nearestPointOnLine(s.line, turf.point(t.coord));
            let sliced = turf.lineSlice(sliceA, sliceB, s.line);
            if (!sliced?.geometry?.coordinates || sliced.geometry.coordinates.length < 2) {
              // reverse order fallback
              sliced = turf.lineSlice(sliceB, sliceA, s.line);
              if (sliced?.geometry?.coordinates && sliced.geometry.coordinates.length >= 2) {
                // orient from start->end
                const first = sliced.geometry.coordinates[0];
                const d1 = turf.distance(turf.point(first), turf.point(s.coord));
                const d2 = turf.distance(turf.point(first), turf.point(t.coord));
                if (d2 < d1) sliced.geometry.coordinates = [...sliced.geometry.coordinates].reverse();
              }
            }
            if (sliced?.geometry?.coordinates && sliced.geometry.coordinates.length >= 2) {
              // eslint-disable-next-line no-console
              console.log('[street-path] fast-path same-line slice used', {
                sliceLenM: (()=>{ try { return turf.length(sliced,{units:'meters'}); } catch { return null; } })()
              });
              return sliced;
            }
          }
        } catch {}

        // Attach start/end to graph by connecting to the nearest segment endpoints
        const startK = coordKey(s.coord);
        const endK = coordKey(t.coord);
        if (!graph.has(startK)) graph.set(startK, []);
        if (!graph.has(endK)) graph.set(endK, []);

        // Direction helpers to bias progress toward end
        const dir = (p, q) => {
          const dx = q[0] - p[0];
          const dy = q[1] - p[1];
          const L = Math.hypot(dx, dy) || 1e-9;
          return [dx / L, dy / L];
        };
        const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
        const globalDir = dir(s.coord, t.coord);
        if (s.line && s.segIndex != null) {
          const cs = s.line.geometry.coordinates;
          const i = Math.min(Math.max(0, s.segIndex), cs.length - 2);
          const A = cs[i], B = cs[i + 1];
          const kA = coordKey(A), kB = coordKey(B);
          if (!graph.has(kA)) graph.set(kA, []);
          if (!graph.has(kB)) graph.set(kB, []);
          // Split the underlying edge A<->B at the snapped start; remove direct A<->B to avoid "go to A then back past start to B"
          removeUndirectedEdge(graph, kA, kB);
          // Allow both outward options from start to support valid initial turns
          graph.get(startK).push({ to: kA, coords: [s.coord, A] });
          graph.get(startK).push({ to: kB, coords: [s.coord, B] });
        }
        if (t.line && t.segIndex != null) {
          const cs = t.line.geometry.coordinates;
          const i = Math.min(Math.max(0, t.segIndex), cs.length - 2);
          const A = cs[i], B = cs[i + 1];
          const kA = coordKey(A), kB = coordKey(B);
          if (!graph.has(kA)) graph.set(kA, []);
          if (!graph.has(kB)) graph.set(kB, []);
          // Split the underlying edge A<->B at the snapped end; remove direct A<->B to avoid overshooting and coming back
          removeUndirectedEdge(graph, kA, kB);
          // Allow both incoming options into end
          graph.get(kA).push({ to: endK, coords: [A, t.coord] });
          graph.get(kB).push({ to: endK, coords: [B, t.coord] });
        }

        // Dijkstra
        const dist = new Map();
        const prev = new Map();
        const visited = new Set();
        const pq = new Set();
        for (const k of graph.keys()) { dist.set(k, Infinity); }
        dist.set(startK, 0);
        pq.add(startK);
        function popMin() {
          let best = null, bestD = Infinity;
          for (const k of pq) { const d = dist.get(k); if (d < bestD) { bestD = d; best = k; } }
          if (best != null) pq.delete(best);
          return best;
        }
        while (pq.size) {
          const u = popMin();
          if (u == null) break;
          if (u === endK) break;
          if (visited.has(u)) continue;
          visited.add(u);
          const edges = graph.get(u) || [];
          for (const e of edges) {
            const v = e.to;
            if (visited.has(v)) continue;
            const w = lineLen(e.coords);
            const alt = (dist.get(u) ?? Infinity) + w;
            if (alt < (dist.get(v) ?? Infinity)) {
              dist.set(v, alt);
              prev.set(v, { u, coords: e.coords });
              pq.add(v);
            }
          }
        }
        if (!prev.has(endK)) return null;
        // reconstruct path as list of coord segments
        const segs = [];
        let cur = endK;
        while (prev.has(cur)) {
          const { u, coords } = prev.get(cur);
          segs.unshift(coords);
          cur = u;
        }
        // flatten with direction correction and de-duplication
        const same = (a, b, eps = 1e-7) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
        const out = [];
        for (let s of segs) {
          let s0 = s[0], s1 = s[1];
          if (out.length) {
            const last = out[out.length - 1];
            if (same(last, s0)) {
              // correct orientation already
              out.push(s1);
            } else if (same(last, s1)) {
              // reverse to maintain continuity
              out.push(s0);
            } else {
              // discontinuity; start a new piece but avoid immediate backtrack spikes
              out.push(s0, s1);
            }
          } else {
            out.push(s0, s1);
          }
        }
        if (out.length < 2) return null;
        return turf.lineString(out);
      }

  let pathLine = shortestPathOnNetwork(roadNetwork, startSnapped, endSnapped);
  const t3_preFallback = performance.now();
      // Fallback: if pathLine is null, try to snap to the closest road segment between the snapped points
      if (!pathLine || !pathLine.geometry || !Array.isArray(pathLine.geometry.coordinates) || pathLine.geometry.coordinates.length < 2) {
        // Improved fallback: slice the closest road segment between the snapped points
        let bestSegment = null;
        let minDist = Infinity;
        let bestStartIdx = null;
        let bestEndIdx = null;
        for (const line of roadNetwork) {
          const coords = line.geometry.coordinates;
          let startIdx = -1, endIdx = -1;
          coords.forEach((c, idx) => {
            const dStart = turf.distance(turf.point(c), turf.point(startSnapped), { units: 'meters' });
            const dEnd = turf.distance(turf.point(c), turf.point(endSnapped), { units: 'meters' });
            if (dStart < 1.5) startIdx = idx;
            if (dEnd < 1.5) endIdx = idx;
          });
          if (startIdx !== -1 && endIdx !== -1) {
            const dist = Math.abs(endIdx - startIdx);
            if (dist < minDist) {
              minDist = dist;
              bestSegment = coords;
              bestStartIdx = startIdx;
              bestEndIdx = endIdx;
            }
          }
        }
        if (bestSegment && bestStartIdx != null && bestEndIdx != null) {
          pathLine = turf.lineString(bestSegment.slice(Math.min(bestStartIdx, bestEndIdx), Math.max(bestStartIdx, bestEndIdx) + 1));
        } else {
          // Advanced fallback: pick the road line that best matches both endpoints
          let bestSlice = null;
          let bestScore = Infinity;
          for (const line of roadNetwork) {
            try {
              const a = turf.nearestPointOnLine(line, turf.point(startSnapped), { units: 'meters' });
              const b = turf.nearestPointOnLine(line, turf.point(endSnapped), { units: 'meters' });
              const score = (a?.properties?.dist ?? 1e9) + (b?.properties?.dist ?? 1e9);
              const sliced = turf.lineSlice(a, b, line);
              if (!sliced?.geometry?.coordinates || sliced.geometry.coordinates.length < 2) continue;
              if (score < bestScore) {
                bestScore = score;
                bestSlice = sliced;
              }
            } catch {}
          }
          if (bestSlice) {
            pathLine = bestSlice;
          } else {
            // Last-resort fallback: project chord onto network by sampling and snapping
            function projectChordOntoNetwork(a, b, network, samples = 40, maxSnapM = 80) {
              const snappedPts = [];
              for (let i = 0; i <= samples; i++) {
                const t = i / samples;
                const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                let best = null; let bestD = Infinity;
                for (const ln of network) {
                  try {
                    const s = turf.nearestPointOnLine(ln, turf.point(p), { units: 'meters' });
                    if (s && s.properties.dist < bestD) { bestD = s.properties.dist; best = s.geometry.coordinates; }
                  } catch {}
                }
                if (best && bestD <= maxSnapM) {
                  if (!snappedPts.length || snappedPts[snappedPts.length - 1][0] !== best[0] || snappedPts[snappedPts.length - 1][1] !== best[1]) {
                    snappedPts.push(best);
                  }
                }
              }
              if (snappedPts.length < 2) return null;
              return turf.lineString(snappedPts);
            }
            const projected = projectChordOntoNetwork(startSnapped, endSnapped, roadNetwork);
            if (projected) {
              pathLine = projected;
            } else {
              return; // abort drawing; still no road-aligned geometry
            }
          }
        }
      }
      const t3 = performance.now();
      // Final precision trimming: slice pathLine exactly between the snapped endpoints.
      // This fixes cases where both endpoints lie on the same underlying segment and the
      // graph solution overshoots to a vertex before coming back, leaving a longer stale line.
      let finalLine = pathLine;
      try {
        if (pathLine && pathLine.geometry?.type === 'LineString' && Array.isArray(pathLine.geometry.coordinates) && pathLine.geometry.coordinates.length >= 2) {
          const startSnapOnPath = turf.nearestPointOnLine(pathLine, turf.point(startSnapped));
          const endSnapOnPath = turf.nearestPointOnLine(pathLine, turf.point(endSnapped));
          let sliced = turf.lineSlice(startSnapOnPath, endSnapOnPath, pathLine);
          // If order along line is reversed, slice will be empty (<2 coords); retry reversed.
          if (!sliced?.geometry?.coordinates || sliced.geometry.coordinates.length < 2) {
            sliced = turf.lineSlice(endSnapOnPath, startSnapOnPath, pathLine);
            // Maintain original direction from startSnapped -> endSnapped if we reversed.
            if (sliced?.geometry?.coordinates && sliced.geometry.coordinates.length >= 2) {
              const first = sliced.geometry.coordinates[0];
              const d1 = turf.distance(turf.point(first), turf.point(startSnapped));
              const d2 = turf.distance(turf.point(first), turf.point(endSnapped));
              if (d2 < d1) {
                // Currently reversed relative to desired orientation; flip coordinates.
                sliced.geometry.coordinates = [...sliced.geometry.coordinates].reverse();
              }
            }
          }
          if (sliced?.geometry?.coordinates && sliced.geometry.coordinates.length >= 2) {
            // Replace with precise slice only if it actually shortens or differs to force a repaint.
            const origLen = (()=>{ try { return turf.length(pathLine, { units: 'meters' }); } catch { return null; } })();
            const newLen = (()=>{ try { return turf.length(sliced, { units: 'meters' }); } catch { return null; } })();
            if (newLen != null && origLen != null && (newLen <= origLen + 0.01)) {
              if (origLen != null && newLen != null && Math.abs(origLen - newLen) > 0.05) {
                // eslint-disable-next-line no-console
                console.log('[street-path] trimmed path', { origLenM: origLen, newLenM: newLen });
              }
              finalLine = sliced;
            }
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[street-path-trim] trimming failed', e);
      }
      if (finalLine && finalLine.geometry && Array.isArray(finalLine.geometry.coordinates) && finalLine.geometry.coordinates.length >= 2) {
        // Add or update the source safely
        if (!m.getSource('selected-road-segment')) {
          m.addSource('selected-road-segment', {
            type: 'geojson',
            data: finalLine
          });
        } else {
          m.getSource('selected-road-segment').setData(finalLine);
        }
        // Add the layer to render the highlighted line if not present
        const dashArray = editingStreetSegmentId ? [2,2] : [1,0]; // dashed when re-editing, solid otherwise
        if (!m.getLayer('selected-road-segment-layer')) {
          m.addLayer({
            id: 'selected-road-segment-layer',
            type: 'line',
            source: 'selected-road-segment',
            paint: {
              'line-color': colorByUse[useType] || '#ff9800',
              'line-width': 6,
              'line-opacity': 0.9,
              'line-dasharray': dashArray
            }
          });
        } else {
          try {
            m.setPaintProperty('selected-road-segment-layer','line-color', colorByUse[useType] || '#ff9800');
            m.setPaintProperty('selected-road-segment-layer','line-dasharray', dashArray);
          } catch {}
        }
        try {
          const lenM = turf.length(finalLine, { units: 'meters' });
          setStreetPathLengthM(lenM);
        } catch { setStreetPathLengthM(null); }
        const t4 = performance.now();
        const sample = {
          total: t4 - t0,
            featureQuery: t1 - t0,
            snapPrep: t2 - t1,
            graphAndSolve: t3_preFallback - t2,
            fallbackAndFinalize: t3 - t3_preFallback,
            renderUpdate: t4 - t3,
            ts: Date.now()
        };
        recordStreetPerf(sample);
        // Structured console log
        // eslint-disable-next-line no-console
        console.log('[street-perf]', sample);
      }
    }
  }, [startEndMode, startPoint, endPoint, useType, streetPathNonce]);

  // Reactive: update selected road segment line color when zone type toggles
  useEffect(() => {
    if (!map.current) return;
    if (!streetsActive) return; // only relevant in street tool
    const m = map.current;
    if (m.getLayer('selected-road-segment-layer')) {
      try {
        m.setPaintProperty('selected-road-segment-layer', 'line-color', colorByUse[useType] || '#ff9800');
      } catch {}
    }
  }, [useType, streetsActive]);

  // --- Save / finalize helpers -----------------------------------

  const canFinalizePolygon = polygonActive && drawnCoords.length >= 3;
  const canFinalizeStreets = streetsActive && !!startPoint && !!endPoint;
  const hasActiveStreetPath = streetsActive && !!startPoint && !!endPoint && streetPathLengthM != null;

  function cancelAllSelections() {
    setSelectedSavedIndex(null);
    setSelectedStreetSegmentIndex(null);
    setEditingSavedIndex(null);
    setEditingStreetSegmentId(null);
    setZoneSummary(null);
    setStreetSegmentSummary(null);
    setEphemeralStreetPathSummary(null);
    setDrawMode(null);
    setStartPoint(null);
    setEndPoint(null);
    setStreetPathLengthM(null);
    // remove ephemeral map layers if present
    if (map.current) {
      const m = map.current;
      ['selected-road-segment-layer','start-end-points-layer'].forEach(l=>{ if (m.getLayer(l)) try{ m.removeLayer(l);}catch{} });
      ['selected-road-segment','start-end-points'].forEach(s=>{ if (m.getSource(s)) try{ m.removeSource(s);}catch{} });
    }
  }
  
  // Finalize button handler
  function finalizeCurrent() {
    if (canFinalizePolygon) return finalizeZone();
    if (canFinalizeStreets) return finalizeStreetSelection();
  }

  const canFinalize = drawMode && drawnCoords.length >= 3;

  // Show the save panel and seed a name if needed
  function finalizeZone() {
    if (!canFinalize) return;
    setShowSavePanel(true);
    if (!pendingName.trim())
      setPendingName(`Custom Zone ${savedZones.length + 1}`);
  }

  // Placeholder for street selection finalization; keeps polygon flow intact
  function finalizeStreetSelection() {
    if (!map.current) return;
    const m = map.current;
    const src = m.getSource('selected-road-segment');
    let lineData = null;
    try {
      // MapLibre internal data reference (non-public API but works for local state)
      // @ts-ignore
      lineData = src?._data || null;
    } catch {}
    if (!lineData || lineData.type !== 'Feature' || lineData.geometry?.type !== 'LineString') {
      return; // nothing to save
    }
    const lenM = streetPathLengthM || (() => { try { return turf.length(lineData, { units: 'meters' }); } catch { return null; } })();
    const baseProps = {
      name: `Segment ${savedStreetSegments.length + 1}`,
      useType,
      lengthM: lenM,
      createdAt: Date.now()
    };
    if (editingStreetSegmentId) {
      // Update existing
      setSavedStreetSegments(prev => prev.map(f => f.properties?.id === editingStreetSegmentId ? {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [...lineData.geometry.coordinates] },
        properties: { ...f.properties, ...baseProps, id: editingStreetSegmentId, updatedAt: Date.now() }
      } : f));
      setEditingStreetSegmentId(null);
    } else {
      const newFeature = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [...lineData.geometry.coordinates] },
        properties: { ...baseProps, id: genId() }
      };
      setSavedStreetSegments(prev => [newFeature, ...prev]);
      // Auto-select newly saved segment so summary persists
      setSelectedStreetSegmentIndex(0);
    }
    // Clear ephemeral selection layers
    if (m.getLayer('selected-road-segment-layer')) m.removeLayer('selected-road-segment-layer');
    if (m.getSource('selected-road-segment')) m.removeSource('selected-road-segment');
    if (m.getLayer('start-end-points-layer')) m.removeLayer('start-end-points-layer');
    if (m.getSource('start-end-points')) m.removeSource('start-end-points');
    setStartPoint(null);
    setEndPoint(null);
    setStreetPathLengthM(null);
  }

  // Dev-only validation harness for M3 path reliability
  async function runStreetValidation(samples = 10) {
    if (!import.meta.env.DEV) return;
    if (!map.current) return;
    const m = map.current;
    const roadLayerIds = getRoadLayerIds(m);
    let featuresRaw = [];
    try { featuresRaw = m.queryRenderedFeatures({ layers: roadLayerIds }); } catch {}
    const lines = featuresRaw.flatMap(explodeToLineStrings).filter(f => isDrivableRoad(f.properties));
    if (!lines.length) {
      console.warn('[validate] No lines in viewport');
      return;
    }
    // Collect candidate coords pool
    const pool = [];
    lines.forEach(ln => {
      const cs = ln.geometry.coordinates;
      if (cs?.length) pool.push(...cs.filter(c => Array.isArray(c) && c.length === 2));
    });
    if (pool.length < 4) {
      console.warn('[validate] Insufficient coordinate pool');
      return;
    }
    function pickRand() { return pool[Math.floor(Math.random()*pool.length)]; }
    const results = [];
    for (let i=0;i<samples;i++) {
      const a = pickRand();
      const b = pickRand();
      if (!a || !b || (a[0]===b[0] && a[1]===b[1])) { i--; continue; }
      const t0 = performance.now();
      // reuse shortest path logic by temporarily calling recomputeStreetPathRef after setting state
      // We'll manually invoke the internal path builder by briefly setting points and forcing recompute
      const prevStart = startPoint, prevEnd = endPoint;
      setStartPoint(a); setEndPoint(b);
      // Force recompute (async tick)
      await new Promise(r => setTimeout(r, 30));
      if (recomputeStreetPathRef.current) recomputeStreetPathRef.current();
      await new Promise(r => setTimeout(r, 120)); // allow path effect
      let len = null; let ok = true; let issues = [];
      try { len = streetPathLengthM; } catch {}
      if (len == null) { ok = false; issues.push('null-length'); }
      else if (len < 30) { issues.push('short(<30m)'); }
      const t1 = performance.now();
      results.push({ i, len, ms: (t1 - t0), issues, ok });
      // restore original points to avoid user-visible state drift after last iteration
      if (i === samples -1) {
        setStartPoint(prevStart); setEndPoint(prevEnd);
        if (recomputeStreetPathRef.current) setTimeout(()=>recomputeStreetPathRef.current(),0);
      }
    }
    const success = results.filter(r=>r.ok).length;
    const median = (()=>{ const arr = results.map(r=>r.ms).sort((a,b)=>a-b); return arr[Math.floor(arr.length/2)] || 0; })();
    const max = Math.max(...results.map(r=>r.ms));
    // eslint-disable-next-line no-console
    console.log('[validate:street]', { samples: results.length, success, medianMs: +median.toFixed(1), maxMs: +max.toFixed(1), results });
  }

  // Create a GeoJSON Feature from the drawn polygon and metadata
  // nameOverride is only used when duplicating an existing saved zone
  function makeFeatureFromDrawn(nameOverride) {
    if (!zoneSummary || drawnCoords.length < 3) return null;
    const closed = [...drawnCoords, drawnCoords[0]];
    return {
      type: "Feature",
      properties: {
        id: genId(),
        name:
          nameOverride ??
          (pendingName.trim() || `Custom Zone ${savedZones.length + 1}`),
        description: pendingDescription.trim() || null,
        useType,
        areaM2: zoneSummary.areaM2,
        areaFt2: zoneSummary.areaFt2,
        address: zoneSummary.address,
      },
      geometry: { type: "Polygon", coordinates: [closed] },
    };
  }

  // Save from the save panel (new or editing)
  function saveZone() {
    const feature = makeFeatureFromDrawn();
    if (!feature) return;

    if (editingSavedIndex != null) {
      setSavedZones((prev) =>
        prev.map((f, i) => (i === editingSavedIndex ? { ...feature, properties: { ...feature.properties, id: f.properties?.id || genId() } } : f))
      );
    } else {
      setSavedZones((prev) => [feature, ...prev]);
    }

    // Reset draw state
    setShowSavePanel(false);
    setPendingName("");
    setPendingDescription("");
  setActiveTool('none');
    setDrawnCoords([]);
    setZoneSummary(null);
    setEditingSavedIndex(null);
    setSummaryContext(null);
  }

  // Save as new even when editing an existing zone
  function saveAsNewZone() {
    const feature = makeFeatureFromDrawn();
    if (!feature) return;
    setSavedZones((prev) => [feature, ...prev]);
    // Keep editing state off after saving as new
    setShowSavePanel(false);
    setPendingName("");
    setPendingDescription("");
  setActiveTool('none');
    setDrawnCoords([]);
    setZoneSummary(null);
    setEditingSavedIndex(null);
    setSummaryContext(null);
  }

  // Cancel from the save panel
  function handleCancelSave() {
    if (editingSavedIndex != null) {
      // If we were editing an existing zone, cancel should exit edit mode entirely
      setShowSavePanel(false);
      setPendingName("");
      setPendingDescription("");
    setActiveTool('none');
      setDrawnCoords([]);
      setZoneSummary(null);
      setEditingSavedIndex(null);
      setSummaryContext(null);
    } else {
      // If drawing a brand-new zone, just close the save panel (keep drawing)
      setShowSavePanel(false);
    }
  }

  // Delete a saved zone
  function deleteSaved(index) {
    setSavedZones((prev) => prev.filter((_, i) => i !== index));
    if (selectedSavedIndex === index) setSelectedSavedIndex(null);
  }

  // Fly to a saved zone with sidebar-aware padding
  function flyToSaved(feature) {
    if (!map.current) return;
    const bb = turf.bbox(feature);
    map.current.fitBounds(
      [
        [bb[0], bb[1]],
        [bb[2], bb[3]],
      ],
      { padding: getMapPadding(), duration: 700 }
    );
  }

  // Load a saved zone into draw/edit mode
  // openSavePanel: whether to open the save panel immediately
  // (false = just load into draw mode)
  function loadSavedIntoDraw(index, openSavePanel = false) {
    const f = savedZones[index];
    if (!f?.geometry) return;

    if (f.geometry.type !== "Polygon") {
      alert("Editing geometry is only supported for single polygons right now.");
      // Optionally show a toast / disable Edit button for multipolygons
      return;
    }

    // Important: clear selection first so the "saved summary" effect won't run
    setSelectedSavedIndex(null);
    setEditingSavedIndex(index);

    const ring = f.geometry.coordinates[0]; // closed ring
    const openRing = ring.slice(0, ring.length - 1); // open ring
    const type = f.properties?.useType || useType;

    // Put app into draw/edit state
    setUseType(type);
    setPendingName(f.properties?.name || "");
    setPendingDescription(f.properties?.description || "");
    setShowSavePanel(openSavePanel);
    setSidebarVisible(true);

    // Make the finalize/edit UI appear immediately
    setSummaryContext("draw");

    // Fit the feature with the same sidebar-aware padding
    flyToSaved(f);

    // After “Edit geometry” fly, refresh the streets once the camera is idle
    if (map.current) {
      const m = map.current;
      const onIdle = () => {
        m.off("idle", onIdle);
        try {
          const ring = f.geometry.coordinates[0];
          const poly = turf.polygon([ring], {
            useType: f.properties?.useType || useType,
          });
          const streets = getIntersectingStreetNames(m, poly);
          setZoneSummary((s) => (s ? { ...s, streets } : s));
        } catch {}
      };
      m.on("idle", onIdle);
    }

    // Seed a minimal summary synchronously
    try {
      const poly = turf.polygon([ring], { useType: type });
      const areaM2 = turf.area(poly);
      const areaFt2 = convertToSquareFeet(areaM2);
      const centroidPt = turf.centroid(poly).geometry.coordinates;
      setZoneSummary({
        areaM2,
        areaFt2,
        centroid: centroidPt,
        address: f.properties?.address || null,
        streets: [],
        useType: type,
      });
    } catch {}

    // Enter draw mode with the polygon loaded
  setActiveTool('polygon');
    setDrawnCoords(openRing);
  }

  // Update the useType of a saved zone (from the summary panel)
  function updateSavedUseType(index, newType) {
    setSavedZones((prev) =>
      prev.map((f, i) =>
        i === index
          ? { ...f, properties: { ...(f.properties || {}), useType: newType } }
          : f
      )
    );
  }

  // --- Sidebar resizing ------------------------------------------

  // Drag to resize
  function startSidebarResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMove = (ev) => {
      const dx = startX - ev.clientX; // drag left = grow
      const next = Math.max(300, Math.min(560, startW + dx));
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const isEditingSaved = editingSavedIndex != null;

  // --- UI ---------------------------------------------------------

  const controlPanelStyle = {
    position: "absolute",
    top: "1rem",
    left: "1rem",
    zIndex: 10,
    backgroundColor: "white",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.5rem",
  };

  const buttonStyle = {
    backgroundColor: "#ffc107",
    border: "none",
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    color: "#000",
    cursor: "pointer",
    fontSize: "0.9rem",
  };

  // Consolidated button variants for consistent styling / labeling.
  // Base style keeps neutral focus/size; variants supply background + color only.
  const buttonVariants = {
    base: buttonStyle,
    primary: { ...buttonStyle, backgroundColor: '#0d6efd', color: '#fff' }, // main actions
    success: { ...buttonStyle, backgroundColor: '#28a745', color: '#fff' }, // save/finalize
    warning: { ...buttonStyle, backgroundColor: '#ffc107', color: '#000' }, // editing state highlight
    info: { ...buttonStyle, backgroundColor: '#17a2b8', color: '#fff' },    // select / secondary emphasis
    muted: { ...buttonStyle, backgroundColor: '#6c757d', color: '#fff' },   // re-edit idle
    danger: { ...buttonStyle, backgroundColor: '#dc3545', color: '#fff' },  // destructive
    outline: { ...buttonStyle, backgroundColor: '#ffffff', color: '#000', border: '1px solid #ccc' }, // neutral / cancel
  };

  // Consistent selected highlight style for list items (zones & streets)
  const selectedCardStyle = {
    border: '2px solid #28a745',
    background: '#f1fff4',
    boxShadow: '0 0 0 2px rgba(40,167,69,0.12)'
  };

  const selectStyle = {
    padding: "0.5rem",
    borderRadius: "0.375rem",
    fontSize: "0.9rem",
  };

  const labelStyle = {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "#555",
  };

  const showRightPanel = zoneSummary || savedZones.length > 0;
  // Card style reused for summary panel (was referenced but not declared)
  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    padding: '0.75rem 0.85rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
  };

  // Display name for the summary header
  const displayName =
    summaryContext === "saved"
      ? savedZones[selectedSavedIndex]?.properties?.name ??
        (selectedSavedIndex != null ? `Zone ${selectedSavedIndex + 1}` : "Zone")
      : pendingName || "Custom Zone";

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div
        ref={mapContainer}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      <div style={controlPanelStyle}>
  <div style={{ display: 'grid', gap: '0.25rem', minWidth: 200 }}>
          <div style={labelStyle}>Drawing tool</div>
          <div style={{ display: 'flex', gap: '0.4rem' }} role="radiogroup" aria-label="Drawing tool">
            {[
              { key: 'none', label: 'Off' },
              { key: 'polygon', label: 'Polygon' },
              { key: 'street', label: 'Street' }
            ].map(btn => {
              const active = activeTool === btn.key;
              return (
                <button
                  key={btn.key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setActiveTool(btn.key)}
                  style={{
                    ...buttonStyle,
                    backgroundColor: active ? '#007bff' : '#e2e6ea',
                    color: active ? '#fff' : '#222',
                    fontWeight: active ? 600 : 500,
                    padding: '0.4rem 0.65rem',
                    minWidth: 62
                  }}
                >{btn.label}</button>
              );
            })}
          </div>
        </div>
        {polygonActive && (
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div style={labelStyle}>Zone type</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['mixed-use','residential','commercial'].map(t => (
                <button
                  key={t}
                  aria-label={`Set zone type ${t}`}
                  onClick={() => setUseType(t)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 6,
                    border: useType === t ? '2px solid #222' : '1px solid #bbb',
                    background: colorByUse[t],
                    cursor: 'pointer',
                    boxShadow: useType === t ? '0 0 0 2px rgba(0,0,0,0.25)' : 'none'
                  }}
                  title={t.replace('-', ' ')}
                />
              ))}
            </div>
          </div>
        )}
        {streetsActive && (
          <div style={{ display: 'grid', gap: '0.25rem' }}>
    <div style={labelStyle}>Zone type</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {['mixed-use','residential','commercial'].map(t => (
                <button
                  key={t}
                  aria-label={`Set zone type ${t}`}
                  onClick={() => setUseType(t)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 6,
                    border: useType === t ? '2px solid #222' : '1px solid #bbb',
                    background: colorByUse[t],
                    cursor: 'pointer',
                    boxShadow: useType === t ? '0 0 0 2px rgba(0,0,0,0.25)' : 'none'
                  }}
                  title={t.replace('-', ' ')}
                />
              ))}
            </div>
          </div>
        )}

  {/* Basemap control removed from primary drawing panel (relocated bottom-left) */}

  {/* Zone type picker removed from global panel (now contextual) */}

        {/* ✅ Street selection controls now inside the panel */}
        {/* Street metrics shown only when Street tool active */}
    {streetsActive && (
          <div className="street-metrics" id="street-metrics-panel" style={{ display: 'grid', gap: '0.25rem', minWidth: 160 }}>
            <div style={labelStyle} className="street-metrics__label">Street metrics</div>
      {streetPathLengthM != null && (
              <div className="street-metrics__length" style={{ fontSize: '0.7rem', color: '#444' }}>
                Length: {streetPathLengthM.toFixed(1)} m
              </div>
            )}
      {/* Dev-only perf metrics */}
      {import.meta.env.DEV && streetPerfSamples.length > 0 && (() => {
              const last = streetPerfSamples[streetPerfSamples.length - 1];
              const avg = streetPerfSamples.reduce((s, p) => s + p.total, 0) / streetPerfSamples.length;
              return (
                <div className="street-metrics__perf" style={{ fontSize: '0.65rem', color: '#555', lineHeight: 1.3 }}>
                  <div>Last: {last.total.toFixed(1)} ms</div>
                  <div>Avg: {avg.toFixed(1)} ms</div>
                </div>
              );
            })()}
            {/* Removed dev-only Validate paths button */}
          </div>
        )}
      </div>

      {/* Bottom-left basemap toggle */}
      <div id="basemap-toggle" className="basemap-toggle" style={{ position:'absolute', left:'1rem', bottom:'1rem', zIndex:10 }}>
        <div className="basemap-toggle__options" style={{ display:'flex', gap:'0.4rem', background:'#ffffffd9', backdropFilter:'blur(4px)', padding:'0.4rem 0.6rem', borderRadius:8, boxShadow:'0 2px 8px rgba(0,0,0,0.15)' }} aria-label="Basemap style" role="radiogroup">
          {[
            { key:'streets', label:'Streets' },
            { key:'satellite', label:'Satellite' }
          ].map(opt => {
            const active = basemapStyle === opt.key;
            return (
              <button
                key={opt.key}
                className={`basemap-toggle__btn ${active ? 'is-active' : ''}`}
                role="radio"
                aria-checked={active}
                onClick={() => setBasemapStyle(opt.key)}
                style={{
                  border:'none',
                  background: active ? '#007bff' : '#e2e6ea',
                  color: active ? '#fff' : '#222',
                  padding:'0.35rem 0.75rem',
                  borderRadius:6,
                  fontSize:'0.75rem',
                  fontWeight:600,
                  cursor:'pointer'
                }}
                title={`Switch to ${opt.label}`}
              >{opt.label}</button>
            );
          })}
        </div>
      </div>

      {/* Help box during draw */}
      {(polygonActive || streetsActive) && (
        <div
          style={{
            position: 'absolute',
            // Offset to clear control panel; unified save now in sidebar summary
            top: '7.25rem',
            left: '1rem',
            backgroundColor: '#fffff3',
            border: '1px solid #ccc',
            padding: '1rem 1.1rem .9rem',
            borderRadius: '0.5rem',
            zIndex: 11,
            maxWidth: 320,
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        >
          <button
            onClick={() => setShowHelpBox(!showHelpBox)}
            style={{
              position: 'absolute',
              top: '0.25rem',
              right: '0.5rem',
              border: 'none',
              background: 'transparent',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: '#888'
            }}
            aria-label="Toggle help"
          >
            {showHelpBox ? '×' : 'ℹ️'}
          </button>
          {showHelpBox && (
            <>
              <h4 style={{ margin: '0 0 .5rem', fontSize: '1rem' }}>
                {polygonActive ? 'Polygon Tool Help' : 'Street Tool Help'}
              </h4>
              {polygonActive && (
                <ul style={{ paddingLeft: '1rem', fontSize: '.85rem', lineHeight: 1.5, margin: 0 }}>
                  <li>Click to add polygon vertices.</li>
                  <li>Drag a vertex to move it; right-click to delete.</li>
                  <li>Change <strong>Zone type</strong> using swatches while drawing or editing.</li>
                  <li>Finalize & Save to store the zone with stats.</li>
                </ul>
              )}
              {streetsActive && (
                <ul style={{ paddingLeft: '1rem', fontSize: '.85rem', lineHeight: 1.5, margin: 0 }}>
                  <li>Click start, then end along roads to trace path.</li>
                  <li>Drag endpoints to refine alignment.</li>
                  <li>Switch <strong>Zone type</strong> to recolor the segment.</li>
                  <li>Finalize & Save to persist the street segment.</li>
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Summary + Saved panel */}
      {showRightPanel && (
        <>
          <button
            id="sidebar-toggle"
            className="sidebar__toggle"
            onClick={() => setSidebarVisible(!sidebarVisible)}
            style={{
              position: "absolute",
              right: sidebarVisible ? `${sidebarWidth}px` : "0",
              top: "1rem",
              zIndex: 10,
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.25rem 0 0 0.25rem",
              cursor: "pointer",
              transition: "right 0.3s",
            }}
            aria-label={sidebarVisible ? "Hide summary" : "Show summary"}
            title={sidebarVisible ? "Hide summary" : "Show summary"}
          >
            {sidebarVisible ? "❯" : "❮"}
          </button>

          <div
            id="sidebar"
            className={`sidebar ${sidebarVisible ? 'is-open' : 'is-closed'}`}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: `${sidebarWidth}px`,
              backgroundColor: "#fdfdfd",
              padding: "1.25rem 1rem",
              boxShadow: "-2px 0 10px rgba(0,0,0,0.1)",
              zIndex: 9,
              overflowY: "auto",
              fontFamily: "system-ui, sans-serif",
              transform: sidebarVisible ? "translateX(0)" : "translateX(100%)",
              transition: "transform 0.3s ease",
            }}
          >
            <div
              id="sidebar-resizer"
              className="sidebar__resizer"
              onMouseDown={startSidebarResize}
              title="Resize"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 6,
                height: "100%",
                cursor: "ew-resize",
                background: "transparent",
              }}
            />
            {(zoneSummary || streetSegmentSummary || ephemeralStreetPathSummary) && (
              <div style={cardStyle} className="summary-card" id="summary-card">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem', borderBottom:'2px solid #eee', paddingBottom:'0.5rem', gap:'0.5rem' }}>
                  <h2 style={{ fontSize: '1.2rem', margin:0 }}>
                    {zoneSummary ? 'Zone Summary' : 'Street Segment Summary'}
                  </h2>
                  <button onClick={cancelAllSelections} className="btn btn--cancel" style={buttonVariants.outline}>Cancel</button>
                </div>
                {zoneSummary && (
                  <div className="summary-card__zone">
                    <p style={{ marginBottom: "0.5rem" }}><strong>Name:</strong> {displayName}</p>
                    <p style={{ marginBottom: "0.5rem" }}><strong>Type:</strong> {zoneSummary.useType}</p>
                    <p style={{ marginBottom: "0.5rem" }}><strong>Area:</strong> {zoneSummary.areaM2.toFixed(2)} m² / {zoneSummary.areaFt2.toFixed(2)} ft²</p>
                    <p style={{ marginBottom: "1rem" }}><strong>Centroid:</strong> {zoneSummary.centroid[0].toFixed(6)}, {zoneSummary.centroid[1].toFixed(6)}</p>
                  </div>
                )}
                {(streetSegmentSummary || ephemeralStreetPathSummary) && (() => { const ss = streetSegmentSummary || ephemeralStreetPathSummary; return (
                  <div className="summary-card__street">
                    <p style={{ marginBottom: '0.5rem' }}><strong>Name:</strong> {ss.name}</p>
                    <p style={{ marginBottom: '0.5rem' }}><strong>Type:</strong> {ss.useType}</p>
                    {ss.lengthM != null && (
                      <p style={{ marginBottom: '0.5rem' }}><strong>Length:</strong> {ss.lengthM.toFixed(1)} m</p>
                    )}
                    <p style={{ marginBottom: '0.5rem' }}><strong>Start:</strong> {ss.start[0].toFixed(6)}, {ss.start[1].toFixed(6)}</p>
                    <p style={{ marginBottom: '1rem' }}><strong>End:</strong> {ss.end[0].toFixed(6)}, {ss.end[1].toFixed(6)}</p>
                  </div>
                )})()}
                {zoneSummary && zoneSummary.address && (
                  <div className="summary-card__address">
                    <h3 style={{ fontSize: "1.05rem", margin: "1rem 0 0.5rem", borderBottom: "1px solid #ddd", paddingBottom: "0.25rem" }}>Location Details</h3>
                    <ul style={{ paddingLeft: "1rem", listStyle: "disc", lineHeight: "1.6" }}>
                      {zoneSummary.address.street && (<li><strong>Street:</strong> {zoneSummary.address.street}</li>)}
                      {zoneSummary.address.postalCode && (<li><strong>Postal Code:</strong> {zoneSummary.address.postalCode}</li>)}
                      {zoneSummary.address.neighbourhood && (<li><strong>Neighborhood:</strong> {zoneSummary.address.neighbourhood}</li>)}
                      {zoneSummary.address.city && (<li><strong>City:</strong> {zoneSummary.address.city}</li>)}
                      {zoneSummary.address.state && (<li><strong>State:</strong> {zoneSummary.address.state}</li>)}
                      {zoneSummary.address.country && (<li><strong>Country:</strong> {zoneSummary.address.country}</li>)}
                    </ul>
                  </div>
                )}
                {zoneSummary && zoneSummary.streets && zoneSummary.streets.length > 0 && (
                  <div className="summary-card__streets">
                    <h3 style={{ fontSize: "1.05rem", margin: "1rem 0 0.5rem", borderBottom: "1px solid #ddd", paddingBottom: "0.25rem" }}>Streets intersecting zone</h3>
                    <ul style={{ paddingLeft: "1rem", listStyle: "disc", lineHeight: "1.6" }}>
                      {zoneSummary.streets.map((s,i)=>(<li key={i}>{s}</li>))}
                    </ul>
                  </div>
                )}
                {/* Polygon finalize section (original logic preserved) */}
                {(zoneSummary && (summaryContext === "draw" || editingSavedIndex != null)) && (
                  <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #eee" }}>
                    {!showSavePanel ? (
                      <button
                        onClick={finalizeCurrent}
                        disabled={!(canFinalizePolygon || canFinalizeStreets)}
                        className="btn btn--finalize"
                        style={{ ...(canFinalizePolygon || canFinalizeStreets ? buttonVariants.success : buttonVariants.success), opacity: (canFinalizePolygon || canFinalizeStreets) ? 1 : 0.6 }}
                      >Finalize & Save</button>
                    ) : (
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        {editingSavedIndex != null && (
                          <div style={{ fontSize: "0.85rem", color: "#555" }}>Editing saved zone #{editingSavedIndex + 1}</div>
                        )}
                        <label style={{ fontSize: "0.85rem" }}>Name</label>
                        <input value={pendingName} onChange={e=>setPendingName(e.target.value)} placeholder="Custom Zone" style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }} />
                        <label style={{ fontSize: "0.85rem" }}>Description</label>
                        <textarea value={pendingDescription} onChange={e=>setPendingDescription(e.target.value)} rows={3} placeholder="Notes, purpose, constraints" style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: 6 }} />
                        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Type:</span>
                            {['mixed-use','residential','commercial'].map(t => (
                              <button key={t} onClick={()=>setUseType(t)} title={t} aria-label={`Set type ${t}`} style={{ width: 28, height: 28, borderRadius: 6, border: useType === t ? '2px solid #222' : '1px solid #bbb', background: colorByUse[t], cursor: 'pointer', boxShadow: useType === t ? '0 0 0 2px rgba(0,0,0,0.25)' : 'none' }} />
                            ))}
                          </div>
                          <button onClick={saveZone} className="btn btn--save" style={buttonVariants.success}>{editingSavedIndex != null ? 'Save changes' : 'Save'}</button>
                          {editingSavedIndex != null && (<button onClick={saveAsNewZone} className="btn btn--save-new" style={buttonVariants.info}>Save as new</button>)}
                          <button onClick={handleCancelSave} className="btn btn--cancel" style={buttonVariants.outline}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Street finalize when ephemeral unsaved path present (only once) */}
                {ephemeralStreetPathSummary && !zoneSummary && (
                  <div style={{ marginTop: '0.75rem', display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                    <button onClick={finalizeStreetSelection} className="btn btn--finalize" style={buttonVariants.success}>Finalize & Save</button>
                    <button onClick={cancelAllSelections} className="btn btn--cancel" style={buttonVariants.outline}>Cancel</button>
                  </div>
                )}
              </div>
            )}
            {/* Saved items lists follow */}
            {/* (Removed duplicate street finalize block) */}

            {/* Saved zones list */}
            {savedZones.length > 0 && (
              <div style={{ marginTop: zoneSummary ? "1rem" : 0 }}>
                {/* Saved Zones "card" with a distinct background */}
                <div
                  style={{
                    background: "#f7f9ff", // <-- tinted card so it contrasts with the white Zone Summary
                    border: "1px solid #dbeafe",
                    borderRadius: 8,
                    padding: "0.75rem",
                  }}
                >
                  <h2
                    style={{
                      fontSize: "1.2rem",
                      marginBottom: "0.5rem",
                      borderBottom: "2px solid #cfe1ff",
                      paddingBottom: "0.5rem",
                    }}
                  >
                    Saved Zones
                  </h2>

                  {isEditingSaved && (
                    <div
                      style={{
                        background: "#fff3cd",
                        border: "1px solid #ffeeba",
                        color: "#856404",
                        padding: "0.5rem",
                        borderRadius: 6,
                        margin: "0.5rem 0",
                      }}
                    >
                      You're editing a zone. Finish or cancel to select or edit
                      a different one.
                    </div>
                  )}

                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "grid",
                      gap: "0.5rem",
                    }}
                  >
                    {savedZones.map((f, idx) => {
                      const zoneSelected = selectedSavedIndex === idx;
                      return (
                      <li
                        key={idx}
                        className={`list-item zone-item ${zoneSelected ? 'is-selected' : ''}`}
                        style={{
                          background: '#fff',
                          border: '1px solid #e5e5e5',
                          borderRadius: 8,
                          padding: '0.5rem',
                          ...(zoneSelected ? selectedCardStyle : {})
                        }}
                      >
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
                          <div style={{ fontWeight: 600, fontSize:'0.9rem' }}>
                            {f.properties?.name || `Zone ${idx + 1}`}
                            {selectedSavedIndex === idx ? " • selected" : ""}
                          </div>
                          <span style={{ width:12, height:12, borderRadius:3, background: colorByUse[f.properties?.useType || 'mixed-use'], border:'1px solid #ccc' }} />
                        </div>

                        {f.properties?.description && (
                          <div style={{ fontSize: "0.85rem", marginTop: 4 }}>
                            {f.properties.description}
                          </div>
                        )}

                        <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
                          {f.properties?.address?.street ||
                            f.properties?.address?.city ||
                            ""}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            marginTop: 6,
                          }}
                        >
                          <span style={{ fontSize: "0.75rem", fontWeight:600, color:'#555' }}>Type</span>
                          <select
                            value={f.properties?.useType || "mixed-use"}
                            onChange={(e) =>
                              updateSavedUseType(idx, e.target.value)
                            }
                            style={selectStyle}
                          >
                            <option value="mixed-use">Mixed Use</option>
                            <option value="residential">Residential</option>
                            <option value="commercial">Commercial</option>
                          </select>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 2,
                              backgroundColor:
                                colorByUse[
                                  f.properties?.useType || "mixed-use"
                                ],
                              display: "inline-block",
                              border: "1px solid #ccc",
                            }}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            marginTop: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            disabled={isEditingSaved}
                            onClick={() => {
                              if (isEditingSaved) return;
                              setSelectedSavedIndex(idx);
                              applySelectedFilter(map.current, idx);
                              flyToSaved(f);
                            }}
                            className={`btn btn--select ${isEditingSaved ? 'is-disabled' : ''}`}
                            title={isEditingSaved ? 'Finish or cancel current edit first' : 'Select'}
                            style={{ ...(selectedSavedIndex===idx ? buttonVariants.success : buttonVariants.info), opacity: isEditingSaved ? 0.6 : 1, cursor: isEditingSaved ? 'not-allowed':'pointer' }}
                          >{selectedSavedIndex===idx ? 'Selected' : 'Select'}</button>

                          <button
                            disabled={isEditingSaved && editingSavedIndex !== idx}
                            onClick={() => {
                              if (isEditingSaved && editingSavedIndex !== idx) return;
                              loadSavedIntoDraw(idx, true);
                            }}
                            className={`btn btn--edit ${isEditingSaved && editingSavedIndex !== idx ? 'is-disabled' : ''}`}
                            title={isEditingSaved && editingSavedIndex !== idx ? 'Finish or cancel current edit first' : 'Edit geometry'}
                            style={{ ...(isEditingSaved && editingSavedIndex === idx ? buttonVariants.warning : buttonVariants.info), opacity: isEditingSaved && editingSavedIndex !== idx ? 0.6 : 1, cursor: isEditingSaved && editingSavedIndex !== idx ? 'not-allowed':'pointer' }}
                          >{isEditingSaved && editingSavedIndex === idx ? 'Editing…' : 'Edit geometry'}</button>

                          <button
                            disabled={isEditingSaved && editingSavedIndex !== idx}
                            onClick={() => deleteSaved(idx)}
                            className={`btn btn--delete ${isEditingSaved && editingSavedIndex !== idx ? 'is-disabled' : ''}`}
                            title={isEditingSaved && editingSavedIndex !== idx ? 'Finish or cancel current edit first' : 'Delete'}
                            style={{ ...buttonVariants.danger, opacity: isEditingSaved && editingSavedIndex !== idx ? 0.6 : 1, cursor: isEditingSaved && editingSavedIndex !== idx ? 'not-allowed':'pointer' }}
                          >Delete</button>
                        </div>
                      </li>
                    );})}
                  </ul>
                </div>
              </div>
            )}

            {savedStreetSegments.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{
                  background: '#f6fff7',
                  border: '1px solid #cde9d6',
                  borderRadius: 8,
                  padding: '0.75rem'
                }}>
                  <h2 style={{ fontSize: '1.1rem', margin: 0, marginBottom: '.5rem', borderBottom: '2px solid #d6f2e0', paddingBottom: '.4rem' }}>Saved Street Segments</h2>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                    {savedStreetSegments.map((f, idx) => {
                      const sel = selectedStreetSegmentIndex === idx;
                      const segId = f.properties?.id;
                      const editingThis = editingStreetSegmentId && editingStreetSegmentId === segId;
                      return (
                        <li key={idx} className={`list-item street-item ${sel ? 'is-selected' : ''}`} style={{
                          background: '#fff',
                          border: '1px solid #e2e2e2',
                          borderRadius: 8,
                          padding: '0.55rem',
                          display: 'grid',
                          gap: '0.35rem',
                          ...(sel ? selectedCardStyle : {})
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                              {editingThis ? (
                                <input
                                  style={{ fontSize: '0.8rem', padding: '2px 4px' }}
                                  defaultValue={f.properties?.name || ''}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      const val = e.currentTarget.value.trim();
                                      if (val) {
                                        setSavedStreetSegments(prev => prev.map(sf => sf.properties?.id === segId ? { ...sf, properties: { ...sf.properties, name: val, updatedAt: Date.now() } } : sf));
                                        setEditingStreetSegmentId(null);
                                      }
                                    } else if (e.key === 'Escape') {
                                      setEditingStreetSegmentId(null);
                                    }
                                  }}
                                />
                              ) : (
                                <span onDoubleClick={()=> setEditingStreetSegmentId(segId)} title="Double-click to rename">{f.properties?.name || `Segment ${idx + 1}`}</span>
                              )}
                              {sel ? ' • selected' : ''}
                            </div>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: colorByUse[f.properties?.useType || 'mixed-use'], border: '1px solid #ccc' }} />
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#555' }}>Length: {f.properties?.lengthM ? f.properties.lengthM.toFixed(1) : '?'} m</div>
                          <div style={{ fontSize: '0.65rem', color: '#777' }}>ID: {segId?.slice(0,10)}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <label style={{ fontSize: '0.65rem' }}>Type:</label>
                            <select
                              value={f.properties?.useType || 'mixed-use'}
                              onChange={e => {
                                const newType = e.target.value;
                                setSavedStreetSegments(prev => prev.map(sf => sf.properties?.id === segId ? { ...sf, properties: { ...sf.properties, useType: newType, updatedAt: Date.now() } } : sf));
                              }}
                              style={{ fontSize: '0.65rem' }}
                            >
                              {Object.keys(colorByUse).map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => {
                                setSelectedStreetSegmentIndex(idx);
                                if (map.current) {
                                  const m = map.current;
                                  const filt = ['==',['get','__sid'], idx];
                                  try { m.setFilter('saved-street-segments-selected', filt); } catch {}
                                  try {
                                    const bb = turf.bbox(f);
                                    m.fitBounds([[bb[0],bb[1]],[bb[2],bb[3]]], { padding: getMapPadding(), duration: 600 });
                                  } catch {}
                                }
                              }}
                              className={`btn ${sel ? 'btn--selected' : 'btn--select'}`}
                              style={sel ? buttonVariants.success : buttonVariants.info}
                            >{sel ? 'Selected' : 'Select'}</button>
                            <button
                              title={editingThis ? 'Commit updated geometry by re-finalizing' : 'Load geometry for edit'}
                              onClick={() => {
                                // Start geometry re-edit: set endpoints from first & last coordinate and mark editingStreetSegmentId
                                try {
                                  const coords = f.geometry?.coordinates;
                                  if (Array.isArray(coords) && coords.length >= 2) {
                                    setStartPoint(coords[0]);
                                    setEndPoint(coords[coords.length -1]);
                                    setEditingStreetSegmentId(segId);
                                    setStreetPathLengthM(f.properties?.lengthM || null);
                                    setActiveTool('street');
                                    // force recompute to show path
                                    if (recomputeStreetPathRef.current) setTimeout(()=>recomputeStreetPathRef.current(),0);
                                  }
                                } catch {}
                              }}
                              className={`btn ${editingThis ? 'btn--editing' : 'btn--edit'}`}
                              style={editingThis ? buttonVariants.warning : buttonVariants.muted}
                            >{editingThis ? 'Editing…' : 'Edit geometry'}</button>
                            {editingThis && (
                              <button
                                title="Save changes"
                                onClick={() => {
                                  // finalizeStreetSelection will detect editingStreetSegmentId and update
                                  finalizeStreetSelection();
                                }}
                                className="btn btn--save-changes"
                                style={buttonVariants.success}
                              >Save changes</button>
                            )}
                            <button
                              onClick={() => {
                                setSavedStreetSegments(prev => prev.filter((_,i) => i !== idx));
                                if (selectedStreetSegmentIndex === idx) setSelectedStreetSegmentIndex(null);
                                if (editingStreetSegmentId === segId) setEditingStreetSegmentId(null);
                              }}
                              className="btn btn--delete"
                              style={buttonVariants.danger}
                            >Delete</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}