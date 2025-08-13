import React, { useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// ✅ Add Turf for geometry math and intersections
import * as turf from "@turf/turf";

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markerRef = useRef(null);

  const [overlayVisible, setOverlayVisible] = useState(true);
  const [basemapStyle, setBasemapStyle] = useState("streets");
  const [zoneType, setZoneType] = useState("mixed-use");

  // Preset zone reverse‑geocode
  const [addressInfo, setAddressInfo] = useState(null);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [drawnCoords, setDrawnCoords] = useState([]);
  const [showHelpBox, setShowHelpBox] = useState(true);

  // ✅ Custom zone summary state
  const [customZoneInfo, setCustomZoneInfo] = useState(null); // { areaM2, areaFt2, centroid, address, streets[] }

  const MAPTILER_KEY = "DyVFUZmyKdCywxRTVU9B";

  const maptilerStyles = {
    streets: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_KEY}`,
    satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
  };

  const zoneOverlays = {
    residential: [
      {
        type: "Feature",
        properties: { name: "Family Park" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.4232, 37.7748],
              [-122.4228, 37.7748],
              [-122.4228, 37.7745],
              [-122.4232, 37.7745],
              [-122.4232, 37.7748],
            ],
          ],
        },
      },
    ],
    "mixed-use": [
      {
        type: "Feature",
        properties: { name: "Parklet Zone" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.423, 37.775],
              [-122.422, 37.775],
              [-122.422, 37.7745],
              [-122.423, 37.7745],
              [-122.423, 37.775],
            ],
          ],
        },
      },
    ],
    commercial: [
      {
        type: "Feature",
        properties: { name: "Vendor Zone" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-122.4225, 37.7752],
              [-122.422, 37.7752],
              [-122.422, 37.7749],
              [-122.4225, 37.7749],
              [-122.4225, 37.7752],
            ],
          ],
        },
      },
    ],
  };

  const zoneOverlay = {
    type: "FeatureCollection",
    features: zoneOverlays[zoneType] || [],
  };

  // --- helpers ----------------------------------------------------

  function calculateAreaInSquareMeters(polygonCoordinates) {
    // Keep your original for preset zones. Turf for custom below.
    if (!polygonCoordinates || polygonCoordinates.length === 0) return 0;
    const coordinates = polygonCoordinates[0];
    if (coordinates.length < 4) return 0;
    const R = 6378137;
    let area = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const [x1, y1] = coordinates[i];
      const [x2, y2] = coordinates[i + 1];
      area +=
        (((x2 - x1) * Math.PI) / 180) *
        (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
    }
    return Math.abs((area * R * R) / 2);
  }

  function convertToSquareFeet(squareMeters) {
    return squareMeters * 10.7639;
  }

  function getPolygonCentroid(coords) {
    const ring = coords[0];
    let [xSum, ySum] = [0, 0];
    for (let i = 0; i < ring.length - 1; i++) {
      xSum += ring[i][0];
      ySum += ring[i][1];
    }
    const count = ring.length - 1;
    return [xSum / count, ySum / count];
  }

  // ✅ visible road layers in current style
  function getRoadLayerIds(mapInstance) {
    const style = mapInstance.getStyle();
    if (!style?.layers) return [];
    return style.layers
      .filter(
        (lyr) =>
          lyr.type === "line" &&
          // MapTiler styles often use these source-layer names
          (lyr["source-layer"]?.toLowerCase().includes("transportation") ||
            lyr.id.toLowerCase().includes("road") ||
            lyr["source-layer"]?.toLowerCase().includes("road") ||
            lyr.id.toLowerCase().includes("street"))
      )
      .map((lyr) => lyr.id);
  }

  // ✅ fetch address for centroid {lng,lat}
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

  // ✅ streets that intersect the polygon
  function getIntersectingStreetNames(mapInstance, polygon) {
    const layerIds = getRoadLayerIds(mapInstance);
    if (!layerIds.length) return [];

    // Use polygon bbox to limit candidates
    const bbox = turf.bbox(polygon); // [minX, minY, maxX, maxY] in lng/lat
    const sw = mapInstance.project([bbox[0], bbox[1]]);
    const ne = mapInstance.project([bbox[2], bbox[3]]);
    const rect = new maplibregl.LngLatBounds(
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]]
    );
    // queryRenderedFeatures accepts pixel box: [minX, minY, maxX, maxY]
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
      // Only LineString or MultiLineString
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

  function restoreDrawnLayers(mapInstance, drawnCoords) {
    if (!mapInstance || drawnCoords.length < 3) return;

    const closed = [...drawnCoords, drawnCoords[0]];

    const polygonData = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [closed] },
    };

    const pointData = {
      type: "FeatureCollection",
      features: drawnCoords.map((coord, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: { id: i },
      })),
    };

    if (!mapInstance.getSource("drawn-polygon")) {
      mapInstance.addSource("drawn-polygon", {
        type: "geojson",
        data: polygonData,
      });
    } else {
      mapInstance.getSource("drawn-polygon").setData(polygonData);
    }

    if (!mapInstance.getLayer("drawn-polygon-layer")) {
      mapInstance.addLayer({
        id: "drawn-polygon-layer",
        type: "fill",
        source: "drawn-polygon",
        paint: {
          "fill-color": "#00bcd4",
          "fill-opacity": 0.4,
        },
      });
    }

    if (!mapInstance.getSource("drawn-points")) {
      mapInstance.addSource("drawn-points", {
        type: "geojson",
        data: pointData,
      });
    } else {
      mapInstance.getSource("drawn-points").setData(pointData);
    }

    if (!mapInstance.getLayer("drawn-points-layer")) {
      mapInstance.addLayer(
        {
          id: "drawn-points-layer",
          type: "circle",
          source: "drawn-points",
          paint: {
            "circle-radius": 7,
            "circle-color": "#ff0000",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff",
          },
        },
        "drawn-polygon-layer"
      );
    }
  }

  // --- effects ----------------------------------------------------

  // Reverse geocode for preset zone centroid
  useEffect(() => {
    if (!map.current) return;
    const feature = zoneOverlays[zoneType]?.[0];
    if (!feature) return;
    const centroid = getPolygonCentroid(feature.geometry.coordinates);
    const [lng, lat] = centroid;

    reverseGeocode(lng, lat).then(setAddressInfo);
  }, [zoneType]);

  // Marker popup for preset zone
  useEffect(() => {
    if (!map.current) return;
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    const feature = zoneOverlays[zoneType]?.[0];
    if (!feature) return;

    const corner = feature.geometry.coordinates?.[0]?.[0];
    const name = feature.properties.name;
    const area = calculateAreaInSquareMeters(feature.geometry.coordinates);
    const areaFeet = convertToSquareFeet(area);
    const popupHTML = `
      <strong>${name}</strong><br/>
      ${area.toFixed(2)} m²<br/>
      ${areaFeet.toFixed(2)} ft²
    `;
    const popup = new maplibregl.Popup().setHTML(popupHTML);
    const marker = new maplibregl.Marker()
      .setLngLat(corner)
      .setPopup(popup)
      .addTo(map.current);
    marker.togglePopup();
    markerRef.current = marker;
  }, [zoneType]);

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
      map.current.addSource("overlay", {
        type: "geojson",
        data: zoneOverlay,
      });

      map.current.addLayer({
        id: "overlay-layer",
        type: "fill",
        source: "overlay",
        paint: {
          "fill-color": "#ff69b4",
          "fill-opacity": 0.5,
        },
        layout: {
          visibility: overlayVisible ? "visible" : "none",
        },
      });
    });
  }, []);

  // Style switch restore
  useEffect(() => {
    if (!map.current) return;

    map.current.setStyle(maptilerStyles[basemapStyle]);

    map.current.once("styledata", () => {
      if (!map.current.getSource("overlay")) {
        map.current.addSource("overlay", {
          type: "geojson",
          data: zoneOverlay,
        });
      }
      if (!map.current.getLayer("overlay-layer")) {
        map.current.addLayer({
          id: "overlay-layer",
          type: "fill",
          source: "overlay",
          paint: { "fill-color": "#ff69b4", "fill-opacity": 0.5 },
          layout: { visibility: overlayVisible ? "visible" : "none" },
        });
      }
      // ✅ Also restore drawn layers
      restoreDrawnLayers(map.current, drawnCoords);
    });
  }, [basemapStyle]);

  // Overlay visibility toggle
  useEffect(() => {
    if (!map.current || !map.current.getLayer("overlay-layer")) return;
    map.current.setLayoutProperty(
      "overlay-layer",
      "visibility",
      overlayVisible ? "visible" : "none"
    );
  }, [overlayVisible]);

  // Overlay data on zoneType change
  useEffect(() => {
    if (!map.current || !map.current.getSource("overlay")) return;
    map.current.getSource("overlay").setData({
      type: "FeatureCollection",
      features: zoneOverlays[zoneType] || [],
    });
  }, [zoneType]);

  // Draw click
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

  // Enter/exit draw mode housekeeping
  useEffect(() => {
    if (!map.current) return;
    const mapRef = map.current;

    if (!drawMode) {
      // Clear drawn visuals and summary
      setDrawnCoords([]);
      setCustomZoneInfo(null);

      if (mapRef.getLayer("drawn-polygon-layer"))
        mapRef.removeLayer("drawn-polygon-layer");
      if (mapRef.getSource("drawn-polygon"))
        mapRef.removeSource("drawn-polygon");
      if (mapRef.getLayer("drawn-points-layer"))
        mapRef.removeLayer("drawn-points-layer");
      if (mapRef.getSource("drawn-points")) mapRef.removeSource("drawn-points");
    } else {
      setShowHelpBox(true);
    }
  }, [drawMode]);

  // Drawn polygon -> render layers
  useEffect(() => {
    if (!map.current || drawnCoords.length < 1) return;

    const closed = [...drawnCoords, drawnCoords[0]];
    const polygonData = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [closed] },
    };

    const pointData = {
      type: "FeatureCollection",
      features: drawnCoords.map((coord, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: { id: i },
      })),
    };

    const mapRef = map.current;

    if (mapRef.getSource("drawn-polygon")) {
      mapRef.getSource("drawn-polygon").setData(polygonData);
    } else {
      mapRef.addSource("drawn-polygon", { type: "geojson", data: polygonData });
      mapRef.addLayer({
        id: "drawn-polygon-layer",
        type: "fill",
        source: "drawn-polygon",
        paint: { "fill-color": "#00bcd4", "fill-opacity": 0.4 },
      });
    }

    if (mapRef.getSource("drawn-points")) {
      mapRef.getSource("drawn-points").setData(pointData);
    } else {
      mapRef.addSource("drawn-points", { type: "geojson", data: pointData });
      mapRef.addLayer(
        {
          id: "drawn-points-layer",
          type: "circle",
          source: "drawn-points",
          paint: {
            "circle-radius": 7,
            "circle-color": "#ff0000",
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff",
          },
        },
        "drawn-polygon-layer"
      );
    }
  }, [drawnCoords]);

  // Point drag + delete
  useEffect(() => {
    if (!map.current || drawnCoords.length < 1) return;

    const mapRef = map.current;
    let isDragging = false;
    let dragIndex = null;
    const coordsRef = [...drawnCoords];

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

      const closed = [...coordsRef, coordsRef[0]];
      const polygonData = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [closed] },
      };
      const pointData = {
        type: "FeatureCollection",
        features: coordsRef.map((coord, i) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: coord },
          properties: { id: i },
        })),
      };

      if (mapRef.getSource("drawn-polygon"))
        mapRef.getSource("drawn-polygon").setData(polygonData);
      if (mapRef.getSource("drawn-points"))
        mapRef.getSource("drawn-points").setData(pointData);
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      dragIndex = null;
      setDrawnCoords([...coordsRef]);
      mapRef.getCanvas().style.cursor = "";
      mapRef.dragPan.enable();
    };

    const handleRightClick = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;
      const idToRemove = feature.properties.id;
      setDrawnCoords((prev) => {
        const u = [...prev];
        u.splice(idToRemove, 1);
        return u;
      });
      e.preventDefault();
    };

    mapRef.on("mousedown", "drawn-points-layer", handleMouseDown);
    mapRef.on("mousemove", handleMouseMove);
    mapRef.on("mouseup", handleMouseUp);
    mapRef.on("contextmenu", "drawn-points-layer", handleRightClick);

    return () => {
      mapRef.off("mousedown", "drawn-points-layer", handleMouseDown);
      mapRef.off("mousemove", handleMouseMove);
      mapRef.off("mouseup", handleMouseUp);
      mapRef.off("contextmenu", "drawn-points-layer", handleRightClick);
    };
  }, [drawnCoords]);

  // ✅ Build Custom Zone Summary whenever polygon has 3+ points
  useEffect(() => {
    if (!map.current || drawnCoords.length < 3) return;

    const closed = [...drawnCoords, drawnCoords[0]];
    const poly = turf.polygon([closed]);

    const areaM2 = turf.area(poly);
    const areaFt2 = convertToSquareFeet(areaM2);

    const centroidPt = turf.centroid(poly).geometry.coordinates; // [lng, lat]

    // streets from visible layers
    const streets = getIntersectingStreetNames(map.current, poly);

    // reverse geocode centroid
    reverseGeocode(centroidPt[0], centroidPt[1]).then((addr) => {
      setCustomZoneInfo({
        areaM2,
        areaFt2,
        centroid: centroidPt,
        address: addr,
        streets,
      });
    });
  }, [drawnCoords]);

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

  const currentFeature = zoneOverlays[zoneType]?.[0];
  const currentArea = currentFeature
    ? calculateAreaInSquareMeters(currentFeature.geometry.coordinates)
    : 0;
  const currentAreaFeet = convertToSquareFeet(currentArea);

  // Prefer custom zone summary if it exists
  const usingCustom = !!customZoneInfo;

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div
        ref={mapContainer}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      />

      <div style={controlPanelStyle}>
        <button
          onClick={() => setOverlayVisible(!overlayVisible)}
          style={buttonStyle}
        >
          {overlayVisible ? "Hide" : "Show"} Overlay
        </button>

        <button
          onClick={() => setDrawMode(!drawMode)}
          style={{
            ...buttonStyle,
            backgroundColor: drawMode ? "#28a745" : "#ffc107",
          }}
        >
          {drawMode ? "Exit Draw Mode" : "Enter Draw Mode"}
        </button>

        <select
          value={basemapStyle}
          onChange={(e) => setBasemapStyle(e.target.value)}
          style={selectStyle}
        >
          <option value="streets">Streets</option>
          <option value="satellite">Satellite</option>
        </select>

        <select
          value={zoneType}
          onChange={(e) => setZoneType(e.target.value)}
          style={selectStyle}
        >
          <option value="residential">Residential</option>
          <option value="mixed-use">Mixed Use</option>
          <option value="commercial">Commercial</option>
        </select>
      </div>

      <button
        onClick={() => setSidebarVisible(!sidebarVisible)}
        style={{
          position: "absolute",
          right: sidebarVisible ? "320px" : "0",
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
      >
        {sidebarVisible ? "❮" : "❯"}
      </button>

      {sidebarVisible && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            height: "100%",
            width: "320px",
            backgroundColor: "#fdfdfd",
            padding: "1.5rem",
            boxShadow: "-2px 0 10px rgba(0,0,0,0.1)",
            zIndex: 9,
            overflowY: "auto",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2
            style={{
              fontSize: "1.4rem",
              marginBottom: "1rem",
              borderBottom: "2px solid #eee",
              paddingBottom: "0.5rem",
            }}
          >
            {usingCustom ? "Custom Zone Summary" : "Zone Summary"}
          </h2>

          {!usingCustom && (
            <>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Name:</strong> {currentFeature?.properties?.name}
              </p>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Type:</strong> {zoneType}
              </p>
              <p style={{ marginBottom: "1rem" }}>
                <strong>Area:</strong> {currentArea.toFixed(2)} m² /{" "}
                {currentAreaFeet.toFixed(2)} ft²
              </p>

              {addressInfo && (
                <>
                  <h3
                    style={{
                      fontSize: "1.1rem",
                      margin: "1.5rem 0 0.5rem",
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
                    {addressInfo.street && (
                      <li>
                        <strong>Street:</strong> {addressInfo.street}
                      </li>
                    )}
                    {addressInfo.postalCode && (
                      <li>
                        <strong>Postal Code:</strong> {addressInfo.postalCode}
                      </li>
                    )}
                    {addressInfo.neighborhood && (
                      <li>
                        <strong>Neighborhood:</strong>{" "}
                        {addressInfo.neighborhood}
                      </li>
                    )}
                    {addressInfo.city && (
                      <li>
                        <strong>City:</strong> {addressInfo.city}
                      </li>
                    )}
                    {addressInfo.state && (
                      <li>
                        <strong>State:</strong> {addressInfo.state}
                      </li>
                    )}
                    {addressInfo.country && (
                      <li>
                        <strong>Country:</strong> {addressInfo.country}
                      </li>
                    )}
                  </ul>
                </>
              )}
            </>
          )}

          {usingCustom && (
            <>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Name:</strong> Custom Zone
              </p>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Type:</strong> User‑drawn polygon
              </p>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Area:</strong> {customZoneInfo.areaM2.toFixed(2)} m² /{" "}
                {customZoneInfo.areaFt2.toFixed(2)} ft²
              </p>
              <p style={{ marginBottom: "1rem" }}>
                <strong>Centroid:</strong>{" "}
                {customZoneInfo.centroid[0].toFixed(6)},{" "}
                {customZoneInfo.centroid[1].toFixed(6)}
              </p>

              {customZoneInfo.address && (
                <>
                  <h3
                    style={{
                      fontSize: "1.1rem",
                      margin: "1.5rem 0 0.5rem",
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
                    {customZoneInfo.address.street && (
                      <li>
                        <strong>Street:</strong> {customZoneInfo.address.street}
                      </li>
                    )}
                    {customZoneInfo.address.postalCode && (
                      <li>
                        <strong>Postal Code:</strong>{" "}
                        {customZoneInfo.address.postalCode}
                      </li>
                    )}
                    {customZoneInfo.address.neighborhood && (
                      <li>
                        <strong>Neighborhood:</strong>{" "}
                        {customZoneInfo.address.neighborhood}
                      </li>
                    )}
                    {customZoneInfo.address.city && (
                      <li>
                        <strong>City:</strong> {customZoneInfo.address.city}
                      </li>
                    )}
                    {customZoneInfo.address.state && (
                      <li>
                        <strong>State:</strong> {customZoneInfo.address.state}
                      </li>
                    )}
                    {customZoneInfo.address.country && (
                      <li>
                        <strong>Country:</strong>{" "}
                        {customZoneInfo.address.country}
                      </li>
                    )}
                  </ul>
                </>
              )}

              {customZoneInfo.streets?.length > 0 && (
                <>
                  <h3
                    style={{
                      fontSize: "1.1rem",
                      margin: "1.5rem 0 0.5rem",
                      borderBottom: "1px solid #ddd",
                      paddingBottom: "0.25rem",
                    }}
                  >
                    Streets Inside The Zone
                  </h3>
                  <ul
                    style={{
                      paddingLeft: "1rem",
                      listStyle: "disc",
                      lineHeight: "1.6",
                    }}
                  >
                    {customZoneInfo.streets.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {drawMode && showHelpBox && (
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
            onClick={() => setShowHelpBox(false)}
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
            aria-label="Close help"
          >
            ×
          </button>
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
            <li>Click and drag a point to move it</li>
          </ul>
        </div>
      )}

      {drawMode && !showHelpBox && (
        <button
          onClick={() => setShowHelpBox(true)}
          style={{
            position: "absolute",
            top: "6rem",
            left: "1rem",
            zIndex: 11,
            backgroundColor: "#ffffff",
            color: "#333",
            border: "1px solid #ccc",
            borderRadius: "50%",
            width: "2.5rem",
            height: "2.5rem",
            fontSize: "1.25rem",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          }}
          aria-label="Show help"
          title="Show help"
        >
          ℹ️
        </button>
      )}
    </div>
  );
}
