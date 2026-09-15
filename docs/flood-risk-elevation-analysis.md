# Plot Flood-Risk Elevation Analysis

The proposed capability is a **plot-level, multi-mechanism flood-risk model**. It combines terrain connectivity, rainfall runoff, drainage capacity, nearby water bodies, and historical flood evidence rather than simply comparing the plot elevation with its surroundings.

> **Important:** Satellite data can provide useful screening, but it cannot certify an individual plot as flood-safe. Typical open DEMs have approximately 30 m pixels and metre-scale vertical errors, so they cannot resolve road crowns, compound walls, kerbs, culverts, drain inverts, or floor and plinth levels.

## 1. Flood mechanisms

The model should evaluate each flood mechanism separately.

| Mechanism | Main question |
|---|---|
| Upstream run-on | How much hydraulically connected higher ground drains toward the plot? |
| Local ponding | Is the plot inside a depression, and how much water can accumulate before spilling? |
| Downstream restriction | Can water leave the plot, and where does it go? |
| Urban or pluvial flooding | Can rainfall exceed infiltration and storm-drain capacity? |
| River flooding | Can a nearby river's flood level or backwater reach the plot? |
| Lake or reservoir overflow | Is there a connected overflow route toward the plot? |
| Drain surcharge | Can downstream drains fill and force water back toward the plot? |
| Groundwater flooding | Can shallow groundwater reduce infiltration or rise above ground level? |
| Coastal flooding | If applicable, can tide, storm surge, river flow, and rainfall combine? |
| Dam-release risk | Is the plot inside an official dam-break or emergency inundation zone? |

These mechanisms should not be collapsed into one opaque score. Each mechanism needs its own severity, confidence, and supporting evidence.

## 2. Terrain and open-area analysis

### 2.1 Establish the plot reference elevation

Use the following sources in priority order:

1. Surveyed plot, road, drain, and floor levels.
2. LiDAR, photogrammetric DTM, or Survey of India high-resolution DEM.
3. Satellite DEM as a screening fallback.

The reference could be the surveyed plot median or another defined design level. Classify surrounding cells using an elevation uncertainty tolerance:

```text
elevation tolerance = max(minimum tolerance, DEM error multiplier)
```

- **Below plot:** elevation is lower than the plot reference minus the tolerance.
- **Approximately level:** elevation is within the tolerance around the plot reference.
- **Above plot:** elevation is higher than the plot reference plus the tolerance.

Report area and percentage in bands such as:

- More than 2 m below
- 1-2 m below
- 0.5-1 m below
- Approximately level
- 0.5-1 m above
- 1-2 m above
- More than 2 m above

The band width must not imply more precision than the elevation source supports.

### 2.2 Account for hydraulic connectivity

Elevation alone does not determine whether an area contributes or receives water.

A higher area is a contributor only when:

- It belongs to the plot's upstream surface catchment.
- It drains into a channel or pipe network that discharges or surcharges near the plot.

A lower area is a receiver only when:

- A continuous surface route or verified drain connects it to the plot.
- No road, wall, bund, building, or other barrier blocks the route.
- Its storage or outlet is available during the storm.

For every upstream contributor, calculate:

- Connected catchment area
- Relative elevation
- Slope and flow length
- Impervious and pervious fractions
- Travel time
- Entry point into the plot
- Runoff volume and peak flow

For every downstream receiver, calculate:

- Connected open area
- Available depression or storage volume
- Infiltration potential
- Outlet capacity
- Spill elevation and overflow destination
- Distance and route slope

## 3. Geospatial analysis workflow

1. Accept a cadastral-quality plot polygon and optional surveyed points.
2. Build an adaptive study area rather than using a fixed buffer.
3. Acquire multiple DEMs and compare their results.
4. Reconcile coordinate systems and vertical datums.
5. Remove or flag building and vegetation contamination.
6. Condition the terrain using selective sink filling and breaching.
7. Preserve plausible ponds, tanks, wetlands, and detention areas.
8. Generate slope, aspect, local relief, flow direction, and flow accumulation.
9. Delineate all upstream catchments entering the plot.
10. Trace downstream routes from every low plot boundary.
11. Calculate Height Above Nearest Drainage (HAND) and topographic wetness.
12. Detect depressions and calculate stage-area-volume relationships and spill levels.
13. Segment buildings, roads, paved surfaces, vegetation, bare ground, and water.
14. Overlay rivers, drains, lakes, wetlands, floodplains, dams, and historical floods.
15. Run rainfall and drainage scenarios.
16. Repeat important scenarios across alternative DEMs and uncertain parameters.

Alternative flow routes should be retained when an uncertain culvert, road, wall, or DEM error changes the conclusion.

## 4. Rainfall required to flood the plot

The model should use a time-varying plot water balance:

```text
change in plot storage
  = rainfall on plot
  + upstream run-on
  - infiltration
  - drainage discharge
  - overflow from plot
```

Effective drainage is limited by its weakest component:

```text
effective capacity = minimum(
  inlet capacity,
  pipe or channel capacity,
  outfall capacity,
  downstream capacity
)
```

Run at least these drainage scenarios:

- No functioning drainage
- Expected drainage
- Partially blocked drainage
- Documented design capacity
- Elevated river or lake tailwater
- Fully saturated antecedent soil

For storm durations such as 15 minutes, 30 minutes, 1 hour, 3 hours, 6 hours, 12 hours, and 24 hours, find the rainfall threshold that causes:

- Initial ponding
- 100 mm plot depth
- Entry into a proposed building
- Exceedance of the plinth or finished-floor level
- A defined percentage of the plot to flood
- Ponding longer than a defined duration

Each result should include:

- Threshold rainfall range
- Duration and temporal distribution
- Average and peak intensity
- Approximate return period
- Antecedent soil condition
- Drainage and blockage assumption
- Tailwater assumption
- Climate adjustment
- Flood mechanism
- Confidence interval

An example result is:

> Under saturated soil and partially blocked drainage, approximately 78-96 mm in three hours may produce 150 mm of ponding. The corresponding return period is uncertain because local recording-rain-gauge data were unavailable.

## 5. Recommended data stack

| Need | Screening sources |
|---|---|
| Terrain | [Copernicus GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), NASADEM, CartoDEM |
| High-resolution Indian terrain | [Survey of India DEM catalogue](https://surveyofindia.gov.in/pages/availability-of-ori-and-dem) |
| Optical imagery | Sentinel-2, Landsat, and recent commercial imagery where necessary |
| Flood detection | Sentinel-1 SAR and Copernicus Global Flood Monitoring |
| Historical water | [JRC Global Surface Water](https://global-surface-water.appspot.com/download) |
| Rivers and lakes | HydroRIVERS, HydroLAKES, and OpenStreetMap |
| Indian hydrography | [National Water Data Portal](https://nwdp.nwic.gov.in/dataset/river-line) and [India-WRIS](https://indiawris.gov.in/wris/#/) |
| Rainfall observations | GPM IMERG, MOSDAC GSMaP-ISRO, and IMD or NWDP observations |
| Engineering rainfall | Local IMD recording-gauge data and official IDF curves |
| River forecast | CWC forecasts and GloFAS for large-river context |
| Land cover | ESA WorldCover, Dynamic World, and Bhuvan LULC |
| Soil | SoilGrids, HYSOGs, and ICAR-NBSS&LUP Bhoomi |
| Groundwater and geology | CGWB NAQUIM, monitoring wells, and GSI Bhukosh |
| Flood hazard | Official state maps, CWC products, and JRC river hazard maps |
| Drains | Municipal GIS, engineering drawings, and field survey |
| Dams | CWC or NWDP reservoir data and official Emergency Action Plans |
| Coastal | INCOIS tide and storm-surge products |
| Local evidence | Waterlogging complaints, high-water marks, photographs, and interviews |

### 5.1 Minimum viable open-data stack

Use:

- Copernicus GLO-30 and NASADEM
- Sentinel-1 and Sentinel-2
- JRC Global Surface Water
- HydroSHEDS, HydroRIVERS, and HydroLAKES
- GPM IMERG
- ESA WorldCover
- SoilGrids

For India, supplement these with:

- CartoDEM and available Survey of India DEMs
- India-WRIS and National Water Data Portal datasets
- IMD rainfall, warnings, forecasts, and historical station data
- NRSC or Bhuvan flood products
- State flood atlases
- Municipal drain and lake maps
- Official dam Emergency Action Plans

### 5.2 Data limitations and licensing

- Compare DEMs rather than averaging them blindly.
- Do not rely on elevation differences of only a few metres from 30 m DEM products.
- Vertical datums must be reconciled before comparing the plot with river, lake, road, or drain levels.
- OpenStreetMap completeness varies; the absence of a drain does not prove that none exists.
- Public map viewers do not automatically permit bulk extraction or commercial redistribution.
- Some useful datasets, including public FABDEM releases and some historical flood products, have non-commercial licensing restrictions.
- Every dataset should retain its source, version, acquisition date, resolution, datum, license, and processing history.

## 6. Nearby lakes, rivers, and drains

Proximity alone must never produce an overflow conclusion. For each water feature, determine:

- Straight-line and hydraulic distance
- Connection through terrain or drainage
- Water level relative to the plot in a common vertical datum
- Historical maximum extent
- Regulatory floodplain overlap
- Bank, bund, embankment, and road elevations
- Outlet or spillway capacity
- Backwater route
- Downstream constrictions
- Whether the plot lies behind or below a restricted drainage outfall

### 6.1 River and channel risks

Evaluate:

- HAND relative to the channel
- Historical flood extent
- Modelled or observed stage
- Levees and embankments
- Bridges and downstream constrictions
- Outfall tailwater exposure

### 6.2 Lake and reservoir risks

Evaluate:

- Normal and seasonal operating levels
- Observed or design high-water levels
- Shoreline and embankment elevations
- Outlet and spillway capacity
- Connected overflow route toward the plot
- Authoritative inundation and emergency-planning products

Do not infer dam-break risk from proximity alone. Use an official Emergency Action Plan or dedicated breach study.

### 6.3 Drains, pipes, and culverts

Account for:

- Inlet capacity
- Pipe or section geometry
- Slope and roughness
- Inlet and outlet control
- Headwater and tailwater
- Submergence
- Blockage
- Pumps, gates, and backflow devices

Drain maps usually show asset locations, not invert levels, connectivity, condition, blockage, or hydraulic capacity.

When the plot is materially exposed, escalate to:

- EPA SWMM or equivalent for urban drains
- A 1D river or channel model
- Coupled 1D/2D hydraulics such as HEC-RAS, LISFLOOD-FP, TELEMAC, TUFLOW, or equivalent

These advanced models require surveyed cross-sections, structures, drains, roughness, and boundary water levels.

## 7. Model outputs

The plot report should include:

- Elevation percentiles and source uncertainty
- Lowest plot boundary segments and probable outlets
- Area above, approximately level with, and below the plot
- Connected upstream catchment area
- Connected downstream receiving area
- Imperviousness and infiltration assumptions
- Depression volume and spill elevation
- Rivers, lakes, wetlands, drains, and floodplains
- Historical water and flood observations
- Rainfall-trigger curves by storm duration
- Peak depth, flooded fraction, and ponding duration
- Drainage-capacity margin
- Dominant flood mechanism
- Confidence and missing-data flags
- Specific surveys or records needed to improve confidence

Map layers should show:

- Source and conditioned DEMs
- Slope, relief, HAND, and wetness
- Catchments and plot entry points
- Downstream routes and outlets
- Depression depth and spill routes
- Above, level, and below open areas
- Contributor and receiver zones
- Rivers, lakes, wetlands, drains, and floodplains
- Historical flood observations
- Scenario depth, duration, velocity, and hazard
- Data-quality and uncertainty masks

Present **concern flags**, not an unsupported binary "safe" or "unsafe" conclusion.

## 8. Implementation phases

### Phase 0: Scientific foundation

- Define geometry, coordinate, unit, vertical-datum, and time-series contracts.
- Create dataset manifests and processing lineage.
- Establish license controls.
- Define warning and confidence taxonomies.
- Build synthetic terrain and hydrology test cases.

**Exit criterion:** The system can determine whether a plot is analyzable and explain why.

### Phase 1: Terrain-screening MVP

- Plot validation and data-quality checks
- Multiple DEM comparison
- Terrain conditioning
- Flow direction and accumulation
- Catchment and downstream-flow delineation
- Above, level, and below open-area analysis
- Depression storage
- HAND and slope
- Nearby-water and flood-map overlays
- Concern flags, confidence ratings, and limitations

Do not estimate precise flood-causing rainfall during this phase.

### Phase 2: Rainfall, connectivity, and drainage

- Improved fill and breach handling
- Culvert and drain enforcement
- Land-cover and imperviousness extraction
- Detailed contributor and receiver connectivity
- Infiltration and runoff modelling
- Local design storms
- Plot water balance
- Expected, blocked, and failed drainage scenarios
- Rainfall threshold curves
- Parameter uncertainty ranges

### Phase 3: River, lake, and backwater

- Water-level and gauge integration
- Floodplain and historical-event comparison
- Lake and reservoir operating-level scenarios
- Drain-outfall tailwater and reverse-flow scenarios
- Compound rainfall and external-stage events
- 1D river and drain modelling where supported
- Calibration workflows

### Phase 4: Engineering-grade assessment

- RTK or PPK GNSS and total-station survey support
- Road, kerb, wall, plinth, drain-invert, and outfall levels
- High-resolution DTM or LiDAR
- Drain dimensions and blockage inspections
- Soil infiltration and groundwater measurements
- Coupled 1D/2D flood modelling
- Calibration against observed flood depths
- Depth, velocity, duration, and hazard maps

### Phase 5: Continuous and predictive capability

- Continuous rainfall and antecedent soil-moisture state
- Near-real-time radar, satellite, and gauge feeds
- Groundwater and seasonal-wetness extensions
- Future land-use scenarios
- Climate-adjusted storms
- Mitigation comparison and optimization
- Portfolio-scale processing

## 9. Suggested implementation technologies

| Area | Options |
|---|---|
| Scientific processing | Python, with C++ or Rust kernels for performance-critical operations |
| Raster and vector processing | GDAL, Rasterio, GeoPandas, Shapely, and Xarray |
| Terrain hydrology | WhiteboxTools, TauDEM, GRASS GIS, SAGA GIS, or validated custom kernels |
| Spatial database | PostgreSQL with PostGIS |
| Raster storage | Cloud-optimized GeoTIFF and Zarr |
| Tabular and time-series storage | Parquet and PostgreSQL |
| Dataset catalogue | STAC |
| Workflow orchestration | Temporal, Dagster, Airflow, Argo, or durable cloud functions |
| Map services | OGC API, TiTiler, GeoServer, and raster or vector tiles |
| Client mapping | MapLibre GL, OpenLayers, or Cesium |
| Urban drainage | EPA SWMM or equivalent |
| River and surface hydraulics | HEC-RAS, LISFLOOD-FP, TELEMAC, TUFLOW, or equivalent |

For the MVP, prefer a modular application with scientific worker pools rather than creating a separate microservice for every algorithm.

## 10. Validation and confidence

Important uncertainty sources include:

- DEM vertical and horizontal error
- Buildings and vegetation in surface elevation
- Unknown walls, roads, culverts, and drains
- Incomplete hydrography
- Soil and infiltration uncertainty
- Drain blockage and maintenance condition
- Unknown downstream tailwater
- Rainfall spatial variability
- Historical flood-observation bias
- Future development and climate non-stationarity

Repeat important scenarios over:

- Alternative DEMs
- Plausible vertical offsets
- Fill-versus-breach terrain interpretations
- Infiltration or Curve Number ranges
- Drainage capacity and blockage levels
- Tailwater conditions
- Storm temporal patterns
- Climate factors

Every important result should provide:

- The scenario and flood mechanism
- A value or range
- Confidence level
- Supporting evidence
- Dominant uncertainty
- Missing information
- Recommended action to reduce uncertainty

## 11. Acceptance criteria

- Invalid plot geometry returns an actionable error.
- Every dataset records source, version, datum, resolution, license, and checksum.
- Plot-versus-DEM-resolution limitations are explicit.
- Incompatible vertical datums block affected comparisons.
- Upsampled data are never represented as higher-information measurements.
- Above, level, and below areas are reported as area and percentage.
- Contributor status requires catchment membership or verified network routing.
- Receiver status requires a demonstrated surface or network connection.
- Proximity alone never produces a river, lake, or reservoir overflow conclusion.
- Rainfall thresholds are tied to explicit flood criteria and assumptions.
- Rainfall-driven flooding and external-stage flooding remain separate.
- Missing data reduces confidence rather than producing invented precision.
- Results are reproducible from their source and configuration manifest.

## 12. Recommended field escalation

For a single urban plot, surveying the **floor-plot-road-drain-outfall elevation chain** will usually improve the result more than purchasing another medium-resolution satellite dataset.

The preferred field investigation includes:

- RTK or PPK GNSS for open-sky control
- Total-station survey around walls, buildings, roads, and obstructions
- Digital levelling for floor, road, kerb, drain-invert, and outfall differences
- Drain and culvert dimensions, slopes, and condition
- Infiltration or percolation testing
- Shallow groundwater monitoring where relevant
- Geotagged historic high-water marks

## 13. Recommended algorithms

There is no single best flood-prediction algorithm. The recommended solution is a hybrid pipeline combining terrain analysis, rainfall-runoff modelling, drainage and surface hydraulics, observations, and uncertainty estimation.

| Algorithm family | Best use | Recommendation |
|---|---|---|
| D8 flow routing | Deterministic drainage paths and baseline catchments | Retain as a simple, reproducible baseline |
| D-infinity flow routing | Distributed hillslope flow and upstream contributing areas | Prefer where flow dispersion matters |
| Priority-Flood | DEM depression processing | Use selectively; do not remove real ponds or detention areas |
| Fill-Spill-Merge | Nested depression storage and overflow | Use for plot ponding and urban blue-spot analysis |
| HAND | Relative elevation above drainage | Use for screening, subject to DEM and channel accuracy |
| Green-Ampt infiltration | Event infiltration | Prefer when defensible soil parameters or field measurements exist |
| SCS or NRCS Curve Number | Screening runoff volume | Use with uncertainty ranges and antecedent-moisture scenarios |
| Rational Method | Peak flow from small urban catchments | Use only within its small-catchment assumptions |
| EPA SWMM | Urban drains, pipes, storage, controls, pumps, and surcharge | Preferred open urban drainage model |
| Local-inertial 2D hydraulics | Plot, neighbourhood, and floodplain inundation | Recommended default speed-versus-accuracy solver |
| Full shallow-water equations | Rapid flow, steep terrain, breaches, and velocity hazard | Use for engineering studies where momentum effects matter |
| Cellular automata | Rapid inundation screening | Useful for scenario generation, but less physically complete |
| Ensemble Kalman Filter | Gauge and satellite assimilation | Use for operational state and parameter correction |
| LSTM | River discharge and stage forecasting | Strong established neural baseline |
| CNN or U-Net surrogate | Fast flood-depth and extent prediction | Train against validated hydraulic simulations |
| Graph neural network | River-network forecasting | Evaluate against simpler baselines; topology does not guarantee improvement |
| Transformer | Long sequence, multi-basin, and multimodal prediction | Use where scale and task complexity justify it |
| Hybrid or differentiable process model | Physically constrained machine learning | Prefer over unconstrained black-box prediction for future development |

### 13.1 Recommended HomePlanner pipeline

The initial implementation should use:

```text
Selective Priority-Flood
    -> Fill-Spill-Merge depression hierarchy
    -> D-infinity flow routing
    -> HAND and terrain susceptibility
    -> Green-Ampt or uncertain Curve Number runoff
    -> SWMM drainage network
    -> local-inertial 2D surface hydraulics
    -> ensemble uncertainty analysis
```

Use D8 as a deterministic comparison baseline. Retain alternative fill, breach, culvert, and barrier interpretations when they materially alter connectivity.

### 13.2 Terrain and depression layer

Use Priority-Flood, Fill-Spill-Merge, D-infinity routing, flow accumulation, HAND, and stage-area-volume curves to determine:

- Which higher areas drain toward the plot
- Which lower areas can receive plot runoff
- Where water enters and exits
- How much depression storage exists
- The water level required before each depression spills

Roads, walls, kerbs, buildings, drains, and culverts must be represented explicitly when suitable data are available.

### 13.3 Rainfall-runoff layer

Use a tiered approach:

- **MVP:** SCS or NRCS Curve Number with parameter ranges
- **Better event model:** Green-Ampt infiltration
- **Small urban peak-flow check:** Rational Method
- **Drainage network:** EPA SWMM
- **Large rural catchment:** calibrated conceptual or distributed hydrological model

Run dry, typical, wet, and saturated antecedent-condition scenarios rather than relying on a single infiltration or soil parameter.

### 13.4 Inundation layer

Use a local-inertial 2D solver as the default for predominantly subcritical urban and floodplain flows. It usually provides the best balance between computation time and physical realism.

Escalate to the full 2D shallow-water equations for:

- Fast or supercritical flow
- Steep terrain
- Dam or embankment breach
- High velocity hazard
- Complex momentum interactions
- Detailed engineering design

For urban plots, couple the 2D surface solver to SWMM or another 1D drainage model. This dual-drainage approach represents both underground conveyance and overland flow.

### 13.5 Operational prediction and machine learning

An operational forecasting tier can combine:

- Meteorological rainfall ensembles
- Hydrological ensemble forecasts
- LSTM discharge or stage forecasts
- Ensemble Kalman Filter assimilation of gauges
- Satellite flood-map assimilation
- Hydraulic simulations, lookup tables, or trained surrogate models

Machine learning should supplement rather than replace hydraulic modelling. A CNN or U-Net surrogate can later be trained on a large set of validated 2D hydraulic simulations to support rapid interactive scenarios.

LSTM or transformer forecasting becomes useful when the product incorporates real-time rainfall, river-stage, or discharge prediction. For plot-level cloudbursts, rainfall observation and forecast resolution will often limit accuracy more than the selected neural architecture.

## 14. Research papers

### 14.1 Terrain routing and depression analysis

1. **O'Callaghan and Mark (1984), "The extraction of drainage networks from digital elevation data."** Seminal D8 drainage extraction. [DOI](https://doi.org/10.1016/S0734-189X(84)80011-0)
2. **Tarboton (1997), "A new method for the determination of flow directions and upslope areas in grid digital elevation models."** Introduced D-infinity flow routing. [DOI](https://doi.org/10.1029/96WR03137)
3. **Nobre et al. (2011), "Height Above the Nearest Drainage - a hydrologically relevant new terrain model."** Foundational HAND reference. [DOI](https://doi.org/10.1016/j.jhydrol.2011.03.051)
4. **Nobre et al. (2016), "HAND contour: a new proxy predictor of inundation extent."** Connects HAND more directly to inundation delineation. [DOI](https://doi.org/10.1002/hyp.10581)
5. **Barnes, Lehman, and Mulla (2014), "Priority-Flood."** Efficient and robust DEM depression processing. [DOI](https://doi.org/10.1016/j.cageo.2013.04.024)
6. **Balstrom and Crawford (2018), "Arc-Malstrom."** Urban blue-spot method for identifying depressions, contributing areas, capacity, and spill paths. [DOI](https://doi.org/10.1016/j.cageo.2018.04.010)
7. **Barnes, Callaghan, and Wickert (2021), "Fill-Spill-Merge."** Scalable routing through nested depression hierarchies. [DOI](https://doi.org/10.5194/esurf-9-105-2021)

### 14.2 Rainfall-runoff and urban drainage

1. **Green and Ampt (1911), "Studies on Soil Physics. I. The Flow of Air and Water Through Soils."** Foundation of Green-Ampt infiltration. [DOI](https://doi.org/10.1017/S0021859600001441)
2. **Sherman (1932), "The relation of hydrographs of runoff to size and character of drainage-basins."** Foundation of unit hydrograph theory. [DOI](https://doi.org/10.1029/TR013i001p00332)
3. **Ponce and Hawkins (1996), "Runoff Curve Number: Has It Reached Maturity?"** Important critical treatment of Curve Number assumptions. [DOI](https://doi.org/10.1061/(ASCE)1084-0699(1996)1:1(11))
4. **Niazi et al. (2017), "Storm Water Management Model: Performance Review and Gap Analysis."** Review of EPA SWMM capabilities and limitations. [DOI](https://doi.org/10.1061/jswbay.0000817)
5. **Leandro et al. (2009), "Comparison of 1D/1D and 1D/2D Coupled Hydraulic Models for Urban Flood Simulation."** Key evidence supporting dual-drainage modelling. [DOI](https://doi.org/10.1061/(ASCE)HY.1943-7900.0000037)
6. **Guo, Guan, and Yu (2021), "Urban surface water flood modelling - a comprehensive review of current models and future challenges."** Strong overview of urban pluvial modelling. [DOI](https://doi.org/10.5194/hess-25-2843-2021)

### 14.3 Hydraulic inundation

1. **Bates and De Roo (2000), "A simple raster-based model for flood inundation simulation."** Foundation of LISFLOOD-FP and reduced-complexity raster hydraulics. [DOI](https://doi.org/10.1016/S0022-1694(00)00278-X)
2. **Hunter et al. (2008), "Benchmarking 2D hydraulic models for urban flooding."** Seminal comparative urban hydraulic benchmark. [DOI](https://doi.org/10.1680/wama.2008.161.1.13)
3. **Bates, Horritt, and Fewtrell (2010), "A simple inertial formulation of the shallow water equations for efficient two-dimensional flood inundation modelling."** Core local-inertial reference. [DOI](https://doi.org/10.1016/j.jhydrol.2010.03.027)
4. **de Almeida et al. (2012), "Improving the stability of a simple formulation of the shallow water equations for 2-D flood modeling."** Important numerical stabilization of local-inertial flood modelling. [DOI](https://doi.org/10.1029/2011WR011570)
5. **Guidolin et al. (2016), weighted cellular-automata flood modelling.** Representative rapid cellular-automata method. [DOI](https://doi.org/10.1016/j.envsoft.2016.07.008)
6. **Teng et al. (2017), "Flood inundation modelling: A review of methods, recent advances and uncertainty analysis."** Broad review of empirical, simplified, and hydrodynamic methods. [DOI](https://doi.org/10.1016/j.envsoft.2017.01.006)
7. **Shaw et al. (2021), "LISFLOOD-FP 8.0."** Discontinuous-Galerkin shallow-water solver for multicore CPUs and GPUs. [DOI](https://doi.org/10.5194/gmd-14-3577-2021)
8. **Sharifian et al. (2023), "LISFLOOD-FP 8.1."** GPU-accelerated solvers for fluvial and pluvial simulations. [DOI](https://doi.org/10.5194/gmd-16-2391-2023)

### 14.4 Forecasting, data assimilation, and machine learning

1. **Moradkhani et al. (2005), "Dual state-parameter estimation of hydrological models using ensemble Kalman filter."** Foundational hydrological EnKF application. [DOI](https://doi.org/10.1016/j.advwatres.2004.09.002)
2. **Cloke and Pappenberger (2009), "Ensemble flood forecasting: A review."** Foundational operational ensemble review. [DOI](https://doi.org/10.1016/j.jhydrol.2009.06.005)
3. **Kratzert et al. (2018), "Rainfall-runoff modelling using Long Short-Term Memory networks."** Seminal modern neural-hydrology paper. [DOI](https://doi.org/10.5194/hess-22-6005-2018)
4. **Kabir et al. (2020), "A deep convolutional neural network model for rapid prediction of fluvial flood inundation."** Strong hydraulic-surrogate example. [DOI](https://doi.org/10.1016/j.jhydrol.2020.125481)
5. **Bentivoglio et al. (2022), "Deep learning methods for flood mapping: a review."** Reviews deep flood mapping, transferability, physical consistency, and uncertainty limitations. [DOI](https://doi.org/10.5194/hess-26-4345-2022)
6. **Nevo et al. (2022), "Flood forecasting with machine learning models in an operational framework."** Evidence from an operational ML flood-forecasting system. [DOI](https://doi.org/10.5194/hess-26-4013-2022)
7. **Feng et al. (2022), differentiable, learnable regional process-based hydrological modelling.** Demonstrates combining process structure with learnable components. [DOI](https://doi.org/10.1029/2022WR032404)
8. **Nearing et al. (2024), "Global prediction of extreme floods in ungauged watersheds."** Landmark global extreme-flood prediction result. [DOI](https://doi.org/10.1038/s41586-024-07145-1)
9. **Kirschstein and Sun (2024), "The Merit of River Network Topology for Neural Flood Forecasting."** Shows that explicit graph topology does not automatically improve forecasts. [Proceedings](https://proceedings.mlr.press/v235/kirschstein24a.html)
10. **Liu et al. (2025), "From RNNs to Transformers: benchmarking deep learning architectures for hydrologic prediction."** Shows that LSTM remains competitive while attention models can help with harder autoregressive and zero-shot tasks. [DOI](https://doi.org/10.5194/hess-29-6811-2025)

### 14.5 Satellite flood mapping

1. **Horritt, Mason, and Luckman (2001), "Flood boundary delineation from SAR imagery using a statistical active contour model."** Foundational SAR flood-boundary extraction. [DOI](https://doi.org/10.1080/01431160116902)
2. **Twele et al. (2016), "Sentinel-1-based flood mapping: a fully automated processing chain."** Seminal operational SAR flood-mapping workflow. [DOI](https://doi.org/10.1080/01431161.2016.1192304)
3. **Bonafilia et al. (2020), "Sen1Floods11."** Public Sentinel-1 flood-segmentation dataset and deep-learning benchmark. [DOI](https://doi.org/10.1109/CVPRW50498.2020.00113)
4. **Amitrano et al. (2024), "Flood Detection with SAR: A Review of Techniques and Datasets."** Review of thresholding, change detection, machine learning, and SAR-specific errors. [DOI](https://doi.org/10.3390/rs16040656)

### 14.6 Uncertainty

1. **Beven and Binley (1992), "The future of distributed models: Model calibration and uncertainty prediction."** Introduced GLUE and the influential equifinality framing. [DOI](https://doi.org/10.1002/hyp.3360060305)
2. **Pappenberger et al. (2008), multi-method global sensitivity analysis for flood-inundation models.** Demonstrates how model inputs and assumptions influence flood outputs. [DOI](https://doi.org/10.1016/j.advwatres.2007.04.009)
3. **Klotz et al. (2022), probabilistic deep-learning rainfall-runoff benchmark.** Supports calibrated probabilistic prediction rather than deterministic neural output. [DOI](https://doi.org/10.5194/hess-26-1673-2022)

## 15. Mandatory limitation

> This analysis provides screening and planning support only. It is not a substitute for surveyed plot, ground, drainage, threshold, or finished-floor levels; professional drainage design; utility records; regulatory flood maps; or a site-specific hydrologic and hydraulic engineering flood study. Remotely sensed elevation data may contain errors larger than the elevation differences controlling flooding at an individual plot.
