const MAPTILER_KEY = "DyVFUZmyKdCywxRTVU9B";
import React, { useState, useRef, useEffect } from "react";
import * as turf from "@turf/turf";
import maplibregl from "maplibre-gl";
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
  // Summary context state
  const [summaryContext, setSummaryContext] = useState(null);
  // Zone summary state
  const [zoneSummary, setZoneSummary] = useState(null);
  // Drawing tool state
  const [drawTool, setDrawTool] = useState("none");
  // --- React state hooks ---

  // --- Derived constants ---
  const polygonActive = drawTool === "polygon";
  const streetsActive = drawTool === "streets";
  // End point for segment selection
  const [endPoint, setEndPoint] = useState(null);
  // Start point for segment selection
  const [startPoint, setStartPoint] = useState(null);
  // Start/end segment selection mode state
  const [startEndMode, setStartEndMode] = useState(false);
  // Zone type state
  const [useType, setUseType] = useState("mixed-use");
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
  // Basemap style state
  const [basemapStyle, setBasemapStyle] = useState("streets");
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
  }

  // Build a zone summary from any Feature<Polygon>
  // typeFallback is used if the feature has no useType prop
  async function buildSummaryFromFeature(mapInstance, feature, typeFallback) {
    // ...existing code...
    if (accs.some(v => v === "no" || v === "private" || v === "destination")) return false;

    const EXCLUDED_SUB = new Set(["crossing","footway","path","cycleway","pedestrian","steps","sidewalk","platform","corridor"]);
    if (EXCLUDED_SUB.has(sub)) return false;

    const ALLOW_HW = new Set([
      "motorway","trunk","primary","secondary","tertiary",
      "unclassified","residential","living_street",
      "motorway_link","trunk_link","primary_link","secondary_link","tertiary_link"
    ]);
    const ALLOW_CLASS_STRICT = new Set([
      "motorway","trunk","primary","secondary","tertiary",
      "residential","street","unclassified","living_street"
    ]);

    if (ALLOW_HW.has(hw)) return true;
    if (ALLOW_CLASS_STRICT.has(cls)) return true;
    return false;
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
      const visStreets = drawTool === "streets" ? "visible" : "none";
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
        console.log('Start point:', snapped);
      } else if (!endPoint) {
        setEndPoint(snapped);
        console.log('End point:', snapped);
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
        console.log('Resetting selection, new start:', snapped);
      }
    };

    m.on("click", handleStartEndClick);
    return () => m.off("click", handleStartEndClick);
  }, [startEndMode, startPoint, endPoint]);

  // [START/END SEGMENT SELECTION] Visual feedback for selected points and drag-to-stretch
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
    const features = [];
    if (startPoint) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: startPoint }, properties: { type: 'start' } });
    }
    if (endPoint) {
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: endPoint }, properties: { type: 'end' } });
    }
    m.getSource('start-end-points').setData({ type: 'FeatureCollection', features });

    // Drag-to-stretch logic
    let isDragging = false;
    let dragType = null;

    function onMouseDown(e) {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== 'start-end-points-layer') return;
      dragType = feature.properties.type; // 'start' or 'end'
      isDragging = true;
      m.getCanvas().style.cursor = 'grabbing';
      m.dragPan.disable();
    }

    function onMouseMove(e) {
      if (!isDragging || !dragType) return;
      const lngLat = e.lngLat;
      // Snap to the nearest point along the currently highlighted road segment
      // Find the currently highlighted segment geometry
      const m = map.current;
      const source = m.getSource('selected-road-segment');
      if (!source) return;
      const data = source._data || source._options?.data;
      if (!data || !data.geometry || !Array.isArray(data.geometry.coordinates)) return;
      const line = turf.lineString(data.geometry.coordinates);
      const snapped = turf.nearestPointOnLine(line, turf.point([lngLat.lng, lngLat.lat]), { units: 'meters' });
      if (!snapped || !snapped.geometry || !Array.isArray(snapped.geometry.coordinates)) return;
      if (dragType === 'start') {
        setStartPoint(snapped.geometry.coordinates);
      } else if (dragType === 'end') {
        setEndPoint(snapped.geometry.coordinates);
      }
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      dragType = null;
      m.getCanvas().style.cursor = '';
      m.dragPan.enable();
    }

    m.on('mousedown', 'start-end-points-layer', onMouseDown);
    m.on('mousemove', onMouseMove);
    m.on('mouseup', 'start-end-points-layer', onMouseUp);

    return () => {
      m.off('mousedown', 'start-end-points-layer', onMouseDown);
      m.off('mousemove', onMouseMove);
      m.off('mouseup', 'start-end-points-layer', onMouseUp);
    };
  }, [startEndMode, startPoint, endPoint]);

  // [START/END SEGMENT SELECTION] Highlight selected road segment and clear on exit
  useEffect(() => {
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
      return;
    }

    // Only highlight if both points are set and startEndMode is active
    if (startEndMode && startPoint && endPoint) {
      // Always snap both points to nearest road segment using all visible drivable roads
      const roadLayerIds = getRoadLayerIds(m);
      let featuresRaw = [];
      try {
        featuresRaw = m.queryRenderedFeatures({ layers: roadLayerIds });
      } catch (err) {
        console.error('Error querying rendered features:', err);
        return;
      }
      // Only drivable road segments
      const roadNetwork = featuresRaw.flatMap(feat => {
        if (feat.geometry?.type === "LineString" && isDrivableRoad(feat.properties)) {
          return [turf.lineString(feat.geometry.coordinates, feat.properties)];
        } else if (feat.geometry?.type === "MultiLineString" && isDrivableRoad(feat.properties)) {
          return feat.geometry.coordinates.map(coords => turf.lineString(coords, feat.properties));
        }
        return [];
      });
      // Snap both points to the nearest road segment in the network
      function findNearestPointOnNetwork(point, network) {
        let nearest = null;
        let minDist = Infinity;
        network.forEach(line => {
          const snapped = turf.nearestPointOnLine(line, turf.point(point), { units: 'meters' });
          if (snapped.properties.dist < minDist) {
            minDist = snapped.properties.dist;
            nearest = snapped.geometry.coordinates;
          }
        });
        return nearest || point;
      }
      const startSnapped = findNearestPointOnNetwork(startPoint, roadNetwork);
      const endSnapped = findNearestPointOnNetwork(endPoint, roadNetwork);

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
        const s = nearestSnap(lines, a);
        const t = nearestSnap(lines, b);
        if (!s || !t) return null;

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
          // Directed edge OUT of start only; choose the neighbor most aligned with the overall direction toward end
          const dirA = dir(s.coord, A);
          const dirB = dir(s.coord, B);
          const scoreA = dot(dirA, globalDir);
          const scoreB = dot(dirB, globalDir);
          const pick = scoreA >= scoreB ? { to: kA, coords: [s.coord, A] } : { to: kB, coords: [s.coord, B] };
          graph.get(startK).push(pick);
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
          // Directed edge INTO end only; choose the neighbor most aligned with the overall direction
          const dirAin = dir(A, t.coord);
          const dirBin = dir(B, t.coord);
          const scoreAin = dot(dirAin, globalDir);
          const scoreBin = dot(dirBin, globalDir);
          const pickIn = scoreAin >= scoreBin ? { from: kA, coords: [A, t.coord] } : { from: kB, coords: [B, t.coord] };
          const srcK = pickIn.from;
          graph.get(srcK).push({ to: endK, coords: pickIn.coords });
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
      // Clamp to reasonable length if needed
      const MAX_BLOCK_M = 260;
      const len = turf.length(pathLine, { units: 'meters' });
      let finalLine = pathLine;
      if (len > MAX_BLOCK_M) {
        // Clamp around midpoint
        const mid = Math.floor(pathLine.geometry.coordinates.length / 2);
        const back = turf.along(pathLine, Math.max(0, len / 2 - MAX_BLOCK_M / 2), { units: 'meters' });
        const fwd = turf.along(pathLine, len / 2 + MAX_BLOCK_M / 2, { units: 'meters' });
        finalLine = turf.lineSlice(back, fwd, pathLine);
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
        if (!m.getLayer('selected-road-segment-layer')) {
          m.addLayer({
            id: 'selected-road-segment-layer',
            type: 'line',
            source: 'selected-road-segment',
            paint: {
              'line-color': '#ff9800',
              'line-width': 6,
              'line-opacity': 0.85,
              'line-dasharray': [2, 2]
            }
          });
        }
      }
    }
  }, [startEndMode, startPoint, endPoint]);

  // --- Save / finalize helpers -----------------------------------

  const canFinalizePolygon = polygonActive && drawnCoords.length >= 3;
  const canFinalizeStreets = streetsActive && selectedSegments.length > 0;
  
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

  // Create a GeoJSON Feature from the drawn polygon and metadata
  // nameOverride is only used when duplicating an existing saved zone
  function makeFeatureFromDrawn(nameOverride) {
    if (!zoneSummary || drawnCoords.length < 3) return null;
    const closed = [...drawnCoords, drawnCoords[0]];
    return {
      type: "Feature",
      properties: {
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
        prev.map((f, i) => (i === editingSavedIndex ? feature : f))
      );
    } else {
      setSavedZones((prev) => [feature, ...prev]);
    }

    // Reset draw state
    setShowSavePanel(false);
    setPendingName("");
    setPendingDescription("");
    setDrawTool("none");
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
    setDrawTool("none");
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
      setDrawTool("none");
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
    setDrawTool("polygon");
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
        <div style={{ display: "grid", gap: "0.25rem", minWidth: 220 }}>
          <div style={labelStyle}>Drawing mode</div>
          <select
            value={drawTool}
            onChange={(e) => setDrawTool(e.target.value)}
            style={selectStyle}
            title="Choose how you want to draw"
          >
            <option value="none">None</option>
            <option value="polygon">Polygon</option>
            <option value="streets">Street segments</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: "0.25rem", minWidth: 140 }}>
          <div style={labelStyle}>Basemap</div>
          <select
            value={basemapStyle}
            onChange={(e) => setBasemapStyle(e.target.value)}
            title="Switch base map style"
            style={selectStyle}
          >
            <option value="streets">Streets</option>
            <option value="satellite">Satellite</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: "0.25rem", minWidth: 160 }}>
          <div style={labelStyle}>Zone type</div>
          <select
            value={useType}
            onChange={(e) => setUseType(e.target.value)}
            title="Choose category/color for the polygon you're drawing"
            style={selectStyle}
          >
            <option value="mixed-use">Mixed Use</option>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>

        {/* ✅ Street selection controls now inside the panel */}
        <div style={{ display: "grid", gap: "0.25rem", minWidth: 180 }}>
          <div style={labelStyle}>Street selection</div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                if (startEndMode) {
                  // Exiting start/end mode: clear selections immediately
                  setStartPoint(null);
                  setEndPoint(null);
                }
                setStartEndMode((v) => !v);
              }}
              title="Select a road segment by clicking start and end points"
              style={{
                ...buttonStyle,
                backgroundColor: startEndMode ? "#28a745" : "#ffc107",
              }}
            >
              {startEndMode ? "Exit Start/End Mode" : "Select by Start/End"}
            </button>
          </div>
        </div>
      </div>

      {/* Zone type legend */}
      <div
        style={{
          position: "absolute",
          left: "1rem",
          bottom: "1rem",
          zIndex: 10,
          backgroundColor: "white",
          padding: "0.5rem 0.75rem",
          borderRadius: "0.5rem",
          boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
          fontSize: "0.9rem",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
          Zone type
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.25rem",
          }}
        >
                   <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: colorByUse["mixed-use"],
              display: "inline-block",
            }}
          />
          Mixed Use
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.25rem",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: colorByUse["residential"],
              display: "inline-block",
            }}
          />
          Residential
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: colorByUse["commercial"],
              display: "inline-block",
            }}
          />
          Commercial
        </div>
      </div>

      {/* Help box during draw */}
      {drawMode && (
        <div
          style={{
            position: "absolute",
            top: "6rem",
            left: "1rem",
            backgroundColor: "#fffff3",
            border: "1px solid #ccc",
            padding: "1rem",
            borderRadius: "0.5rem",
            zIndex: 11,
            maxWidth: "300px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <button
            onClick={() => setShowHelpBox(!showHelpBox)}
            style={{
              position: "absolute",
              top: "0.25rem",
              right: "0.5rem",
              border: "none",
              background: "transparent",
              fontSize: "1.2rem",
              cursor: "pointer",
              color: "#888",
            }}
            aria-label="Toggle help"
          >
            {showHelpBox ? "×" : "ℹ️"}
          </button>
          {showHelpBox && (
            <>
              <h4 style={{ marginTop: 0 }}>Drawing Help</h4>
              <ul
                style={{
                  paddingLeft: "1rem",
                  fontSize: "0.9rem",
                  lineHeight: "1.5",
                }}
              >
                <li>Click to add points</li>
                <li>Right-click a point to delete it</li>
                <li>Drag a point to move it</li>
                <li>
                  Use the <strong>Zone type</strong> dropdown (top-left) to
                  change a zone’s category/color while drawing or editing. For
                  saved zones, change <strong>Type</strong> in the Saved Zones
                  list.
                </li>
              </ul>
            </>
          )}
        </div>
      )}

      {/* Summary + Saved panel */}
      {showRightPanel && (
        <>
          <button
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
            {/* Show the action, not the state */}
            {sidebarVisible ? "❯" : "❮"}
          </button>

          <div
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
            {/* ← resizer HANDLE (child), not the container */}
            <div
              onMouseDown={startSidebarResize}
              title="Resize"
              style={{
                position: "absolute",
                left: 0, // sits over the left padding area
                top: 0,
                width: 6,
                height: "100%",
                cursor: "ew-resize",
                background: "transparent",
              }}
            />
            {zoneSummary && (
              <>
                <div style={cardStyle}>
                  <h2
                    style={{
                      fontSize: "1.2rem",
                      marginBottom: "0.75rem",
                      borderBottom: "2px solid #eee",
                      paddingBottom: "0.5rem",
                    }}
                  >
                    Zone Summary
                  </h2>

                  <p style={{ marginBottom: "0.5rem" }}>
                    <strong>Name:</strong> {displayName}
                  </p>
                  <p style={{ marginBottom: "0.5rem" }}>
                    <strong>Type:</strong> {zoneSummary.useType}
                  </p>
                  <p style={{ marginBottom: "0.5rem" }}>
                    <strong>Area:</strong> {zoneSummary.areaM2.toFixed(2)} m² /{" "}
                    {zoneSummary.areaFt2.toFixed(2)} ft²
                  </p>
                  <p style={{ marginBottom: "1rem" }}>
                    <strong>Centroid:</strong>{" "}
                    {zoneSummary.centroid[0].toFixed(6)},{" "}
                    {zoneSummary.centroid[1].toFixed(6)}
                  </p>

                  {zoneSummary.address && (
                    <>
                      <h3
                        style={{
                          fontSize: "1.05rem",
                          margin: "1rem 0 0.5rem",
                          borderBottom: "1px solid #ddd",
                          paddingBottom: "0.25rem",
                        }}
                      >
                        Location Details
                      </h3>
                      <ul
                        style={{
                          paddingLeft: "1rem",
                          listStyle: "disc",
                          lineHeight: "1.6",
                        }}
                      >
                        {zoneSummary.address.street && (
                          <li>
                            <strong>Street:</strong>{" "}
                            {zoneSummary.address.street}
                          </li>
                        )}
                        {zoneSummary.address.postalCode && (
                          <li>
                            <strong>Postal Code:</strong>{" "}
                            {zoneSummary.address.postalCode}
                          </li>
                        )}
                        {zoneSummary.address.neighborhood && (
                          <li>
                            <strong>Neighborhood:</strong>{" "}
                            {zoneSummary.address.neighborhood}
                          </li>
                        )}
                        {zoneSummary.address.city && (
                          <li>
                            <strong>City:</strong> {zoneSummary.address.city}
                          </li>
                        )}
                        {zoneSummary.address.state && (
                          <li>
                            <strong>State:</strong> {zoneSummary.address.state}
                          </li>
                        )}
                        {zoneSummary.address.country && (
                          <li>
                            <strong>Country:</strong>{" "}
                            {zoneSummary.address.country}
                          </li>
                        )}
                      </ul>
                    </>
                  )}

                  {zoneSummary.streets && zoneSummary.streets.length > 0 && (
                    <>
                      <h3
                        style={{
                          fontSize: "1.05rem",
                          margin: "1rem 0 0.5rem",
                          borderBottom: "1px solid #ddd",
                          paddingBottom: "0.25rem",
                        }}
                      >
                        Streets intersecting zone
                      </h3>
                      <ul
                        style={{
                          paddingLeft: "1rem",
                          listStyle: "disc",
                          lineHeight: "1.6",
                        }}
                      >
                        {zoneSummary.streets.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </>
                  )}

                  {/* Finalize / Save block only for drawings */}
                  {(summaryContext === "draw" || editingSavedIndex != null) && (
                    <div
                      style={{
                        marginTop: "1rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid #eee",
                      }}
                    >
                      {!showSavePanel ? (
                        <button
                          onClick={finalizeCurrent}
                          disabled={!(canFinalizePolygon || canFinalizeStreets)}
                          style={{ ...buttonStyle, backgroundColor: "#17a2b8", opacity: (canFinalizePolygon || canFinalizeStreets) ? 1 : 0.6 }}
                          title={polygonActive ? "Save this polygon" : streetsActive ? "Save buffered street corridor(s)" : ""}
                        >
                          Finalize & Save
                        </button>
                      ) : (
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          {editingSavedIndex != null && (
                            <div style={{ fontSize: "0.85rem", color: "#555" }}>
                              Editing saved zone #{editingSavedIndex + 1}
                            </div>
                          )}
                          <label style={{ fontSize: "0.85rem" }}>Name</label>
                          <input
                            value={pendingName}
                            onChange={(e) => setPendingName(e.target.value)}
                            placeholder="Custom Zone"
                            style={{
                              padding: "0.5rem",
                              border: "1px solid #ccc",
                              borderRadius: 6,
                            }}
                          />
                          <label style={{ fontSize: "0.85rem" }}>
                            Description
                          </label>
                          <textarea
                            value={pendingDescription}
                            onChange={(e) =>
                              setPendingDescription(e.target.value)
                            }
                            rows={3}
                            placeholder="Notes, purpose, constraints"
                            style={{
                              padding: "0.5rem",
                              border: "1px solid #ccc",
                              borderRadius: 6,
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: "0.5rem",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={saveZone}
                              style={{
                                ...buttonStyle,
                                backgroundColor: "#28a745",
                              }}
                            >
                              {editingSavedIndex != null
                                ? "Save changes"
                                : "Save"}
                            </button>
                            {editingSavedIndex != null && (
                              <button
                                onClick={saveAsNewZone}
                               
                                style={{ ...buttonStyle }}
                              >
                                Save as new
                              </button>
                            )}
                            <button
                              onClick={handleCancelSave}
                              style={{ ...buttonStyle }}
                            >
                              Cancel

                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

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
                    {savedZones.map((f, idx) => (
                      <li
                        key={idx}
                        style={{
                          background: "#fff", // item cards pop against the blue-ish container
                          border: "1px solid #e5e5e5",
                          borderRadius: 8,
                          padding: "0.5rem",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {f.properties?.name || `Zone ${idx + 1}`}
                          {selectedSavedIndex === idx ? " • selected" : ""}
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
                          <span style={{ fontSize: "0.85rem" }}>Type</span>
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
                            title={
                              isEditingSaved
                                ? "Finish or cancel current edit first"
                                : "Select"
                            }
                            style={{
                              ...buttonStyle,
                              opacity: isEditingSaved ? 0.6 : 1,
                              cursor: isEditingSaved
                                ? "not-allowed"
                                : "pointer",
                            }}
                          >
                            Select
                          </button>

                          <button
                            disabled={
                              isEditingSaved && editingSavedIndex !== idx
                            }
                            onClick={() => {
                              if (isEditingSaved && editingSavedIndex !== idx)
                                return;
                              loadSavedIntoDraw(idx, true);
                            }}
                            title={
                              isEditingSaved && editingSavedIndex !== idx
                                ? "Finish or cancel current edit first"
                                : "Edit geometry"
                            }
                            style={{
                              ...buttonStyle,
                              backgroundColor: "#17a2b8",
                              opacity:
                                isEditingSaved && editingSavedIndex !== idx
                                  ? 0.6
                                  : 1,
                              cursor:
                                isEditingSaved && editingSavedIndex !== idx
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            {isEditingSaved && editingSavedIndex === idx
                              ? "Editing…"
                              : "Edit geometry"}
                          </button>

                          <button
                            disabled={
                              isEditingSaved && editingSavedIndex !== idx
                            }
                            onClick={() => deleteSaved(idx)}
                            title={
                              isEditingSaved && editingSavedIndex !== idx
                                ? "Finish or cancel current edit first"
                                : "Delete"
                            }
                            style={{
                              ...buttonStyle,
                              backgroundColor: "#dc3545",
                              color: "#fff",
                              opacity:
                                isEditingSaved && editingSavedIndex !== idx
                                  ? 0.6
                                  : 1,
                              cursor:
                                isEditingSaved && editingSavedIndex !== idx
                                  ? "not-allowed"
                                  : "pointer",
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
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