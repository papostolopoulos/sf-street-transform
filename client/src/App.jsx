import React, { useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as turf from "@turf/turf";

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);

  // Map + UI state
  const [basemapStyle, setBasemapStyle] = useState("streets");
  const [drawMode, setDrawMode] = useState(false);
  const [showHelpBox, setShowHelpBox] = useState(true);

  // User-drawn polygon coords (open ring, not yet closed)
  const [drawnCoords, setDrawnCoords] = useState([]);

  // Zone attributes (for in-progress drawing)
  const [useType, setUseType] = useState("mixed-use");

  // Sidebar visibility for compact toggle
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // Centralized colors per use type
  const colorByUse = {
    "mixed-use": "#7e57c2",
    residential: "#42a5f5",
    commercial: "#ef6c00",
  };

  // Derived info for sidebar while drawing or when a saved zone is selected
  // { areaM2, areaFt2, centroid, address, streets[], useType }
  const [zoneSummary, setZoneSummary] = useState(null);

  // Where the current summary comes from: 'draw' | 'saved' | null
  const [summaryContext, setSummaryContext] = useState(null);

  // Saved zones and finalize flow
  const [savedZones, setSavedZones] = useState(() => {
    try {
      const raw = localStorage.getItem("sfst.savedZones");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [pendingDescription, setPendingDescription] = useState("");

  // Selection and editing of saved zones
  const [selectedSavedIndex, setSelectedSavedIndex] = useState(null);
  const [editingSavedIndex, setEditingSavedIndex] = useState(null);

  // A) Add near other state (we’ll also use this in #2/#3/#6)
  const [sidebarWidth, setSidebarWidth] = useState(360);

  // Distinct “card” backgrounds
  const cardStyle = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "0.75rem",
  };

  const altCardStyle = {
    background: "#f7f9ff",
    border: "1px solid #dbeafe",
    borderRadius: 8,
    padding: "0.75rem",
  };

  // [START/END SEGMENT SELECTION] state
  const [startEndMode, setStartEndMode] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);

  // unified drawing selector
  const [drawTool, setDrawTool] = useState("none"); // "none" | "polygon" | "streets"
  const polygonActive = drawTool === "polygon";
  const streetsActive = drawTool === "streets";

  useEffect(() => {
    localStorage.setItem("sfst.savedZones", JSON.stringify(savedZones));
  }, [savedZones]);

  const MAPTILER_KEY = "DyVFUZmyKdCywxRTVU9B";
  const maptilerStyles = {
    streets: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
    satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
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
  const g = feature?.geometry?.type;
  if (!g || (g !== "Polygon" && g !== "MultiPolygon")) return null;

  const areaM2 = turf.area(feature);
  const areaFt2 = convertToSquareFeet(areaM2);

  // centroid that works for both Polygon & MultiPolygon
  const centroidPt =
    (turf.centerOfMass?.(feature) || turf.centroid(feature)).geometry.coordinates;

  // This works fine with MultiPolygon too
  const streets = getIntersectingStreetNames(mapInstance, feature);

  const addr = await reverseGeocode(centroidPt[0], centroidPt[1]);

  return {
    areaM2,
    areaFt2,
    centroid: centroidPt,
    address: addr,
    streets,
    useType: feature.properties?.useType || typeFallback || "mixed-use",
  };
}

  // Gives asymmetric padding when the sidebar is visible
  // to keep the polygon fully in view
  function getMapPadding() {
    const base = 40;
    // Keep the polygon away from the sidebar by padding its side
    const rightPad = sidebarVisible ? sidebarWidth + 24 : base;
    return { top: base, bottom: base, left: base, right: rightPad };
  }

  // Only LINE road layers (no labels)
function getRoadLineLayerIds(mapInstance) {
  const style = mapInstance.getStyle();
  if (!style?.layers) return [];
  const tokens = ["transportation", "road", "street", "highway"];
  return style.layers
    .filter(lyr => {
      const id = (lyr.id || "").toLowerCase();
      const sl = (lyr["source-layer"] || "").toLowerCase();
      return lyr.type === "line" && tokens.some(t => id.includes(t) || sl.includes(t));
    })
    .map(lyr => lyr.id);
}

// Normalize to LineString features (explode MultiLineString)
function explodeToLineStrings(feat) {
  if (!feat?.geometry) return [];
  const g = feat.geometry.type;
  const props = { ...(feat.properties || {}) };
  if (g === "LineString") {
    return [{ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: feat.geometry.coordinates } }];
  }
  if (g === "MultiLineString") {
    return feat.geometry.coordinates.map(coords => ({
      type: "Feature",
      properties: props,
      geometry: { type: "LineString", coordinates: coords },
    }));
  }
  return [];
}

// Pick a street name from various possible props
function streetNameFromProps(p = {}) {
  return p.name || p["name:en"] || p.name_en || p.ref || p.street || null;
}

// Stricter: roads that actually bound city blocks (used ONLY to find intersections)
function isBlockBoundingRoad(p = {}) {
  const hw  = (p.highway || "").toLowerCase();
  const cls = (p.class || p.kind || "").toLowerCase();
  const sub = (p.subclass || "").toLowerCase();
  const svc = (p.service || "").toLowerCase();

  const accs = [
    (p.access || "").toLowerCase(),
    (p.motor_vehicle || "").toLowerCase(),
    (p.motorcar || "").toLowerCase(),
    (p.vehicle || "").toLowerCase(),
  ];
  if (svc) return false;
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
      return [lngLat.lng, lngLat.lat];
    }
    console.log('Candidate features from queryRenderedFeatures:', featuresRaw);
    featuresRaw.forEach((f, i) => {
      console.log(`Feature #${i} layer.id:`, f.layer?.id, 'properties:', f.properties);
    });
    featuresRaw.forEach((f, i) => {
      console.log(`Feature #${i} properties:`, f.properties);
      if (f.geometry?.type === "LineString") {
        const pt = turf.point([lngLat.lng, lngLat.lat]);
        const line = turf.lineString(f.geometry.coordinates);
        const snapped = turf.nearestPointOnLine(line, pt, { units: 'meters' });
        console.log(`Feature #${i} snapped distance:`, snapped.properties.dist);
      }
    });
    // Filter only drivable roads
    const features = featuresRaw.filter(f => f.geometry?.type === "LineString" && isDrivableRoad(f.properties));
    const pt = turf.point([lngLat.lng, lngLat.lat]);
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
    mapRef.on("mouseup", handleMouseUp);
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
    // Snap to nearest road
    const snapped = getNearestRoadPoint(lngLat);
    if (!snapped) return;
    if (dragType === 'start') {
      setStartPoint(snapped);
    } else if (dragType === 'end') {
      setEndPoint(snapped);
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
  m.on('mouseup', onMouseUp);

  return () => {
    m.off('mousedown', 'start-end-points-layer', onMouseDown);
    m.off('mousemove', onMouseMove);
    m.off('mouseup', onMouseUp);
  };
}, [startEndMode, startPoint, endPoint]);

// [START/END SEGMENT SELECTION] Highlight selected road segment and clear on exit
useEffect(() => {
  if (!map.current) return;
  const m = map.current;

  // Remove previous highlight layer if exists
  if (m.getLayer('selected-road-segment')) {
    m.removeLayer('selected-road-segment');
  }
  if (m.getSource('selected-road-segment')) {
    m.removeSource('selected-road-segment');
  }

  // Only highlight if both points are set and startEndMode is active
  if (startEndMode && startPoint && endPoint) {
    // Highlight the segment between startPoint and endPoint
    m.addSource('selected-road-segment', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [startPoint, endPoint]
        },
        properties: {}
      }
    });
    m.addLayer({
      id: 'selected-road-segment',
      type: 'line',
      source: 'selected-road-segment',
      paint: {
        'line-color': '#0074D9', // bright blue
        'line-width': 8,
        'line-opacity': 0.85
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      }
    });
  }
}, [startEndMode, startPoint, endPoint]);

// Clear selections immediately when exiting start/end mode
useEffect(() => {
  if (!startEndMode) {
    setStartPoint(null);
    setEndPoint(null);
    if (map.current && map.current.getSource('start-end-points')) {
      map.current.getSource('start-end-points').setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }
}, [startEndMode]);

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
    maxWidth: "calc(100vw - 2rem)",
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