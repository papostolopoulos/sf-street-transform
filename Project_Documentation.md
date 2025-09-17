# **SF Street Transform Project Documentation**

This document outlines the vision, progress, and future direction of the "SF Street Transform" project, an interactive web application designed to empower community-led urban planning.

## **1\. Objective of this Work**

The overarching objective of this work is to develop an interactive, map-based web application that serves as a powerful tool for residents, urban advocates, and city planners. The application aims to facilitate the visualization and prototyping of various transformations for San Francisco streets and neighborhoods. The core motivation is to reduce car dependency within the city and to re-prioritize public spaces for people-friendly uses, thereby enhancing the quality of life for all residents.

## **2\. Arguments for Usefulness**

This project is highly useful and necessary for several key reasons:

* **Democratization of Public Space:** Streets are public property, currently disproportionately serving car drivers. This project advocates for reimagining these spaces to be accessible and beneficial for all citizens, including pedestrians, cyclists, and those seeking recreational or social areas.  
* **Addressing Safety Concerns:** Car crashes are a significant cause of fatalities and injuries. The current street infrastructure often fails to adequately address prevention. This tool can help prototype designs that inherently reduce vehicular speeds and create safer environments, especially for vulnerable populations like children and the elderly.  
* **Improving Quality of Life:** Current urban design contributes to noise pollution, air pollution, soil and water pollution, and limits access to quality recreation areas, particularly impacting less privileged neighborhoods. By visualizing and promoting changes like narrower streets, more green spaces, and community amenities, the project aims to foster more relaxed, healthier, and interactive environments.  
* **Inspiring Community Action:** Historically, significant urban changes in San Francisco have often occurred only after catastrophic events. This application provides a proactive platform for community involvement, allowing residents to visualize potential improvements and generate data-backed arguments, thereby inspiring political action and community-driven initiatives (e.g., in collaboration with groups like Strong Towns SF).  
* **Economic and Environmental Benefits:** Reducing car dependency and promoting alternative transportation can lead to decreased fuel consumption, lower emissions, and reduced noise. Implementing paid street parking across the city could also generate significant revenue for infrastructure improvements, addressing financial inequalities where non-car owners subsidize free parking for car owners.

## **3\. Historical Context**

San Francisco's urban development has often been reactive, with major infrastructure changes typically following significant events rather than proactive planning.

* **Post-1989 Earthquake:** The removal of the Embarcadero freeway after the 1989 earthquake demonstrated the city's capacity for transformative change when faced with a critical juncture.  
* **COVID-19 Pandemic:** The recent pandemic spurred temporary changes, such as the closure of the Great Highway to traffic, the permanent closure of JFK Drive to cars, the expansion of the "Slow Streets" program, and the permanent allowance of restaurant outdoor seating. These changes, initially temporary, became permanent due to public demand for more free spaces for walking, exercise, and socialization, highlighting a desire for people-centric urban design.  
* **Vision Zero Challenges:** Despite initiatives like "Vision Zero" aimed at eliminating traffic fatalities, the city continues to experience pedestrian deaths. This suggests that current approaches, such as speed bumps, minor bike lane upgrades, pedestrian head starts at traffic lights, and right-turn barriers, are insufficient due to a lack of bold, systemic decisions to minimize vehicular traffic. Drivers often adapt to minor deterrents (e.g., large vehicles easily handling speed bumps) rather than fundamentally altering their behavior or speed.

## **4\. Suggestions for Change (Practical Vision)**

The project is built upon a vision for significant urban transformation, drawing inspiration from the detailed suggestions provided in the "City Planning.pdf" document. These suggestions aim to fundamentally re-engineer streets to prioritize safety, community, and environmental well-being:

### **Street Changes:**

1. **Narrower Residential Streets / End Destinations:** Design residential streets to be narrower or function as end destinations rather than through-routes. This naturally reduces vehicle speeds and discourages through-traffic, making streets friendlier for residents.  
2. **Repurposing Asphalt:** Remove unnecessary asphalt from narrowed streets and replace it with community amenities such as:  
   * Community gardens  
   * Benches for seating  
   * Jungle gyms / exercise stations  
   * Mini playgrounds  
   * BBQ stations or firewood ovens  
   * Designated parking spaces for delivery vehicles (e.g., one per block)  
     This promotes the democratization of street space and fosters community building.  
3. **One-Way Residential Streets:** Convert most residential streets to one-way. This eliminates bidirectional traffic, enhances grid safety, and further reduces speeds, especially in conjunction with narrower designs.  
4. **Windy Residential Streets:** Introduce curves in residential streets to force drivers to decrease speeds and create opportunities for neighborhood-friendly infrastructure.  
5. **Lower Speed Limits:** Decrease the speed limit in residential areas to 15 mph for all vehicles to protect vulnerable road users.  
6. **Replace Stop Signs with Roundabouts:** Eliminate unnecessary "all-way stop" signs, particularly on one-way streets, and replace them with roundabouts. This improves traffic flow, reduces noise and air pollution from constant stopping and starting, and saves fuel.  
7. **LED Warning Lights at Pedestrian Crossings:** Install LED warning lights at all pedestrian crossings to increase driver awareness and save lives, especially given that many drivers do not fully stop at traditional stop signs.  
8. **Elevated Pedestrian Crossings:** Raise pedestrian crossings to be level with sidewalks. This acts as a natural speed bump, gives drivers the impression of crossing a pedestrian zone, and improves accessibility for individuals with mobility issues.

### **Parking:**

9. **Remove Street Parking from Narrow/Residential Streets:** Free up valuable public space currently occupied by parked cars for alternative uses like seating, trees, playgrounds, and community gathering areas.  
10. **Reconfigure Street Parking on Higher Traffic Streets:** Shift parking from right curb/sidewalk to left side/middle of the road on higher traffic streets. This creates more parking spaces, separates bidirectional traffic, narrows the perceived street width (reducing speeds), and enhances safety for bicyclists by creating a buffer.  
11. **Charge for All Street Parking:** Implement city-wide charges for street parking. This addresses the financial inequality where non-car owners subsidize free parking for car owners and generates revenue for infrastructure improvements.  
12. **Remove or Limit Parking Lots:** Reduce the number of underutilized parking lots (e.g., at the Embarcadero) to reclaim space for more productive urban uses.  
13. **Dedicated Bicycle Parking:** Create designated bicycle parking areas at all major public transportation hubs and key commuter locations to encourage multi-modal transportation.

### **Other Means of Transportation:**

14. **Neighborhood Public Transportation Network:** Establish local minivan networks to transport residents for short errands, reducing the need for personal car use for small distances and offering flexible, convenient commuting options.  
15. **Promote Cargo and Surrey Bikes:** Develop infrastructure (e.g., drop-off points) to support the widespread use of cargo bikes, surrey bikes, and scooters, making these alternative modes of transport more convenient and safe for all residents, regardless of athletic ability.

## **5\. Goals of the Project / Application**

The "SF Street Transform" web application aims to achieve the following:

* **Enable Design and Visualization:** Allow users to visualize and prototype block- and neighborhood-scale redesigns, such as new plazas, bikeways, and green spaces.  
* **User Control:** Provide users with intuitive controls to define transformation zones, either by drawing custom polygons or by selecting existing street segments.  
* **Dynamic Input:** Replace static map overlays with fully user-driven input, allowing for real-time creation and modification of proposed changes.  
* **Inform and Inspire Action:** Generate detailed information and impact assessments (e.g., noise reduction, tree count, safety improvements, cost estimates) for proposed transformations to empower residents and advocates with data to inspire political action and community involvement.  
* **Facilitate Comparison:** Offer "Before & After" views and potentially "Counterpoint Modes" to illustrate the impact of transformations from various stakeholder perspectives (e.g., pedestrian, business, fire department).  
* **Support Iterative Design:** Allow users to label, save, and compare different zone designs.

## **6\. Description of Coding Technologies Used**

The application is being built using modern web development technologies to ensure an interactive, responsive, and scalable experience.

* **Frontend Framework:**  
  * **React:** A JavaScript library for building user interfaces, leveraging a component-based architecture and hooks for state management and side effects.  
* **Mapping Library:**  
  * **MapLibre GL JS:** An open-source JavaScript library for publishing maps on the web, based on WebGL. It handles rendering vector tiles and styles, enabling smooth, interactive map experiences.  
* **Mapping Data/APIs:**  
  * **MapTiler API:** Used for serving various basemap styles (e.g., streets, satellite) and for reverse geocoding services to convert geographic coordinates into human-readable addresses.

## **7\. What Has Been Built (Completed Features)**

The following functionalities have been successfully implemented in the application:

* **Fullscreen Map Display:** A fully functional MapLibre GL map that occupies the entire screen.  
* **Basemap Toggling:** Users can switch between "Streets" and "Satellite" basemap styles provided by MapTiler.  
* **Predefined Zone Overlays:** The map can display pre-configured GeoJSON polygon overlays representing different zone types (e.g., residential, mixed-use, commercial).  
* **Overlay Visibility Control:** A toggle button allows users to show or hide the active zone overlay.  
* **Custom Polygon Drawing Mode:**  
  * Users can enter a "Draw Mode" to create custom polygons on the map.  
  * Clicking on the map adds vertices to form a polygon.  
  * The drawn polygon is visualized with a fill, and individual points are shown as draggable circles.  
* **Live Area & Centroid Calculation:** As points are added to a custom polygon, the application calculates and logs its approximate area (in square meters and square feet) and its geometric centroid.  
* **Interactive Drawn Polygon Editing:**  
  * **Drag Points:** Users can click and drag individual points (vertices) of the drawn polygon to reshape it.  
  * **Delete Points:** Right-clicking on a point allows users to delete it from the polygon.  
* **Floating Help UI:** A contextual help box appears when in Draw Mode, providing clear instructions for drawing and editing polygons. This box can be dismissed and re-opened.  
* **Collapsible Sidebar:** A sidebar is implemented to display summary information.  
* **Reverse Geocoding for Predefined Zones:** The sidebar displays address details (street, postal code, neighborhood, city, state, country) obtained from MapTiler's reverse geocoding API, based on the centroid of the *selected predefined zone*.  
* **Modular and Commented Codebase:** The existing code is well-organized into React components and hooks, with extensive comments explaining logic and functionality.
* **Street Segment Selection & Editing (M3 DONE):** Road-following shortest path between two points with: network snapping, extended drag (lengthen/shorten) support, fast-path same-line slicing (prevents detour bounce), precision trimming between endpoints, adaptive snapping radius, path length metric, recompute trigger, performance instrumentation, defensive coordinate validation, and save readiness groundwork.

## **8\. What Is Planned to Be Built (Planned Features / Roadmap)**

The future development of the "SF Street Transform" application will focus on enhancing user interaction, expanding visualization capabilities, and integrating more comprehensive data and analysis.

* **Full Integration of User-Drawn Zones:**  
  * Display the calculated area and geocoded address for *user-drawn polygons* directly in the sidebar.  
  * Allow users to "finalize" or "save" a drawn zone, potentially giving it a custom name and description.  
* **Street Segment Selection:** Implement a feature allowing users to select existing street segments (e.g., using custom vector tiles) rather than just drawing freehand polygons. This will provide more precise and realistic transformation areas.  
* **Enhanced Scale UX:** Ensure the application seamlessly supports design and visualization for varying scales, from small blocks to entire neighborhoods.  
* **Mode Switching for Selection:** Introduce a clear mode switch between "Draw Zone" (freehand polygon) and "Select Streets" (segment selection).  
* **Advanced Transformation Menu:** Develop the interactive "Transformation Menu" as depicted in the mockups, allowing users to select specific urban elements (e.g., trees, bike lane barriers, playgrounds) to apply to their chosen zone.  
* **"Before & After" Visualization:** Implement the core "Before & After" split view, allowing users to compare the current state of a street with their proposed transformed design. This will likely involve:  
  * **2D Street View:** Static or semi-interactive 2D renderings of street segments.  
  * **Interactive Slider:** A drag slider to transition between the "Before" and "After" views.  
  * **3D View Integration:** A "Go to interactive 3D view" option with rotate/zoom controls, potentially using a library like Three.js for immersive visualization.  
* **Comprehensive Info Panels:** Fully develop the "Info Panel" to display detailed impact data for proposed transformations, including:  
  * Impact descriptions (e.g., noise reduction percentage, number of new trees, safety improvements).  
  * Space dimensions.  
  * Estimated costs and funding sources.  
  * Expected longevity of changes.  
  * References to relevant studies or data.  
* **"Counterpoint Mode":** Implement the "Counterpoint Mode" to allow users to view the impact of transformations from different stakeholder perspectives (e.g., pedestrian, business, fire department).  
* **Zone Management:** Add features for labeling, saving, loading, and comparing multiple designed zones.  
* **User Authentication and Persistence:** Implement a backend (e.g., Firebase Firestore) to allow users to save their designs and share them, ensuring data persistence across sessions.

## **9\. Future UI/UX Vision (Mockups)**

The following mockups illustrate the intended future user interface and experience of the "SF Street Transform" application, emphasizing the "Before & After" visualization and detailed impact analysis.

* **Reimagine SF \- Mockup 1.jpg:** This mockup highlights the "Before/After View" with a split screen, likely for a specific street segment (e.g., "South Van Ness Avenue"). It shows a "Sidebar with Information Panels" that will include "Tags" and "Long-Term Impact" details. A "Transformation Menu" with icons for elements like trees, bike lanes, and outdoor seating is visible, along with a "Counterpoint Toggle" to switch between different perspectives.  
* **Reimagine SF \- Mockup 2.jpg:** This mockup provides a more detailed look at the "Split View" concept. On the left, a "Transformation Menu" presents various elements (Trees, Bike Lane, Outdoor Seating, Stormwater Planters) that can be applied. On the right, "INFO PANELS" show the "Impact of Changes," such as "15% less noise," "25 new trees," and "Improved pedestrian safety." Below the split view, "INFO PANELS" for "Pedestrian," "Business," and "Fire Dept" perspectives are shown, along with a "Counterpoint Mode" toggle to switch between these views.  
* **Reimagine SF \- Mockup 3.jpg:** This mockup presents a broader application layout. It includes a "Neighborhood" dropdown and "2D View" navigation. The central "BEFORE ↔ AFTER Toggle Street View" features a "Drag slider to compare view of street." A "Design Your Street" checklist on the left allows users to select specific features like "Playground," "Jungle Gym," "Bike Lane Barrier," etc. The "Info Panel" on the right details "Impact," "Space," "Cost," "Longevity," "Funding," and "Reference" for the proposed changes, with a link to "Read case study fr..." Additionally, a "Go to interactive 3D view" button with "Rotate/Zoom Controls" is highlighted, indicating a future immersive visualization capability.

These mockups collectively demonstrate a clear progression towards a powerful tool for designing, visualizing, and analyzing urban transformations from multiple angles.

## **10\. References**

### **Coding Technologies:**

* **React:** https://react.dev/  
* **MapLibre GL JS:** https://maplibre.org/maplibre-gl-js/docs/  
* **MapTiler API:** https://www.maptiler.com/cloud/api/

### **Practical References for City Transformation Arguments:**

* **Traffic Fatalities | City Performance Scorecards:** https://sfgov.org/scorecards/transportation/traffic-fatalities  
* **SF Just Had Its Worst Year For Road Deaths Since Plan To End Them Began:** https://sfstandard.com/transportation/sf-just-had-its-worst-year-for-road-deaths-since-plan-to-end-them-began/  
* **Pedestrian Killed In San Francisco Crash:** https://sfstandard.com/transportation/pedestrian-killed-in-san-francisco-crash/  
* **Ethan Boyes, Bicyclist Hit By Car, Death San Francisco:** https://sfstandard.com/sports/ethan-boyes-bicyclist-hit-by-car-death-san-francisco/  
* **San Francisco Sued For Thousands Over Bump In Road That Injured 4:** https://sfstandard.com/transportation/san-francisco-sued-for-thousands-over-bump-in-road-that-injured-4/  
* **Old San Francisco: A Look At Before And After The Embarcadero Free Came Down:** https://medium.com/@UpOutSF/old-san-francisco-a-look-at-before-and-after-the-embarcadero-free-came-down-85739ff61dc1  
* **San Francisco Prop I \- JFK Drive and Great Highway Car Use | SPUR:** https://www.spur.org/voter-guide/2022-11/sf-prop-i-jfk-drive-and-great-highway-car-use  
* **San Francisco, California, Proposition I, Allow Private Vehicles on JFK Drive and Connector Streets in Golden Gate Park Initiative (November 2022\) \- Ballotpedia:** https://ballotpedia.org/San\_Francisco,\_California,\_Proposition\_I,\_Allow\_Private\_Vehicles\_on\_JFK\_Drive\_and\_Connector\_Streets\_in\_Golden\_Gate\_Park\_Initiative\_(November\_2022)  
* **Slow Streets Program | SFMTA:** https://www.sfmta.com/projects/slow-streets-program

---

## **11. Milestones & Tracking**

The project features below are grouped into deliverable milestones to enable incremental, Agile delivery. Estimates are initial planning figures (whole-team hours) and will be refined once actual effort is recorded. Actual hours are blank (TBD) for items not yet tracked; we will log retroactively only when we can do so reliably—otherwise they remain blank to avoid fiction.

| ID | Milestone | Scope Summary | Key Dependencies | Est (hrs) | Actual (hrs) | Status | % Complete | Exit / Definition of Done |
|----|-----------|---------------|------------------|-----------|--------------|--------|------------|---------------------------|
| M1 | Core Map & Polygon MVP | Fullscreen map, basemap toggle, polygon draw/edit, area & centroid calc, reverse geocode for predefined, help UI, sidebar scaffolding | MapLibre, MapTiler key | 30 |  (capture retrospectively?) | DONE | 100% | All listed features stable; no critical console errors |
| M2 | Zone Summaries & Save/Load | Persist user‑drawn polygons (name, description, type), compute & show summary (area, address, streets) for user zones | M1 | 18 |  | IN PROGRESS (partially implemented) | 40% | Save, list, select, edit & re-save round trip works |
| M3 | Street Segment Selection (Start/End) | Select road-aligned path between two points following roads, highlight path, clear/reset selection, prepare for saving as a street transformation zone | Road graph logic, Map layers | 24 |  | DONE | 100% | Path follows multi-block roads; extended drag + shorten stable (no bounce); fast-path slice + precise trimming; perf timings logged; no runtime errors |
| M3.5 | UI & Interaction Refinement | Consolidate controls, improve discoverability (tool grouping, inline hints), display path metrics, restore polygon tool reliability & mode sync, dynamic segment color, unified help panel | M1, M3 | 14 |  | IN PROGRESS | 55% | Polygon & street tools switch cleanly; dynamic coloring, unified help panel, path length metric, recompute trigger; pending: minor UI affordances (button for save segment, subtle hints) & log noise reduction |
| M4 | Street Segment Persistence | Save highlighted street segments as features (with type, tags), list & edit, integrate with sidebar summaries | M2, M3 | 16 |  | NOT STARTED | 0% | CRUD for street selections, displayed on load |
| M5 | Transformation Menu (Phase 1) | Minimal selectable transformation tags (trees, seating, bike lane) applied to a zone/segment, store in properties | M2/M4 | 20 |  | NOT STARTED | 0% | Tags add/remove, persisted & visible in summary |
| M6 | Impact Panel (Phase 1) | Compute & display basic derived metrics (area %, estimated trees count placeholder, speed calming indicator) | M5 | 14 |  | NOT STARTED | 0% | Metrics render for polygons & segments, no crashes |
| M7 | Before / After View (2D) | Static split view slider with baseline vs transformed stylistic overlay | M5 | 28 |  | NOT STARTED | 0% | Slider works, assets load, performance ok |
| M8 | Auth & Persistence (Cloud) | User auth (email or OAuth) + cloud persistence (e.g., Firebase) for zones & segments | M2, M4 | 34 |  | NOT STARTED | 0% | Login, save, reload on new session |the improvements 
| M9 | Counterpoint Mode (Phase 1) | Toggle that changes displayed impact subset (pedestrian, business, fire dept) | M6 | 12 |  | NOT STARTED | 0% | Toggle switches metric subsets reliably |
| M10 | MVP Release | Stabilization, documentation, lightweight landing content, error handling & perf passes | M1–M6 baseline | 24 |  | NOT STARTED | 0% | All MVP scope accepted; open defects severity ≤ medium only |
| M11 | 3D / Advanced Visualization (Stretch) | Optional 3D interactive view prototype | M7 | 40 |  | NOT STARTED | 0% | Prototype loads & navigates for at least one saved design |

### Estimation Notes
* Initial estimates assume a single contributor at ~10–15 focused hrs/week; parallelization can compress calendar time.
* Actual hours will be added via a simple log (see Progress Log) to allow velocity calculation & variance tracking (Actual / Estimate ratio, absolute delta, and CPI style metric = Estimate / Actual).

## **12. Progress Log**

| Date (UTC) | Entry Type | Item(s) | Summary / Notes | Time Logged (hrs) |
|------------|-----------|---------|-----------------|-------------------|
| 2025-09-14 | Initialization Update | Documentation Restructure | Added Milestones, Suggested Next Step scaffold, tracking tables | 0.5 |
| 2025-09-14 | Feature Work (Ongoing) | M3 Path Highlight | Improved road-following, removed block clamp, intersection splitting | (TBD) |
| 2025-09-14 | Refactor / Fix | M3 + M1 Regression | Restored polygon tool via mode sync, added path length metric, cleanup on mode switch, introduced UI milestone M3.5 | 0.6 |
| 2025-09-14 | UI Enhancement | M3.5 Dynamic Street Coloring | Street highlight color now reacts instantly to zone type swatch changes | 0.2 |
| 2025-09-14 | UI Consolidation | M3.5 Unified Help Panel | Merged separate polygon & street help into single contextual panel; removed inline street help block | 0.2 |
| 2025-09-14 | Label Consistency | M3.5 Terminology Update | Renamed "Segment type" label to "Zone type" in street tool for consistency | 0.05 |
| 2025-09-14 | Repo Hygiene | Branch Rename | Local branch renamed to `008UpdateDrawingUI` (was `008StretcLineBetweenStartAndEndPoint`) preparing for persistence tasks | 0.05 |
| 2025-09-16 | Feature Work | M3 Extended Drag | Replaced path-constrained drag with full-network snapping; endpoints can now extend path over new road network segments | (TBD) |
| 2025-09-16 | Enhancement | M3 Recompute Helper | Added `recomputeStreetPathRef` + nonce to force explicit path recomputation after drag commit; improved effect dependency clarity | (TBD) |
| 2025-09-16 | Documentation | Milestone & Next Step Update | Updated milestone percentages (M3 90%, M3.5 55%); refreshed Suggested Next Step section | 0.2 |
| 2025-09-16 | Reliability Fix | M3 Path Shortening | Added same-line fast-path slice & precision trimming to eliminate intersection bounce | 0.4 |
| 2025-09-16 | Defensive Coding | M3 Snapping Validation | Hardened snapping against malformed coordinates (guards + logging) | 0.2 |

Guideline: Add an entry when a milestone meaningfully advances (≥10% delta) or concludes. Time Logged aggregates focused engineering time (exclude context switching & unrelated research).

## **13. Suggested Next Step**

Updated (2025-09-16)

Primary objective: **Close out M3 and deliver a minimal slice of M4 (street segment persistence) to enable save & recall of street transformations.**

Why now:
* M3 core pathfinding + extended drag + recompute trigger are in place; remaining work is validation (robustness & cleanup) not new architecture.
* Persistence unlocks downstream milestones (Transformation tags, Impact metrics) by giving a stable entity to attach properties.
* Early save/load reduces future integration risk and establishes data shape conventions before adding complexity (tags, impacts, auth).

Recommended focused scope (Sprint 1.2):
1. Validation Harness (Dev Only): Add lightweight function to randomly sample 10 start/end pairs in current viewport, compute paths, log length & elapsed; flag anomalies (e.g., null path, <20m, repeated coordinates). (Supports M3 DONE decision.)
2. Street Segment Save Button: Visible when both start/end + path exist; auto‑generates name (e.g., "Segment #{n}" or nearest street name pair) and stores GeoJSON in in‑memory `savedSegments` array (analogous to polygons) with properties `{ id, name, type:'street-segment', useType, lengthM, createdAt }`.
3. Sidebar Integration: New list section below zones showing saved segments (click to highlight, sets selection state; no edit first pass).
4. Layer & Source: Add `saved-street-segments` source + line layer (casing + fill) with color by `useType`; selected style emphasis.
5. Cleanup & Reliability: Remove verbose debug logs from drag snapping and path build after validation; keep perf summary logs gated behind a DEV flag.

Exit Criteria (to mark M3 DONE & partial M4):
* 10/10 validation runs produce non-null paths, no duplicate consecutive coordinates, length >= 40m unless clearly short by design (cul-de-sac).
* Save → list → reselect round trip works with ≥2 segments.
* No console errors (except expected MapLibre warnings) and no duplicate layer/source warnings.
* Average path recompute (selection → highlight) <150ms at zoom 14 for validation runs (log median & max).

Stretch (optional if time remains):
* Add simple delete (trash icon) for saved segments.
* Derive default segment name using reverse geocoded nearest two intersecting street names (e.g., "Oak St to Fell St").
* Quick filter toggle: show/hide saved segments layer.

Deferral (explicitly NOT in this step): Editing saved segment geometry; multi-segment corridor merging; cloud persistence; transformation tags.

## **14. Agile Delivery & Process Improvements**

Recommended workflow:
1. **Sprint Cadence:** 1-week sprints (or 5–7 calendar days) with a lightweight planning note (choose 1–2 milestone increments) and an end-of-sprint review + retro appended to Progress Log.
2. **Definition of Done:** (a) Code committed & builds without errors, (b) Manual smoke test for new feature passes, (c) Documentation updated if user-facing behavior changed, (d) Time logged.
3. **MVP Boundary (for M10):** M1–M6 inclusive; defer M7+ unless critical. This centers on: map, polygon draw & save, street segment select & save, transformation tags (basic), impact panel (basic), and stable UI scaffolding.
4. **Time Tracking Simplicity:** Add a single line per focused session (date, milestone ID, task, duration) rather than granular timers.
5. **Variance Review:** At each sprint close, compute: `Variance% = (Actual - Planned)/Planned` per active milestone; update Milestones table.
6. **Risk Log (Lightweight):** If a blocker > 1 day appears, add an entry under a small "Risks" subsection (can be appended below Progress Log) with mitigation & owner.
7. **Branching Model:** Feature branches per milestone (e.g., `feature/m3-street-selection-persist`), merge via PR with a short checklist: tests (if any), manual demo notes, doc updated.
8. **Instrumentation (Later):** Once persistence exists, optional simple analytics: count of zones vs segments saved to measure usage.

### Additional Suggestions
* Introduce a minimal automated test harness (even a single Jest test ensuring GeoJSON feature creation) by Milestone M4 to prevent regressions in geometry building.
* Add lightweight performance instrumentation for pathfinding (capture ms per selection) feeding future optimization decisions.
* Consider storing a normalized internal ID for roads to support future multi-segment path merging.
* Add a toggle to visualize graph nodes / snapped points for debugging (dev-only layer) then hide in production builds.

## **15. Open Questions / Pending Clarifications**
1. Do we need multi-user collaboration in MVP (affects scope of M8)?
2. Should street segments be mergeable into corridors (future M12?)
3. What precision of impact metrics is acceptable for Phase 1 (heuristic vs modeled)?

---

_Documentation updated: 2025-09-16 (post M3 completion)_