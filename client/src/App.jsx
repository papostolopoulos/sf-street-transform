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

  // [SEGMENT] state
  const [segmentMode, setSegmentMode] = useState(false);
  const [selectedSegments, setSelectedSegments] = useState([]); // Array<Feature<LineString|MultiLineString>>
  const [segmentWidthMeters, setSegmentWidthMeters] = useState(16); // corridor total width

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

  // Only line layers for picking/intersection logic
  function getRoadLineLayerIds(mapInstance) {
    const style = mapInstance.getStyle();
    if (!style?.layers) return [];
    const tokens = ["transportation", "road", "street", "highway"];
    return style.layers
      .filter((lyr) => {
        const id = (lyr.id || "").toLowerCase();
        const sl = (lyr["source-layer"] || "").toLowerCase();
        return lyr.type === "line" && tokens.some(t => id.includes(t) || sl.includes(t));
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

    const [minLng, minLat, maxLng, maxLat] = turf.bbox(polygon);
    const p1 = mapInstance.project([minLng, minLat]);
    const p2 = mapInstance.project([maxLng, maxLat]);
    const pad = 12;
    const pixelBox = [[Math.min(p1.x, p2.x)-pad, Math.min(p1.y, p2.y)-pad],[Math.max(p1.x, p2.x)+pad, Math.max(p1.y, p2.y)+pad]];
    const options = layerIds.length ? { layers: layerIds } : undefined;

    let candidates = mapInstance.queryRenderedFeatures(pixelBox, options);
    if (!candidates || candidates.length === 0) {
      candidates = mapInstance.queryRenderedFeatures(options);
    }

    // keep only drivable line-like or their labels that belong to drivable lines
    candidates = (candidates || []).filter(f => isGeneralTrafficRoad(f.properties));

    const names = new Set();
    const nameKeys = ["name","name_en","name:en","name:latin","street","ref"];

    for (const feat of candidates) {
      let name = null;
      for (const k of nameKeys) { if (feat.properties?.[k]) { name = feat.properties[k]; break; } }
      if (!name && feat.properties?.class) name = feat.properties.class;
      if (!name) continue;

      const g = feat.geometry?.type;
      if (g === "LineString" || g === "MultiLineString") {
        const asTurf = g === "LineString"
          ? turf.lineString(feat.geometry.coordinates)
          : turf.multiLineString(feat.geometry.coordinates);
        if (turf.booleanIntersects(asTurf, polygon)) names.add(name);
      } else if (g === "Point") {
        const pt = turf.point(feat.geometry.coordinates);
        if (turf.booleanPointInPolygon(pt, polygon)) names.add(name);
      } else if (g === "MultiPoint") {
        for (const c of feat.geometry.coordinates || []) {
          const pt = turf.point(c);
          if (turf.booleanPointInPolygon(pt, polygon)) { names.add(name); break; }
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

    // [SEGMENT] sources for selected street lines and their buffered polygon
    if (!mapInstance.getSource("street-selections")) {
      mapInstance.addSource("street-selections", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }
    if (!mapInstance.getSource("street-buffer")) {
      mapInstance.addSource("street-buffer", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    // [SEGMENT] selected lines styling
    if (!mapInstance.getLayer("street-selections-line")) {
      mapInstance.addLayer({
        id: "street-selections-line",
        type: "line",
        source: "street-selections",
        paint: {
          "line-color": "#ff2d55",
          "line-width": 6,
          "line-opacity": 0.9,
        },
      });
    }
    if (!mapInstance.getLayer("street-selections-casing")) {
      mapInstance.addLayer({
        id: "street-selections-casing",
        type: "line",
        source: "street-selections",
        paint: {
          "line-color": "#ffffff",
          "line-width": 2,
          "line-opacity": 0.9,
        },
      });
    }

    // [SEGMENT] buffered polygon styling
    if (!mapInstance.getLayer("street-buffer-fill")) {
      mapInstance.addLayer({
        id: "street-buffer-fill",
        type: "fill",
        source: "street-buffer",
        paint: {
          "fill-color": "#ff9fbf",
          "fill-opacity": 0.25,
        },
      });
    }
    if (!mapInstance.getLayer("street-buffer-outline")) {
      mapInstance.addLayer({
        id: "street-buffer-outline",
        type: "line",
        source: "street-buffer",
        paint: {
          "line-color": "#d61b5b",
          "line-width": 2,
        },
      });
    }
  }

  // [SEGMENT] refresh selection and buffer sources
  function refreshStreetSelectionData(mapInstance, lines, totalWidthMeters) {
    const linesFC = { type: "FeatureCollection", features: lines || [] };
    mapInstance.getSource("street-selections")?.setData(linesFC);

    const buffered = buildBufferedPolygonFromSegments(lines || [], totalWidthMeters);
    const bufFC = buffered
      ? { type: "FeatureCollection", features: [buffered] }
      : { type: "FeatureCollection", features: [] };
    mapInstance.getSource("street-buffer")?.setData(bufFC);
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
  async function buildSummaryFromFeature(mapInstance, feature, typeFallback) {
    if (!feature?.geometry?.type || feature.geometry.type !== "Polygon")
      return null;

    const poly = feature; // GeoJSON Feature<Polygon>
    const areaM2 = turf.area(poly);
    const areaFt2 = convertToSquareFeet(areaM2);

    // Safe centroid
    const centroidPt = turf.centroid(poly).geometry.coordinates; // [lng,lat]

    // Streets from visible road layers
    const streets = getIntersectingStreetNames(mapInstance, poly);

    // Reverse geocode
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

  //Gives asymmetric padding when the sidebar is visible
  // Add this helper
  function getMapPadding() {
    const base = 40;
    // Keep the polygon away from the sidebar by padding its side
    const rightPad = sidebarVisible ? sidebarWidth + 24 : base;
    return { top: base, bottom: base, left: base, right: rightPad };
  }

  // [SEGMENT] unique key builder for toggle logic
  function keyForRenderedFeature(f) {
    const sl = f?.sourceLayer || f?.source_layer || f?.["source-layer"] || f?.layer?.["source-layer"] || "";
    const pid = f?.id ?? f?.properties?.id ?? f?.properties?.osm_id ?? f?.properties?.osm_way_id ?? Math.random();
    return `${sl}::${pid}`;
  }

  // [SEGMENT] normalize a rendered road feature into GeoJSON Feature(s)
  function toLineFeatures(renderedFeature) {
    const g = renderedFeature?.geometry?.type || renderedFeature?.geometry?.type;
    if (!g) return [];
    const geom = renderedFeature.geometry;
    const props = { ...(renderedFeature.properties || {}) };
    if (g === "LineString") {
      return [{ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: geom.coordinates } }];
    }
    if (g === "MultiLineString") {
      return [{ type: "Feature", properties: props, geometry: { type: "MultiLineString", coordinates: geom.coordinates } }];
    }
    return [];
  }

  // --- [SEGMENT] precise selection helpers ------------------------------------

  // Flatten any LineString/MultiLineString to an array of LineString features.
  function explodeToLineStrings(feat) {
    if (!feat?.geometry) return [];
    const g = feat.geometry.type;
    const props = { ...(feat.properties || {}) };
    if (g === "LineString") return [{ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: feat.geometry.coordinates } }];
    if (g === "MultiLineString") {
      return feat.geometry.coordinates.map(coords => ({
        type: "Feature",
        properties: props,
        geometry: { type: "LineString", coordinates: coords }
      }));
    }
    return [];
  }

  // Pixel box around a screen point for context querying
  function pixelBoxAround(point, r = 40) {
    return [[point.x - r, point.y - r], [point.x + r, point.y + r]];
  }

  // Pick the closest line-string road feature at the click location
  function pickClosestRoadLineAtClick(mapInstance, e) {
    const lineLayerIds = getRoadLineLayerIds(mapInstance);
    const opts = lineLayerIds.length ? { layers: lineLayerIds } : undefined;

    const pt = turf.point([e.lngLat.lng, e.lngLat.lat]);
    const candidates = (mapInstance.queryRenderedFeatures(pixelBoxAround(e.point, 60), opts) || [])
      .flatMap(explodeToLineStrings)
      .filter(f => isGeneralTrafficRoad(f.properties)); // <-- drivable only

    if (!candidates.length) return null;

    let best = null, bestD = Infinity;
    for (const lf of candidates) {
      try {
        const d = turf.pointToLineDistance(pt, lf, { units: "meters" });
        if (d < bestD) { bestD = d; best = lf; }
      } catch {}
    }
    return best;
  }

  // Remove near-duplicate points (same clicked line) by rounding coords
  function dedupePointsOnLine(points, precision = 6) {
    const seen = new Set();
    const out = [];
    for (const p of points) {
      const c = p?.geometry?.coordinates;
      if (!c) continue;
      const key = `${c[0].toFixed(precision)},${c[1].toFixed(precision)}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
    return out;
  }

  // Slice a clicked base line between the two nearest intersections on that line
  function sliceBetweenIntersections(mapInstance, baseLine, e) {
    const layerIds = getRoadLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;

    // Query a slightly larger box to gather neighboring road lines to intersect with
    const neighbors = (mapInstance.queryRenderedFeatures(pixelBoxAround(e.point, 90), opts) || [])
      .flatMap(f => explodeToLineStrings(f));

    // Compute intersections of baseLine with neighbor lines
    let interPts = [];
    for (const nb of neighbors) {
      if (nb === baseLine) continue;
      try {
        const ints = turf.lineIntersect(baseLine, nb);
        if (ints && ints.features?.length) {
          for (const p of ints.features) {
            // project each intersection exactly onto baseLine
            const proj = turf.nearestPointOnLine(baseLine, p);
            interPts.push(proj);
          }
        }
      } catch {}
    }

    // Always include endpoints as fallback
    const coords = baseLine.geometry.coordinates;
    interPts.push(turf.point(coords[0]));
    interPts.push(turf.point(coords[coords.length - 1]));

    interPts = dedupePointsOnLine(interPts);

    // Distance along baseLine helper
    const lineStart = turf.point(coords[0]);
    const distAlong = (ptOnLine) =>
      turf.length(turf.lineSlice(lineStart, ptOnLine, baseLine), { units: "meters" });

    // Locate the clicked measure and all intersection measures
    const clickOn = turf.nearestPointOnLine(baseLine, turf.point([e.lngLat.lng, e.lngLat.lat]));
    const mClick = distAlong(clickOn);

    const measures = interPts.map(p => ({ pt: p, m: distAlong(p) }))
                            .sort((a, b) => a.m - b.m);

    // find nearest intersection before and after click
    let before = measures[0], after = measures[measures.length - 1];
    for (let i = 0; i < measures.length; i++) {
      const cur = measures[i];
      if (cur.m <= mClick) before = cur;
      if (cur.m >= mClick) { after = cur; break; }
    }
    // guard: if equal (clicked exactly at an intersection), expand to neighbors if possible
    if (before.m === after.m) {
      const idx = measures.findIndex(x => x.m === before.m);
      if (idx > 0) before = measures[idx - 1];
      if (idx < measures.length - 1) after = measures[idx + 1];
    }

    try {
      const seg = turf.lineSlice(before.pt, after.pt, baseLine);
      return seg;
    } catch {
      return null;
    }
  }

  // --- [SEGMENT] buffered polygon building and finalization ------------------------------------
  // [SEGMENT] build a buffered polygon from the current selection
  function buildBufferedPolygonFromSegments(lines, totalWidthMeters) {
    if (!lines.length) return null;
    const half = Math.max(0.5, totalWidthMeters / 2); // turf.buffer uses radius from the line
    let unionPoly = null;

    for (const lf of lines) {
      // guard for empty coordinates
      if (!lf?.geometry || !lf.geometry.coordinates || lf.geometry.coordinates.length === 0) continue;
      try {
        const buf = turf.buffer(lf, half, { units: "meters", steps: 8 });
        unionPoly = unionPoly ? turf.union(unionPoly, buf) : buf;
      } catch {}
    }

    // Ensure a Feature<Polygon>
    if (!unionPoly) return null;
    if (unionPoly.geometry.type === "Polygon") return unionPoly;
    if (unionPoly.geometry.type === "MultiPolygon") {
      // pick the largest part as a practical polygon
      const parts = unionPoly.geometry.coordinates.map(coords => turf.polygon(coords));
      parts.sort((a, b) => turf.area(b) - turf.area(a));
      return parts[0] || null;
    }
    return null;
  }

  // [SEGMENT] fly to current buffer
  function flyToCurrentBuffer() {
    if (!map.current) return;
    const buffered = buildBufferedPolygonFromSegments(selectedSegments, segmentWidthMeters);
    if (!buffered) return;
    const bb = turf.bbox(buffered);
    map.current.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: getMapPadding(), duration: 700 });
  }

  // [SEGMENT] finalize from street selection (saves as a new zone)
  async function finalizeStreetSelection() {
    const buffered = buildBufferedPolygonFromSegments(selectedSegments, segmentWidthMeters);
    if (!buffered) return;

    // compute summary just like buildSummaryFromFeature
    const summary = await buildSummaryFromFeature(map.current, buffered, useType);
    if (!summary) return;

    const name = `Street Segment Zone ${savedZones.length + 1}`;
    const feature = {
      type: "Feature",
      properties: {
        name,
        description: `Auto-buffered from ${selectedSegments.length} street segment(s) at ~${segmentWidthMeters} m width`,
        useType,
        areaM2: summary.areaM2,
        areaFt2: summary.areaFt2,
        address: summary.address,
      },
      geometry: buffered.geometry,
    };

    setSavedZones((prev) => [feature, ...prev]);

    // reset selection
    setSelectedSegments([]);
    refreshStreetSelectionData(map.current, [], segmentWidthMeters);

    // show the summary for what we just saved
    setZoneSummary(summary);
    setSummaryContext("saved");
    setSelectedSavedIndex(0); // newest at top
    flyToSaved(feature);
  }

  // Consider only general-traffic drivable roads (OSM highway=* or OpenMapTiles class)
  // Exclude: service/driveway/parking_aisle/alley, track, path, footway, cycleway, pedestrian, steps, etc.
  // Also exclude if access/motor_vehicle/vehicle explicitly forbids or restricts to destination/private.
  function isGeneralTrafficRoad(p = {}) {
    const hw  = (p.highway || "").toLowerCase();             // raw OSM (sometimes present)
    const cls = (p.class   || p.kind || "").toLowerCase();    // OpenMapTiles schema
    const service = (p.service || "").toLowerCase();
    const acc = [
      (p.access || "").toLowerCase(),
      (p.motor_vehicle || "").toLowerCase(),
      (p.motorcar || "").toLowerCase(),
      (p.vehicle || "").toLowerCase(),
    ];

    const ALLOWED_HW = new Set([
      "motorway","trunk","primary","secondary","tertiary",
      "unclassified","residential","living_street",
      "motorway_link","trunk_link","primary_link","secondary_link","tertiary_link",
    ]);

    // OpenMapTiles 'class' values
    const ALLOWED_CLASS = new Set([
      "motorway","trunk","primary","secondary","tertiary","minor",
      "residential","living_street","street"
    ]);

    const EXCLUDED_HW = new Set([
      "service","track","path","footway","cycleway","pedestrian","steps","corridor","bridleway","construction"
    ]);

    // hard exclusions
    if (EXCLUDED_HW.has(hw)) return false;
    if (cls === "service" || cls === "track" || cls === "path") return false;
    if (service) return false; // driveway/parking_aisle/alley/emergency_access etc → not general traffic
    if (acc.some(v => v === "no" || v === "private" || v === "destination")) return false;

    // allow if explicitly in the allowed sets
    if (hw && ALLOWED_HW.has(hw)) return true;
    if (cls && ALLOWED_CLASS.has(cls)) return true;

    return false;
  }

  // Fly to a saved zone by feature
  function flyToSaved(feature) {
    if (!map.current || !feature?.geometry) return;
    try {
      const bb = turf.bbox(feature);
      map.current.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: getMapPadding(), duration: 700 });
    } catch {}
  }

  // Pull a readable street name from properties
  function streetNameFromProps(p = {}) {
    return p.name || p["name:en"] || p.name_en || p.ref || p.street || null;
  }

  // Build a stitched "clicked road" by ID (ideal) or by name via endpoint adjacency
  function stitchClickedRoad(mapInstance, baseLine) {
    const layerIds = getRoadLayerIds(mapInstance);
    const opts = layerIds.length ? { layers: layerIds } : undefined;

    // Grab lots of road pieces in the viewport so we can stitch across tile boundaries
    const all = (mapInstance.queryRenderedFeatures(opts) || []).flatMap(explodeToLineStrings);
    if (!all.length) return baseLine;

    const idKeys = ["osm_id", "osm_way_id", "id"];
    const getId = (p={}) => idKeys.map(k => p[k]).find(v => v != null);
    const baseId = getId(baseLine.properties);
    const baseName = streetNameFromProps(baseLine.properties);

    // Prefer exact same way id, else fall back to "same name" chaining
    let pool = [];
    if (baseId != null) {
      pool = all.filter(l => getId(l.properties) === baseId);
    } else if (baseName) {
      pool = all.filter(l => streetNameFromProps(l.properties) === baseName);
    } else {
      pool = [baseLine];
    }
    if (!pool.length) pool = [baseLine];

    // Merge contiguous pieces
    try {
      const fc = { type: "FeatureCollection", features: pool };
      const combined = turf.combine(fc);
      const merged = turf.lineMerge(combined);
      // lineMerge may return a MultiLineString -> pick the one nearest to baseLine start
      const candidates = explodeToLineStrings(merged.features?.[0] || merged || pool[0]);
      if (!candidates.length) return pool[0];
      // pick longest as the main chain
      candidates.sort((a,b) => turf.length(b) - turf.length(a));
      return candidates[0];
    } catch {
      return pool[0];
    }
  }

  // Cut the stitched road at the two closest intersections (with any DIFFERENT road)
  function sliceBetweenIntersections(mapInstance, stitchedLine, e) {
    const lineLayerIds = getRoadLineLayerIds(mapInstance);
    const opts = lineLayerIds.length ? { layers: lineLayerIds } : undefined;

    const world = (mapInstance.queryRenderedFeatures(pixelBoxAround(e.point, 220), opts) || [])
      .flatMap(explodeToLineStrings)
      .filter(f => isGeneralTrafficRoad(f.properties));

    const idKeys = ["osm_id","osm_way_id","id"];
    const sameWay = (a, b) => idKeys.some(k => a?.properties?.[k] != null && a.properties[k] === b?.properties?.[k]);
    const baseName = streetNameFromProps(stitchedLine.properties);

    const interPts = [];
    for (const nb of world) {
      const sameName = baseName && streetNameFromProps(nb.properties) === baseName;
      if (sameWay(nb, stitchedLine) || sameName) continue; // only true cross streets

      try {
        const ints = turf.lineIntersect(stitchedLine, nb);
        for (const p of ints.features || []) {
          interPts.push(turf.nearestPointOnLine(stitchedLine, p));
        }
      } catch {}
    }

    // include endpoints as guards
    const coords = stitchedLine.geometry.coordinates;
    interPts.push(turf.point(coords[0]));
    interPts.push(turf.point(coords[coords.length - 1]));

    // de-dupe
    const seen = new Set(), uniq = [];
    for (const p of interPts) {
      const [x,y] = p.geometry.coordinates;
      const k = `${x.toFixed(7)},${y.toFixed(7)}`;
      if (!seen.has(k)) { seen.add(k); uniq.push(p); }
    }

    const start = turf.point(coords[0]);
    const distAlong = (pt) => turf.length(turf.lineSlice(start, pt, stitchedLine), { units: "meters" });
    const clickM = distAlong(turf.nearestPointOnLine(stitchedLine, turf.point([e.lngLat.lng, e.lngLat.lat])));

    const measures = uniq.map(pt => ({ pt, m: distAlong(pt) })).sort((a,b) => a.m - b.m);

    let before = measures[0], after = measures[measures.length - 1];
    for (let i=0;i<measures.length;i++) {
      const cur = measures[i];
      if (cur.m <= clickM) before = cur;
      if (cur.m >= clickM) { after = cur; break; }
    }
    if (before.m === after.m) {
      const idx = measures.findIndex(x => x.m === before.m);
      if (idx > 0) before = measures[idx-1];
      if (idx < measures.length-1) after = measures[idx+1];
    }

    try {
      return turf.lineSlice(before.pt, after.pt, stitchedLine);
    } catch {
      return null;
    }
  }

  // union the names directly from the selected segments into the summary.
  function namesFromSegments(segments) {
    const out = new Set();
    for (const f of segments) {
      if (!isGeneralTrafficRoad(f.properties)) continue;
      const name = streetNameFromProps(f.properties);
      if (name) out.add(name);
    }
    return Array.from(out);
  }

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
      refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
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
      refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
      applySelectedFilter(map.current, selectedSavedIndex);
    });
  }, [basemapStyle]);

  // Repaint saved zones if the list changes
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
    refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
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
    refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
  }, [drawnCoords]);

  // Recolor in-progress polygon immediately when Type changes
  useEffect(() => {
    if (!map.current) return;
    refreshMapData(map.current, drawnCoords, useType, savedZones);
    refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
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

  // [SEGMENT] handle map clicks to toggle *intersection-bounded* segments
  useEffect(() => {
    if (!map.current) return;
    const m = map.current;

    const onClick = (e) => {
      if (!segmentMode) return;

      const base = pickClosestRoadLineAtClick(m, e);
      if (!base || !isGeneralTrafficRoad(base.properties)) return;

      const stitched = stitchClickedRoad(m, base, e);   // <-- pass e
      const seg = sliceBetweenIntersections(m, stitched, e);
      if (!seg || !seg.geometry?.coordinates?.length) return;

      // Stable key from id (or street name) + endpoints
      const props = { ...(stitched.properties || {}) };
      const name = streetNameFromProps(props) || "—";
      const id = props.osm_id ?? props.osm_way_id ?? props.id ?? name; // <-- fallback
      const start = seg.geometry.coordinates[0];
      const end   = seg.geometry.coordinates[seg.geometry.coordinates.length - 1];
      const k = `${id}|${start[0].toFixed(6)},${start[1].toFixed(6)}->${end[0].toFixed(6)},${end[1].toFixed(6)}`;

      setSelectedSegments((prev) => {
        const byKey = new Map();
        prev.forEach((pf, i) => byKey.set(pf.__key, { i }));

        if (byKey.has(k)) {
          const { i } = byKey.get(k);
          const next = prev.slice(); next.splice(i,1);
          refreshStreetSelectionData(m, next, segmentWidthMeters);
          return next;
        } else {
          const name = streetNameFromProps(props);
          const nextSeg = { type: "Feature", properties: { ...props, __name: name }, geometry: seg.geometry, __key: k };
          const next = prev.concat([nextSeg]);
          refreshStreetSelectionData(m, next, segmentWidthMeters);
          return next;
        }
      });
    };

    m.on("click", onClick);
    return () => m.off("click", onClick);
  }, [segmentMode, segmentWidthMeters]);

  // [SEGMENT] refresh buffer if width changes
  useEffect(() => {
    if (!map.current) return;
    refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
  }, [segmentWidthMeters]);

  // [SEGMENT] keep sources updated on selectedSegments changes
  useEffect(() => {
    if (!map.current) return;
    refreshStreetSelectionData(map.current, selectedSegments, segmentWidthMeters);
  }, [selectedSegments]);

  // [SEGMENT] leaving segment mode clears selection
  useEffect(() => {
    if (!map.current) return;
    if (!segmentMode) {
      setSelectedSegments([]);
      refreshStreetSelectionData(map.current, [], segmentWidthMeters);
    }
  }, [segmentMode]);

  // When segment mode turns on, ensure we are not in draw mode
  useEffect(() => {
    if (segmentMode && drawMode) setDrawMode(false);
  }, [segmentMode]);

  // Leaving draw mode already resets its state in your code.
  // We also already clear segment selection when segmentMode goes off.

  // [SEGMENT] Build a "zone-like" summary for current buffered selection
  useEffect(() => {
    if (!map.current) return;

    if (!selectedSegments.length) {
      // clear summary if not drawing or viewing a saved zone
      if (!drawMode && selectedSavedIndex == null) {
        setZoneSummary(null);
        setSummaryContext(null);
      }
      return;
    }

    const buffered = buildBufferedPolygonFromSegments(selectedSegments, segmentWidthMeters);
    if (!buffered) return;

    (async () => {
      const summary = await buildSummaryFromFeature(map.current, buffered, useType);
      if (!summary) return;

      // merge names: (a) from buffer query, (b) from the selected segments themselves
      const picked = namesFromSegments(selectedSegments);           // <-- requires the helper from step 4a
      const queried = (summary.streets || []).filter(Boolean);
      const merged = Array.from(new Set([...queried, ...picked])).sort((a, b) => a.localeCompare(b));

      setZoneSummary({ ...summary, streets: merged });
      setSummaryContext("segments");
    })();
  }, [selectedSegments, segmentWidthMeters, useType, drawMode, selectedSavedIndex]);

  // If entering draw mode, ensure segment mode is off
  useEffect(() => {
    if (drawMode && segmentMode) setSegmentMode(false);
  }, [drawMode, segmentMode]);

  // --- Save / finalize helpers -----------------------------------
  const canFinalize = drawMode && drawnCoords.length >= 3;

  function finalizeZone() {
    if (!canFinalize) return;
    setShowSavePanel(true);
    if (!pendingName.trim())
      setPendingName(`Custom Zone ${savedZones.length + 1}`);
  }

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
    setDrawMode(false);
    setDrawnCoords([]);
    setZoneSummary(null);
    setEditingSavedIndex(null);
    setSummaryContext(null);
  }

  function saveAsNewZone() {
    const feature = makeFeatureFromDrawn();
    if (!feature) return;
    setSavedZones((prev) => [feature, ...prev]);
    // Keep editing state off after saving as new
    setShowSavePanel(false);
    setPendingName("");
    setPendingDescription("");
    setDrawMode(false);
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
      setDrawMode(false); // triggers cleanup via effect
      setDrawnCoords([]);
      setZoneSummary(null);
      setEditingSavedIndex(null);
      setSummaryContext(null);
    } else {
      // If drawing a brand-new zone, just close the save panel (keep drawing)
      setShowSavePanel(false);
    }
  }

  function deleteSaved(index) {
    setSavedZones((prev) => prev.filter((_, i) => i !== index));
    if (selectedSavedIndex === index) setSelectedSavedIndex(null);
  }

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

  function loadSavedIntoDraw(index, openSavePanel = false) {
    const f = savedZones[index];
    if (!f?.geometry?.coordinates?.[0]) return;

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

    // Finally flip to draw mode and paint the open ring
    setDrawMode(true);
    setDrawnCoords(openRing);
  }

  function updateSavedUseType(index, newType) {
    setSavedZones((prev) =>
      prev.map((f, i) =>
        i === index
          ? { ...f, properties: { ...(f.properties || {}), useType: newType } }
          : f
      )
    );
  }

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
        <div style={{ display: "grid", gap: "0.25rem", minWidth: 140 }}>
          <div style={labelStyle}>Drawing</div>
          <button
            onClick={() => setDrawMode(!drawMode)}
            disabled={segmentMode || selectedSegments.length > 0}
            title={
              segmentMode || selectedSegments.length > 0
                ? "Disable street selection first"
                : "Toggle drawing mode"
            }
            style={{
              ...buttonStyle,
              backgroundColor: drawMode ? "#28a745" : "#ffc107",
              opacity: segmentMode || selectedSegments.length > 0 ? 0.6 : 1,
              cursor: segmentMode || selectedSegments.length > 0 ? "not-allowed" : "pointer",
            }}
          >
            {drawMode ? "Exit Draw Mode" : "Enter Draw Mode"}
          </button>
        </div>

        {canFinalize && (
          <button onClick={finalizeZone} style={{ ...buttonStyle }}>
            Finalize zone
          </button>
        )}

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

        {/* [SEGMENT] Street selection controls */}
        <div style={{ display: "grid", gap: "0.25rem", minWidth: 180 }}>
          <div style={labelStyle}>Street selection</div>

          {/* Toggle + Zoom */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              onClick={() => setSegmentMode((v) => !v)}
              disabled={drawMode || drawnCoords.length > 0}
              title={
                drawMode || drawnCoords.length > 0
                  ? "Disable drawing first"
                  : "Select existing road segments to form a zone"
              }
              style={{
                ...buttonStyle,
                backgroundColor: segmentMode ? "#28a745" : "#ffc107",
                opacity: drawMode || drawnCoords.length > 0 ? 0.6 : 1,
                cursor: drawMode || drawnCoords.length > 0 ? "not-allowed" : "pointer",
              }}
            >
              {segmentMode ? "Exit Selection" : "Select Streets"}
            </button>

            <button
              onClick={flyToCurrentBuffer}
              disabled={drawMode || drawnCoords.length > 0 || !selectedSegments.length}
              style={{
                ...buttonStyle,
                opacity:
                  drawMode || drawnCoords.length > 0 || !selectedSegments.length
                    ? 0.6
                    : 1,
                cursor:
                  drawMode || drawnCoords.length > 0 || !selectedSegments.length
                    ? "not-allowed"
                    : "pointer",
              }}
              title={
                drawMode || drawnCoords.length > 0
                  ? "Disable drawing first"
                  : "Zoom to current buffer"
              }
            >
              Zoom to buffer
            </button>
          </div>

          {/* Width + Finalize/Clear */}
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            <label style={labelStyle}>Corridor width (m)</label>
            <input
              type="number"
              min={2}
              max={60}
              step={1}
              value={segmentWidthMeters}
              onChange={(e) =>
                setSegmentWidthMeters(Number(e.target.value || 0))
              }
              disabled={drawMode || drawnCoords.length > 0 || !segmentMode}
              style={{
                padding: "0.5rem",
                border: "1px solid #ccc",
                borderRadius: 6,
                width: 120,
                opacity:
                  drawMode || drawnCoords.length > 0 || !segmentMode ? 0.6 : 1,
                cursor:
                  drawMode || drawnCoords.length > 0 || !segmentMode
                    ? "not-allowed"
                    : "text",
              }}
              title={
                drawMode || drawnCoords.length > 0
                  ? "Disable drawing first"
                  : "Approx total corridor width to buffer streets"
              }
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                onClick={finalizeStreetSelection}
                disabled={drawMode || drawnCoords.length > 0 || !selectedSegments.length}
                style={{
                  ...buttonStyle,
                  backgroundColor: "#17a2b8",
                  opacity:
                    drawMode || drawnCoords.length > 0 || !selectedSegments.length
                      ? 0.6
                      : 1,
                  cursor:
                    drawMode || drawnCoords.length > 0 || !selectedSegments.length
                      ? "not-allowed"
                      : "pointer",
                }}
                title={
                  drawMode || drawnCoords.length > 0
                    ? "Disable drawing first"
                    : "Create a zone from the selected streets"
                }
              >
                Finalize from Streets
              </button>

              <button
                onClick={() => {
                  setSelectedSegments([]);
                  refreshStreetSelectionData(map.current, [], segmentWidthMeters);
                }}
                disabled={drawMode || drawnCoords.length > 0 || !selectedSegments.length}
                style={{
                  ...buttonStyle,
                  opacity:
                    drawMode || drawnCoords.length > 0 || !selectedSegments.length
                      ? 0.6
                      : 1,
                  cursor:
                    drawMode || drawnCoords.length > 0 || !selectedSegments.length
                      ? "not-allowed"
                      : "pointer",
                }}
                title={
                  drawMode || drawnCoords.length > 0
                    ? "Disable drawing first"
                    : "Clear current selection"
                }
              >
                Clear selection
              </button>
            </div>
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

      {/* Help box during street segment selection */}
      {segmentMode && (
        <div
          style={{
            position: "absolute",
            top: "6rem",
            left: "1rem",
            backgroundColor: "#f3f9ff",
            border: "1px solid #bcd",
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
              <h4 style={{ marginTop: 0 }}>Street Selection Help</h4>
              <ul
                style={{
                  paddingLeft: "1rem",
                  fontSize: "0.9rem",
                  lineHeight: "1.5",
                }}
              >
                <li>Click a street to add it to your selection.</li>
                <li>Click again to remove it.</li>
                <li>Use the <strong>Corridor width</strong> field to adjust buffer size.</li>
                <li>Click <strong>Finalize from Streets</strong> to save as a new zone.</li>
                <li>Use <strong>Clear selection</strong> to reset.</li>
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
                          onClick={finalizeZone}
                          style={{ ...buttonStyle, backgroundColor: "#17a2b8" }}
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
