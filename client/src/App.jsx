// Import core React hooks and MapLibre GL
import React, { useRef, useEffect, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Main application component
export default function App() {
  // Refs for DOM and map instances
  const mapContainer = useRef(null); // DOM element for the map container
  const map = useRef(null); // MapLibre map instance
  const markerRef = useRef(null); // Reference to the current overlay popup marker

  // UI and state controls
  const [basemapStyle, setBasemapStyle] = useState("streets"); // Current basemap (streets or satellite)
  const [customZone, setCustomZone] = useState({
    name: "Custom Zone",
    type: "mixed-use", // default
    coordinates: [],
    areaSqM: 0,
    areaSqFt: 0,
    centroid: null,
  }); // Selected zone type from dropdown
  const [addressInfo, setAddressInfo] = useState(null); // Address details from reverse geocoding
  const [sidebarVisible, setSidebarVisible] = useState(true); // Controls sidebar visibility
  const [drawMode, setDrawMode] = useState(false); // Whether draw mode is active
  const [drawnCoords, setDrawnCoords] = useState([]); // Coordinates of user-drawn polygon
  const [showHelpBox, setShowHelpBox] = useState(true); // Toggles help instructions overlay

  // MapTiler basemap styles (streets and satellite)
  const maptilerStyles = {
    streets:
      "https://api.maptiler.com/maps/streets/style.json?key=DyVFUZmyKdCywxRTVU9B",
    satellite:
      "https://api.maptiler.com/maps/hybrid/style.json?key=DyVFUZmyKdCywxRTVU9B",
  };

  //mapTiler API key: DyVFUZmyKdCywxRTVU9B

  // Helper: Calculates approximate area of a polygon in square meters using spherical projection
  function calculateAreaInSquareMeters(polygonCoordinates) {
    if (!polygonCoordinates || polygonCoordinates.length === 0) return 0;

    const coordinates = polygonCoordinates[0];
    if (coordinates.length < 4) return 0;

    const R = 6378137; // Earth's radius in meters
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

  // Helper: Convert area from square meters to square feet
  function convertToSquareFeet(squareMeters) {
    return squareMeters * 10.7639;
  }

  // Helper: Calculate centroid of a polygon by averaging its vertices
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

  // 🗺️ Initialize the map when the component mounts
  useEffect(() => {
    // Exit if map container is not available or map already initialized
    if (!mapContainer.current || map.current) return;

    // Create a new MapLibre instance and attach it to the container
    map.current = new maplibregl.Map({
      container: mapContainer.current, // DOM element to render the map
      style: maptilerStyles[basemapStyle], // Initial map style (streets/satellite)
      center: [-122.422, 37.7749], // Default center (San Francisco)
      zoom: 15, // Starting zoom level
    });

    // Add zoom and rotation controls to the top-right
    map.current.addControl(new maplibregl.NavigationControl(), "top-right");
  }, []); // Runs only once on initial render

  // 🎨 When the user changes the basemap style (e.g. from streets to satellite),
  // update the map and reattach the overlay layer if needed.
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(maptilerStyles[basemapStyle]);
  }, [basemapStyle]);

  useEffect(() => {
    if (!map.current) return;
    const mapRef = map.current;
  
    const reAddDrawnLayers = () => {
      if (drawnCoords.length < 1) return;
  
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
          geometry: { type: "Point", coordinates: coord },
          properties: { id: i },
        })),
      };
  
      // Re-add sources and layers if needed
      if (!mapRef.getSource("drawn-polygon")) {
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
  
      if (!mapRef.getSource("drawn-points")) {
        mapRef.addSource("drawn-points", { type: "geojson", data: pointData });
        mapRef.addLayer({
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
    };
  
    mapRef.on("style.load", reAddDrawnLayers);
  
    return () => {
      mapRef.off("style.load", reAddDrawnLayers);
    };
  }, [drawnCoords]);  

  // ➕ Enable adding points to a custom polygon when in draw mode
  useEffect(() => {
    if (!map.current) return;

    // Handle user click on the map
    const handleMapClick = (e) => {
      // Only respond if draw mode is enabled
      if (!drawMode) return;

      // Get clicked coordinates [lng, lat]
      const lngLat = [e.lngLat.lng, e.lngLat.lat];

      // Add the clicked point to the list of polygon coordinates
      setDrawnCoords((prev) => {
        const updated = [...prev, lngLat];
        return updated;
      });
    };

    // Attach click listener to the map
    map.current.on("click", handleMapClick);

    // Cleanup listener on unmount or when drawMode changes
    return () => {
      if (map.current) {
        map.current.off("click", handleMapClick);
      }
    };
  }, [drawMode]);

  // 🧭 Respond to changes in draw mode (on/off)
  useEffect(() => {
    if (!map.current) return;

    const mapRef = map.current;

    if (!drawMode) {
      // 🚪 Exiting draw mode:
      // - Clear all drawn coordinates
      // - Remove polygon and points layers/sources from the map
      setDrawnCoords([]);

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
    } else {
      // ✏️ Entering draw mode:
      // - Show the floating help box with drawing instructions
      setShowHelpBox(true);
    }
  }, [drawMode]);

  // 📏 When 3 or more points are drawn, compute the polygon area and centroid
  useEffect(() => {
    // Wait until there are at least 3 points (minimum for a polygon)
    if (drawnCoords.length < 3) return;

    // Close the polygon by repeating the first point at the end
    const closedCoords = [...drawnCoords, drawnCoords[0]];

    // Construct a GeoJSON feature (not yet rendered here)
    const customFeature = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closedCoords],
      },
      properties: { name: "Custom Zone" },
    };

    // Calculate area in square meters and square feet
    const area = calculateAreaInSquareMeters([closedCoords]);
    const areaFeet = convertToSquareFeet(area);

    // Get the polygon's geometric center
    const [lng, lat] = getPolygonCentroid([closedCoords]);

    setCustomZone((prev) => ({
      ...prev,
      coordinates: [...drawnCoords],
      areaSqM: area,
      areaSqFt: areaFeet,
      centroid: [lng, lat],
    }));

    // 📌 Optionally, you could reverse geocode or update the sidebar here
  }, [drawnCoords]);

  // 🖌️ Render the user-drawn polygon and draggable point nodes
  useEffect(() => {
    // Exit if map isn't ready or no points have been drawn
    if (!map.current || drawnCoords.length < 1) return;

    const closed = [...drawnCoords, drawnCoords[0]]; // Ensure the polygon is closed

    // Create a GeoJSON polygon feature
    const polygonData = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [closed],
      },
    };

    // Create a GeoJSON FeatureCollection of circle points (vertices)
    const pointData = {
      type: "FeatureCollection",
      features: drawnCoords.map((coord, i) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: coord,
        },
        properties: { id: i }, // Used to identify and drag/delete specific nodes
      })),
    };

    const mapRef = map.current;

    // 🟦 Update or add the polygon source and layer
    if (mapRef.getSource("drawn-polygon")) {
      // Update data if source already exists
      mapRef.getSource("drawn-polygon").setData(polygonData);
    } else {
      // First time: create source and layer
      mapRef.addSource("drawn-polygon", { type: "geojson", data: polygonData });
      mapRef.addLayer({
        id: "drawn-polygon-layer",
        type: "fill",
        source: "drawn-polygon",
        paint: {
          "fill-color": "#00bcd4", // Cyan-ish fill
          "fill-opacity": 0.4, // Semi-transparent
        },
      });
    }

    // 🔴 Update or add the points source and layer
    if (mapRef.getSource("drawn-points")) {
      // Update point data
      mapRef.getSource("drawn-points").setData(pointData);
    } else {
      // Create point source and layer for draggable circle markers
      mapRef.addSource("drawn-points", { type: "geojson", data: pointData });
      mapRef.addLayer(
        {
          id: "drawn-points-layer",
          type: "circle",
          source: "drawn-points",
          paint: {
            "circle-radius": 7,
            "circle-color": "#ff0000", // Red circles
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fff",
          },
        },
        "drawn-polygon-layer" // ➕ Insert point layer *above* the polygon layer
      );
    }
  }, [drawnCoords]);

  // ✋ Enable dragging and right-click deletion of polygon points
  useEffect(() => {
    // Exit if map is not ready or no points are drawn
    if (!map.current || drawnCoords.length < 1) return;

    const mapRef = map.current;
    let isDragging = false; // Track whether a drag is in progress
    let dragIndex = null; // Index of the point being dragged

    // 🧠 Clone current coordinates to avoid stale closure issues during drag
    const coordsRef = [...drawnCoords];

    // 🖱 Handle user mouse down on a draggable point
    const handleMouseDown = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;

      // Start dragging the selected point
      dragIndex = feature.properties.id;
      isDragging = true;

      mapRef.getCanvas().style.cursor = "grabbing";
      mapRef.dragPan.disable(); // Disable map panning while dragging
    };

    // 🧭 Track mouse movement to update dragged point
    const handleMouseMove = (e) => {
      if (!isDragging || dragIndex === null) return;

      const { lng, lat } = e.lngLat;
      coordsRef[dragIndex] = [lng, lat]; // Update dragged point position

      // Update the polygon and point layers live during drag
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

      if (mapRef.getSource("drawn-polygon")) {
        mapRef.getSource("drawn-polygon").setData(polygonData);
      }
      if (mapRef.getSource("drawn-points")) {
        mapRef.getSource("drawn-points").setData(pointData);
      }
    };

    // 🖐 End drag and commit changes to React state
    const handleMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      dragIndex = null;

      // Finalize drag and update React state
      setDrawnCoords([...coordsRef]);

      mapRef.getCanvas().style.cursor = "";
      mapRef.dragPan.enable(); // Re-enable map panning
    };

    // 🗑 Handle right-click to delete a point
    const handleRightClick = (e) => {
      if (!e.features?.length) return;
      const feature = e.features[0];
      if (feature.layer.id !== "drawn-points-layer") return;

      const idToRemove = feature.properties.id;

      // Remove the point from drawnCoords
      setDrawnCoords((prevCoords) => {
        const updated = [...prevCoords];
        updated.splice(idToRemove, 1);
        return updated;
      });

      e.preventDefault(); // Prevent default browser context menu
    };

    // 🎯 Register map event listeners
    mapRef.on("mousedown", "drawn-points-layer", handleMouseDown);
    mapRef.on("mousemove", handleMouseMove);
    mapRef.on("mouseup", handleMouseUp);
    mapRef.on("contextmenu", "drawn-points-layer", handleRightClick);

    // 🔄 Cleanup on unmount or dependency change
    return () => {
      mapRef.off("mousedown", "drawn-points-layer", handleMouseDown);
      mapRef.off("mousemove", handleMouseMove);
      mapRef.off("mouseup", handleMouseUp);
      mapRef.off("contextmenu", "drawn-points-layer", handleRightClick);
    };
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

  // 🎛️ Inline styles for the control panel (top-left toolbar)
  const controlPanelStyle = {
    position: "absolute",
    top: "1rem",
    left: "1rem",
    zIndex: 10,
    backgroundColor: "white",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    boxShadow: "0 2px 10px rgba(0,0,0,0.15)", // Soft shadow
    display: "flex",
    flexWrap: "wrap", // Wrap buttons if screen is narrow
    alignItems: "center",
    gap: "0.5rem", // Spacing between buttons/selects
    maxWidth: "calc(100vw - 2rem)", // Prevent overflow on small screens
  };

  // 🎨 Style for all control buttons
  const buttonStyle = {
    backgroundColor: "#ffc107", // Yellow (Bootstrap warning)
    border: "none",
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    color: "#000",
    cursor: "pointer",
    fontSize: "0.9rem",
  };

  // 🔽 Style for dropdown selects (zone type, basemap)
  const selectStyle = {
    padding: "0.5rem",
    borderRadius: "0.375rem",
    fontSize: "0.9rem",
  };

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* 🗺️ Map container (full-screen) */}
      <div
        ref={mapContainer}
        style={{ position: "absolute", inset: 0, zIndex: 0 }}
      ></div>

      {/* 🎛️ Floating control panel (top-left) */}
      <div style={controlPanelStyle}>
        <button
          onClick={() => setDrawMode(!drawMode)}
          style={{
            ...buttonStyle,
            backgroundColor: drawMode ? "#28a745" : "#ffc107", // Green when active
          }}
        >
          {drawMode ? "Exit Draw Mode" : "Enter Draw Mode"}
        </button>

        {/* Switch basemap style */}
        <select
          value={basemapStyle}
          onChange={(e) => setBasemapStyle(e.target.value)}
          style={selectStyle}
        >
          <option value="streets">Streets</option>
          <option value="satellite">Satellite</option>
        </select>

        {/* Switch zone overlay type */}
        <select
          value={customZone.type}
          onChange={(e) =>
            setCustomZone((prev) => ({ ...prev, type: e.target.value }))
          }
          style={selectStyle}
        >
          <option value="residential">Residential</option>
          <option value="mixed-use">Mixed Use</option>
          <option value="commercial">Commercial</option>
        </select>
      </div>

      {/* 🪟 Sidebar toggle button (left of sidebar when open) */}
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

      {/* 📋 Sidebar with zone details and geocoded address */}
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
          <div>
            <h2
              style={{
                fontSize: "1.4rem",
                marginBottom: "1rem",
                borderBottom: "2px solid #eee",
                paddingBottom: "0.5rem",
              }}
            >
              Zone Summary
            </h2>

            {/* Zone metadata */}
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>Name:</strong> {customZone.name}
            </p>
            <p style={{ marginBottom: "0.5rem" }}>
              <strong>Type:</strong> {customZone.type}
            </p>
            <p style={{ marginBottom: "1rem" }}>
              <strong>Area:</strong> {customZone.areaSqM.toFixed(2)} m² /{" "}
              {customZone.areaSqFt.toFixed(2)} ft²
            </p>

            {/* Reverse geocoded location info */}
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
                      <strong>Neighborhood:</strong> {addressInfo.neighborhood}
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
          </div>
        </div>
      )}

      {/* 📘 Floating help box for draw instructions (shown in draw mode) */}
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
          {/* Close (X) button */}
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

      {/* ℹ️ Help icon to reopen instructions if user closed them */}
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
