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

  // Derived info for sidebar while drawing
  const [zoneSummary, setZoneSummary] = useState(null); // { areaM2, areaFt2, centroid, address, streets[], useType }

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

  // Visible road layers in current style
  function getRoadLayerIds(mapInstance) {
    const style = mapInstance.getStyle();
    if (!style?.layers) return [];
    return style.layers
      .filter(
        (lyr) =>
          lyr.type === "line" &&
          (lyr["source-layer"]?.toLowerCase().includes("transportation") ||
            lyr.id.toLowerCase().includes("road") ||
            lyr["source-layer"]?.toLowerCase().includes("road") ||
            lyr.id.toLowerCase().includes("street"))
      )
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

  // Streets that intersect the polygon
  function getIntersectingStreetNames(mapInstance, polygon) {
    const layerIds = getRoadLayerIds(mapInstance);
    if (!layerIds.length) return [];

    const bbox = turf.bbox(polygon); // [minX, minY, maxX, maxY]
    const sw = mapInstance.project([bbox[0], bbox[1]]);
    const ne = mapInstance.project([bbox[2], bbox[3]]);
    const pixelBox = [
      Math.min(sw.x, ne.x),
      Math.min(sw.y, ne.y),
      Math.max(sw.x, ne.x),
      Math.max(sw.y, ne.y),
    ];

    const candidates = mapInstance.queryRenderedFeatures(pixelBox, {
      layers: layerIds,
    });

    const names = new Set();
    for (const feat of candidates) {
      if (
        feat.geometry?.type !== "LineString" &&
        feat.geometry?.type !== "MultiLineString"
      )
        continue;
      const asTurf =
        feat.geometry.type === "LineString"
          ? turf.lineString(feat.geometry.coordinates)
          : turf.multiLineString(feat.geometry.coordinates);

      if (turf.booleanIntersects(asTurf, polygon)) {
        const name =
          feat.properties?.name ||
          feat.properties?.street ||
          feat.properties?.class ||
          null;
        if (name) names.add(name);
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
          // use the same color expression so highlight respects useType colors
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

    map.current.once("styledata", () => {
      ensureSourcesAndLayers(map.current);
      refreshMapData(map.current, drawnCoords, useType, savedZones);
      applySelectedFilter(map.current, selectedSavedIndex);
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
      }
    };

    m.on("click", "saved-zones-fill", onClickSaved);

    return () => {
      m.off("click", "saved-zones-fill", onClickSaved);
    };
  }, [savedZones, editingSavedIndex]);

  // Enter/exit draw mode housekeeping
  useEffect(() => {
    if (!map.current) return;
    const mapRef = map.current;

    if (!drawMode) {
      setDrawnCoords([]);
      setZoneSummary(null);
      setShowSavePanel(false);
      setEditingSavedIndex(null);
      refreshMapData(mapRef, [], useType, savedZones);
    } else {
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

  // Build Zone Summary when polygon has 3+ points
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
    });
  }, [drawnCoords, useType]);

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
  }

  // Cancel from the save panel
  function handleCancelSave() {
    if (editingSavedIndex != null) {
      // If we were editing an existing zone, cancel should exit edit mode entirely
      setShowSavePanel(false);
      setPendingName("");
      setPendingDescription("");
      setDrawMode(false); // triggers cleanup of drawn coords & summary via effect
      setDrawnCoords([]);
      setZoneSummary(null);
      setEditingSavedIndex(null);
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
      { padding: 40, duration: 700 }
    );
  }

  function loadSavedIntoDraw(index, openSavePanel = false) {
    const f = savedZones[index];
    if (!f?.geometry?.coordinates?.[0]) return;
    const ring = f.geometry.coordinates[0];
    const openRing = ring.slice(0, ring.length - 1);
    setUseType(f.properties?.useType || useType);
    setDrawMode(true);
    setDrawnCoords(openRing);
    setPendingName(f.properties?.name || "");
    setPendingDescription(f.properties?.description || "");
    setEditingSavedIndex(index);
    setShowSavePanel(openSavePanel);
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

  const showRightPanel = zoneSummary || savedZones.length > 0;

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div
        ref={mapContainer}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      <div style={controlPanelStyle}>
        <button
          onClick={() => setDrawMode(!drawMode)}
          style={{
            ...buttonStyle,
            backgroundColor: drawMode ? "#28a745" : "#ffc107",
          }}
        >
          {drawMode ? "Exit Draw Mode" : "Enter Draw Mode"}
        </button>

        {canFinalize && (
          <button onClick={finalizeZone} style={{ ...buttonStyle }}>
            Finalize zone
          </button>
        )}

        <select
          value={basemapStyle}
          onChange={(e) => setBasemapStyle(e.target.value)}
          style={selectStyle}
        >
          <option value="streets">Streets</option>
          <option value="satellite">Satellite</option>
        </select>

        <select
          value={useType}
          onChange={(e) => setUseType(e.target.value)}
          style={selectStyle}
        >
          <option value="mixed-use">Mixed Use</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
      </div>

      {/* Zone type */}
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
                  Use the <strong>Type</strong> dropdown (top-left) to change a
                  zone’s category/color while drawing or editing. For saved
                  zones, change <strong>Type</strong> in the Saved Zones list.
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
              right: sidebarVisible ? "360px" : "0",
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
            aria-label="Toggle summary"
            title="Toggle summary"
          >
            {sidebarVisible ? "❮" : "❯"}
          </button>

          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              height: "100%",
              width: "360px",
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
            {zoneSummary && (
              <>
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
                  <strong>Name:</strong> {pendingName || "Custom Zone"}
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
                          <strong>Street:</strong> {zoneSummary.address.street}
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

                {/* Finalize / Save block */}
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
                      <label style={{ fontSize: "0.85rem" }}>Description</label>
                      <textarea
                        value={pendingDescription}
                        onChange={(e) => setPendingDescription(e.target.value)}
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
                          style={{ ...buttonStyle, backgroundColor: "#28a745" }}
                        >
                          {editingSavedIndex != null ? "Save changes" : "Save"}
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
              </>
            )}

            {/* Saved zones list */}
            {savedZones.length > 0 && (
              <div style={{ marginTop: zoneSummary ? "1rem" : 0 }}>
                <h2
                  style={{
                    fontSize: "1.2rem",
                    marginBottom: "0.5rem",
                    borderBottom: "2px solid #eee",
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
                    You're editing a zone. Finish or cancel to select or edit a
                    different one.
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
                              colorByUse[f.properties?.useType || "mixed-use"],
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
                            cursor: isEditingSaved ? "not-allowed" : "pointer",
                          }}
                        >
                          Select
                        </button>
                        <button
                          disabled={isEditingSaved && editingSavedIndex !== idx}
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
                          disabled={isEditingSaved && editingSavedIndex !== idx}
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
            )}
          </div>
        </>
      )}
    </div>
  );
}
