import React, { useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const markerRef = useRef(null); // 🏭️ Track current marker
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [basemapStyle, setBasemapStyle] = useState("streets");
  const [zoneType, setZoneType] = useState("mixed-use");
  const [addressInfo, setAddressInfo] = useState(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [drawnCoords, setDrawnCoords] = useState([]);

  const maptilerStyles = {
    streets:
      "https://api.maptiler.com/maps/streets/style.json?key=DyVFUZmyKdCywxRTVU9B",
    satellite:
      "https://api.maptiler.com/maps/hybrid/style.json?key=DyVFUZmyKdCywxRTVU9B",
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

  function calculateAreaInSquareMeters(polygonCoordinates) {
    if (!polygonCoordinates || polygonCoordinates.length === 0) return 0;

    const coordinates = polygonCoordinates[0];
    if (coordinates.length < 4) return 0;

    const R = 6378137;
    let area = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const [x1, y1] = coordinates[i];
      const [x2, y2] = coordinates[i + 1];
      area += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
    }
    return Math.abs(area * R * R / 2);
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

  useEffect(() => {
    if (!map.current) return;

    const feature = zoneOverlays[zoneType]?.[0];
    if (!feature) return;

    const centroid = getPolygonCentroid(feature.geometry.coordinates);
    const [lng, lat] = centroid;

    const apiKey = "DyVFUZmyKdCywxRTVU9B";
    const url = `https://api.maptiler.com/geocoding/${lng},${lat}.json?key=${apiKey}`;

    console.log("🛰 Fetching address info from:", url);

    fetch(url)
      .then(res => res.json())
      .then(data => {
        console.log("📦 Raw geocode data:", data);

        const features = data?.features || [];

        const address = {
          street: features[0]?.text_en || null,
          postalCode: features[1]?.text_en || null,
          neighborhood: features[2]?.text_en || null,
          city: features[3]?.text_en || null,
          state: features[4]?.text_en || null,
          country: features[5]?.text_en || null,
        };

        console.log("📍 Parsed address info:", address);
        setAddressInfo(address);
      })
      .catch(err => {
        console.error("❌ Failed to fetch address info:", err);
        setAddressInfo(null);
      });
  }, [zoneType]);

  useEffect(() => {
    if (!map.current) return;

    // Clean up old marker
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
          paint: {
            "fill-color": "#ff69b4",
            "fill-opacity": 0.5,
          },
          layout: {
            visibility: overlayVisible ? "visible" : "none",
          },
        });
      }
    });
  }, [basemapStyle]);

  useEffect(() => {
    if (!map.current || !map.current.getLayer("overlay-layer")) return;

    map.current.setLayoutProperty(
      "overlay-layer",
      "visibility",
      overlayVisible ? "visible" : "none"
    );
  }, [overlayVisible]);

  useEffect(() => {
    if (!map.current || !map.current.getSource("overlay")) return;
    console.log("🔄 Updating overlay with zone:", zoneType);
    map.current.getSource("overlay").setData({
      type: "FeatureCollection",
      features: zoneOverlays[zoneType] || [],
    });
  }, [zoneType]);

  useEffect(() => {
    if (!map.current) return;

    const handleMapClick = (e) => {
      if (!drawMode) return;

      const lngLat = [e.lngLat.lng, e.lngLat.lat];

      setDrawnCoords((prev) => {
        const updated = [...prev, lngLat];

        return updated;
      });
    };

    map.current.on("click", handleMapClick);

    return () => {
      if (map.current) {
        map.current.off("click", handleMapClick);
      }
    };
  }, [drawMode]);

  useEffect(() => {
    if (!map.current) return;

    if (!drawMode) {
      // Clear coordinates from state
      setDrawnCoords([]);

      // Remove drawn layers and sources from the map
      const mapRef = map.current;

      if (mapRef.getLayer("drawn-polygon-layer")) {
        mapRef.removeLayer("drawn-polygon-layer");
      }
      if (mapRef.getSource("drawn-polygon")) {
        mapRef.removeSource("drawn-polygon");
      }

      if (mapRef.getLayer("drawn-points-layer")) {
        mapRef.removeLayer("drawn-points-layer");
      }
      if (mapRef.getSource("drawn-points")) {
        mapRef.removeSource("drawn-points");
      }
    }
  }, [drawMode]);

  useEffect(() => {
    if (drawnCoords.length < 3) return;

    const closedCoords = [...drawnCoords, drawnCoords[0]];
    const customFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closedCoords],
      },
      properties: { name: "Custom Zone" },
    };

    const area = calculateAreaInSquareMeters([closedCoords]);
    const areaFeet = convertToSquareFeet(area);
    const [lng, lat] = getPolygonCentroid([closedCoords]);

    console.log("🆕 Custom zone data:");
    console.log("→ Area:", area.toFixed(2), "m² /", areaFeet.toFixed(2), "ft²");
    console.log("→ Centroid:", lng, lat);

    // Optional: you could even run a reverse geocode here like in your zone useEffect
    // Or set the zone as the active one and display in sidebar

  }, [drawnCoords]);

  useEffect(() => {
    if (!map.current || drawnCoords.length < 1) return;

    const closed = [...drawnCoords, drawnCoords[0]];
    const polygonData = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closed],
      },
    };

    const pointData = {
      type: "FeatureCollection",
      features: drawnCoords.map((coord, i) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: coord,
        },
        properties: { id: i },
      })),
    };

    const mapRef = map.current;

    // Update or add polygon source
    if (mapRef.getSource("drawn-polygon")) {
      mapRef.getSource("drawn-polygon").setData(polygonData);
    } else {
      mapRef.addSource("drawn-polygon", { type: "geojson", data: polygonData });
      mapRef.addLayer({
        id: "drawn-polygon-layer",
        type: "fill",
        source: "drawn-polygon",
        paint: {
          "fill-color": "#00bcd4",
          "fill-opacity": 0.4,
        },
      });
    }

    // Update or add points source
    if (mapRef.getSource("drawn-points")) {
      mapRef.getSource("drawn-points").setData(pointData);
    } else {
      mapRef.addSource("drawn-points", { type: "geojson", data: pointData });
      mapRef.addLayer({
        id: "drawn-points-layer",
        type: "circle",
        source: "drawn-points",
        paint: {
          "circle-radius": 5,
          "circle-color": "#f00",
        },
      });
    }
  }, [drawnCoords]);

  useEffect(() => {
    if (!map.current || drawnCoords.length < 1) return;

    let isDragging = false;
    let dragIndex = null;

    const handleMouseDown = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;

      isDragging = true;
      dragIndex = feature.properties.id;
      map.current.getCanvas().style.cursor = "grabbing";
    };

    const handleMouseMove = (e) => {
      if (!isDragging || dragIndex === null) return;
      const { lng, lat } = e.lngLat;

      setDrawnCoords((prevCoords) => {
        const updated = [...prevCoords];
        updated[dragIndex] = [lng, lat];
        return updated;
      });
    };

    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        dragIndex = null;
        map.current.getCanvas().style.cursor = "";
      }
    };

    const mapRef = map.current;
    mapRef.on("mousedown", "drawn-points-layer", handleMouseDown);
    mapRef.on("mousemove", handleMouseMove);
    mapRef.on("mouseup", handleMouseUp);

    return () => {
      mapRef.off("mousedown", "drawn-points-layer", handleMouseDown);
      mapRef.off("mousemove", handleMouseMove);
      mapRef.off("mouseup", handleMouseUp);
    };
  }, [drawnCoords]);

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

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div
        ref={mapContainer}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      ></div>

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
          {
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
              <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem", borderBottom: "2px solid #eee", paddingBottom: "0.5rem" }}>
                Zone Summary
              </h2>

              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Name:</strong> {currentFeature?.properties?.name}
              </p>
              <p style={{ marginBottom: "0.5rem" }}>
                <strong>Type:</strong> {zoneType}
              </p>
              <p style={{ marginBottom: "1rem" }}>
                <strong>Area:</strong> {currentArea.toFixed(2)} m² / {currentAreaFeet.toFixed(2)} ft²
              </p>

              {addressInfo && (
                <>
                  <h3 style={{ fontSize: "1.1rem", margin: "1.5rem 0 0.5rem", borderBottom: "1px solid #ddd", paddingBottom: "0.25rem" }}>
                    Location Details
                  </h3>
                  <ul style={{ paddingLeft: "1rem", listStyle: "disc", lineHeight: "1.6" }}>
                    {addressInfo.street && <li><strong>Street:</strong> {addressInfo.street}</li>}
                    {addressInfo.postalCode && <li><strong>Postal Code:</strong> {addressInfo.postalCode}</li>}
                    {addressInfo.neighborhood && <li><strong>Neighborhood:</strong> {addressInfo.neighborhood}</li>}
                    {addressInfo.city && <li><strong>City:</strong> {addressInfo.city}</li>}
                    {addressInfo.state && <li><strong>State:</strong> {addressInfo.state}</li>}
                    {addressInfo.country && <li><strong>Country:</strong> {addressInfo.country}</li>}
                  </ul>
                </>
              )}
            </div>
          }
        </div>
      )}
    </div>
  );
}
