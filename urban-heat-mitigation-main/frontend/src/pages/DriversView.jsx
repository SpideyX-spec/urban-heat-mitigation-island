import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ScatterChart,
  Scatter,
  ReferenceLine,
  CartesianGrid
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle,
  Database,
  Layers,
  Filter,
  BarChart3,
  TrendingUp,
  Sliders,
  CheckCircle2,
  Info
} from 'lucide-react';
import {
  API_BASE,
  fetchCityDrivers,
  fetchCityHotspotDrivers,
  fetchCityDependence
} from '../api';
import './DriversView.css';

// ─── Comprehensive Feature Dictionary ───────────────────────────
// Maps internal model column identifiers to human-readable names,
// scientific definitions, measurement units, and thematic categories.
const FEATURE_DICTIONARY = {
  air_temp_max: {
    name: 'Peak Ambient Air Temperature',
    unit: '°C',
    category: 'Macro-Atmospheric',
    definition:
      'Peak 2-meter air temperature derived from ERA5 reanalysis during the pre-monsoon summer period. Represents the regional synoptic thermal boundary conditions driving base surface heating.'
  },
  veg_imperv_ratio: {
    name: 'Vegetation-to-Impervious Ratio',
    unit: 'ratio',
    category: 'Urban Morphology',
    definition:
      'Ratio of vegetated land cover to sealed impervious surface within the 500m cell. Values > 1.0 denote vegetative thermal sinks, while values < 0.2 denote dense, non-evaporating urban heat traps.'
  },
  cooling_potential: {
    name: 'Evaporative Cooling Capacity',
    unit: 'index (0–250)',
    category: 'Microclimate Buffer',
    definition:
      'Engineered composite index integrating canopy density, vegetation fraction, and Euclidean proximity to surface water bodies, modeling the cell’s capacity for latent heat flux dissipation.'
  },
  ndvi_mean: {
    name: 'Normalized Difference Veg Index (NDVI)',
    unit: 'index (-1 to +1)',
    category: 'Vegetation',
    definition:
      'Satellite multi-spectral reflectance ratio (NIR - Red)/(NIR + Red) from Sentinel-2. Quantifies photosynthetic biomass density, canopy health, and active transpiration cooling.'
  },
  frac_impervious: {
    name: 'Impervious Surface Fraction',
    unit: '% (0–100%)',
    category: 'Urban Morphology',
    definition:
      'Proportion of grid cell sealed by concrete, asphalt, paving, or building footprints. Prevents soil infiltration, eliminates latent cooling, and maximizes sensible heat transfer to the lower boundary layer.'
  },
  wind_speed_mean: {
    name: 'Mean Surface Wind Speed',
    unit: 'm / s',
    category: 'Atmospheric Dispersion',
    definition:
      'Mean 10-meter horizontal wind speed from ERA5 reanalysis. Controls advective thermal mixing, turbulent heat evacuation, and ventilation through urban street corridors.'
  },
  road_density: {
    name: 'Road Surface Density',
    unit: 'm / km²',
    category: 'Infrastructure',
    definition:
      'Total centerline length of vehicular roadways per unit area. High road density corresponds to dark asphalt surfaces with low albedo and elevated vehicular anthropogenic heat emissions.'
  },
  water_area_frac: {
    name: 'Surface Water Body Fraction',
    unit: '% (0–100%)',
    category: 'Hydrology',
    definition:
      'Fraction of cell area covered by open water (lakes, rivers, canals, retention basins). Water bodies provide substantial microclimate buffering via continuous evaporative cooling and high thermal inertia.'
  },
  sky_view_factor: {
    name: 'Sky View Factor (SVF)',
    unit: 'ratio (0–1)',
    category: 'Urban Morphology',
    definition:
      'Proportion of visible sky hemisphere unblocked by buildings or tall trees. High SVF facilitates nocturnal radiative heat release to the cold night sky, mitigating nocturnal heat retention.'
  },
  thermal_mass_proxy: {
    name: 'Thermal Mass Storage Index',
    unit: 'index',
    category: 'Material Properties',
    definition:
      'Estimated volumetric heat capacity of urban structural materials (concrete, masonry, stone). Captures daytime thermal energy absorption and delayed nocturnal heat re-radiation.'
  },
  solar_radiation: {
    name: 'Net Downward Solar Irradiance',
    unit: 'W / m²',
    category: 'Radiative Forcing',
    definition:
      'Surface downwelling solar flux absorbed by urban ground materials, providing the fundamental radiant energy that heats roofs, roads, and walls.'
  },
  building_density: {
    name: 'Building Footprint Density',
    unit: 'm² / ha',
    category: 'Built Environment',
    definition:
      'Total building footprint ground area per hectare. Dense structural clusters trap outgoing longwave radiation within narrow urban street canyons (the canyon trap effect).'
  },
  building_height_mean: {
    name: 'Mean Building Height',
    unit: 'm',
    category: 'Built Environment',
    definition:
      'Average vertical building elevation within the cell. Taller structures increase aerodynamic roughness and casting shadows during low sun angles, but decrease nocturnal sky view factor.'
  },
  frac_bare_soil: {
    name: 'Bare Soil Fraction',
    unit: '% (0–100%)',
    category: 'Land Cover',
    definition:
      'Unvegetated open ground or cleared construction earth. Lacks moisture retention and canopy shading, heating rapidly under direct summer insolation.'
  },
  frac_water: {
    name: 'Open Water Fraction (LULC)',
    unit: '% (0–100%)',
    category: 'Hydrology',
    definition:
      'Water classification derived from satellite spectral classification masks, identifying persistent surface hydrological features.'
  },
  ndbi_mean: {
    name: 'Normalized Difference Built-up Index (NDBI)',
    unit: 'index (-1 to +1)',
    category: 'Built Environment',
    definition:
      'Spectral reflectance index (SWIR - NIR)/(SWIR + NIR) isolating built-up structures and artificial surfaces from surrounding natural terrain.'
  },
  park_area_frac: {
    name: 'Designated Public Green Space',
    unit: '% (0–100%)',
    category: 'Urban Greenery',
    definition:
      'Proportion of land area officially designated as public municipal parks, recreational gardens, or urban forests, providing localized "park cool island" (PCI) buffers.'
  },
  frac_vegetation: {
    name: 'Total Vegetated Land Cover',
    unit: '% (0–100%)',
    category: 'Vegetation',
    definition:
      'Combined ground vegetation, lawn, shrubs, and tree canopy derived from satellite land-use/land-cover classification.'
  },
  dist_to_water: {
    name: 'Distance to Nearest Water Body',
    unit: 'meters (m)',
    category: 'Hydrology',
    definition:
      'Euclidean distance from cell centroid to the nearest significant open water feature. Proximity to water features correlates with cooling advection.'
  },
  green_deficit: {
    name: 'Vegetation Deficit Anomaly',
    unit: 'index (0–1)',
    category: 'Microclimate Buffer',
    definition:
      'Deviation between existing vegetative cover and the regional bioclimatic baseline, identifying severe ecological deficit areas in dense urban cores.'
  },
  tree_canopy_frac: {
    name: 'Tree Canopy Cover Fraction',
    unit: '% (0–100%)',
    category: 'Vegetation',
    definition:
      'High-canopy woody tree coverage providing overhead solar shading to ground surfaces and street corridors.'
  },
  ndvi_std: {
    name: 'Vegetation Heterogeneity (NDVI σ)',
    unit: 'std dev',
    category: 'Spatial Pattern',
    definition:
      'Spatial standard deviation of NDVI within the 500m cell, reflecting fragmentation vs uniformity of vegetative cover.'
  }
};

function getFeatureInfo(key) {
  if (FEATURE_DICTIONARY[key]) return FEATURE_DICTIONARY[key];
  return {
    name: key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    unit: 'index',
    category: 'Model Parameter',
    definition: 'Trained model feature input evaluated in the XGBoost regression pipeline.'
  };
}

export default function DriversView({ city, cityInfo }) {
  const [globalImportance, setGlobalImportance] = useState([]);
  const [hotspotDrivers, setHotspotDrivers] = useState([]);
  const [dependenceData, setDependenceData] = useState({});
  const [selectedFeatureKey, setSelectedFeatureKey] = useState('air_temp_max');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'heating' | 'cooling'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Responsive state
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 640
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!city) return;

    let cancelled = false;
    const controller = new AbortController();

    const fetchExplainabilityData = async () => {
      setLoading(true);
      setError(null);

      try {
        const [driversData, hotspotData, depData] = await Promise.all([
          fetchCityDrivers(city, controller.signal),
          fetchCityHotspotDrivers(city, controller.signal),
          fetchCityDependence(city, controller.signal)
        ]);

        if (cancelled) return;

        if (driversData?.global_importance) {
          setGlobalImportance(driversData.global_importance || []);
          if (driversData.global_importance.length > 0 && !selectedFeatureKey) {
            setSelectedFeatureKey(driversData.global_importance[0].feature);
          }
        } else {
          setError('Could not load global feature importance data.');
        }

        if (hotspotData?.hotspot_drivers) {
          setHotspotDrivers(hotspotData.hotspot_drivers);
        }

        if (depData?.features) {
          setDependenceData(depData.features);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load driver data', err);
          setError('Could not connect to model explainability service.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchExplainabilityData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [city]);

  // Filtered importance dataset
  const filteredImportance = useMemo(() => {
    if (activeFilter === 'heating') {
      return globalImportance.filter((d) => d.direction === 'positive').slice(0, 12);
    }
    if (activeFilter === 'cooling') {
      return globalImportance.filter((d) => d.direction === 'negative').slice(0, 12);
    }
    return globalImportance.slice(0, 12);
  }, [globalImportance, activeFilter]);

  // Model-Derived Dynamic Insights (derived strictly from model outputs)
  const topHeatingDriver = useMemo(() => {
    return globalImportance.find((d) => d.direction === 'positive') || null;
  }, [globalImportance]);

  const topCoolingDriver = useMemo(() => {
    return globalImportance.find((d) => d.direction === 'negative') || null;
  }, [globalImportance]);

  const topHotspotDriver = useMemo(() => {
    return hotspotDrivers.length > 0 ? hotspotDrivers[0] : null;
  }, [hotspotDrivers]);

  // Top 3 features for SHAP dependence plots
  const topThreeFeatures = useMemo(() => {
    if (!globalImportance || globalImportance.length === 0) {
      return ['air_temp_max', 'veg_imperv_ratio', 'cooling_potential'];
    }
    return globalImportance.slice(0, 3).map((d) => d.feature);
  }, [globalImportance]);

  const selectedFeatureInfo = useMemo(() => {
    return getFeatureInfo(selectedFeatureKey);
  }, [selectedFeatureKey]);

  const selectedFeatureData = useMemo(() => {
    return globalImportance.find((d) => d.feature === selectedFeatureKey) || null;
  }, [globalImportance, selectedFeatureKey]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-state font-mono">
          <div className="spinner"></div>
          <span>Loading Tree SHAP Explainability Engine...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-content drivers-container">
        {/* Header Block */}
        <div className="page-header">
          <div className="header-meta-row">
            <span className="platform-tag font-mono">TREE SHAP EXPLAINABILITY</span>
            <span className="sample-tag font-mono">54,828 CELLS · 20 CITIES</span>
          </div>
          <h1>Heat Drivers &amp; Model Attribution{cityInfo ? ` — ${cityInfo.name}` : ''}</h1>
          <p>
            Decomposes the non-linear influence of urban land cover, vegetation, atmospheric forcing,
            and built density on Land Surface Temperature predictions using Tree SHAP (SHapley Additive
            exPlanations).
          </p>
        </div>

        {error && <div className="status-error-banner font-mono">{error}</div>}

        {/* Dynamic Model-Derived Insights (Replacing Hardcoded Generic Cards) */}
        <div className="model-insights-strip">
          {/* Insight 1: Primary Warming Driver */}
          <div className="insight-card warming-card">
            <div className="insight-top">
              <span className="direction-badge dir-heating font-mono">
                <ArrowUpRight size={13} />
                ▲ HEATING DRIVER
              </span>
              {topHeatingDriver && (
                <span className="insight-impact font-mono">
                  +{topHeatingDriver.importance.toFixed(2)}°C avg
                </span>
              )}
            </div>
            <div className="insight-name">
              {topHeatingDriver ? getFeatureInfo(topHeatingDriver.feature).name : '—'}
            </div>
            <p className="insight-def">
              {topHeatingDriver ? getFeatureInfo(topHeatingDriver.feature).definition : ''}
            </p>
          </div>

          {/* Insight 2: Primary Cooling Buffer */}
          <div className="insight-card cooling-card">
            <div className="insight-top">
              <span className="direction-badge dir-cooling font-mono">
                <ArrowDownRight size={13} />
                ▼ COOLING BUFFER
              </span>
              {topCoolingDriver && (
                <span className="insight-impact font-mono">
                  -{topCoolingDriver.importance.toFixed(2)}°C avg
                </span>
              )}
            </div>
            <div className="insight-name">
              {topCoolingDriver ? getFeatureInfo(topCoolingDriver.feature).name : '—'}
            </div>
            <p className="insight-def">
              {topCoolingDriver ? getFeatureInfo(topCoolingDriver.feature).definition : ''}
            </p>
          </div>

          {/* Insight 3: City Hotspot Focus */}
          <div className="insight-card hotspot-focus-card">
            <div className="insight-top">
              <span className="direction-badge dir-hotspot font-mono">
                <BarChart3 size={12} />
                CITY HOTSPOT DRIVER
              </span>
              {topHotspotDriver && (
                <span className="insight-impact font-mono">
                  {topHotspotDriver.direction === 'heating' ? '▲ ' : '▼ '}
                  {topHotspotDriver.mean_abs_shap.toFixed(2)}°C
                </span>
              )}
            </div>
            <div className="insight-name">
              {topHotspotDriver ? getFeatureInfo(topHotspotDriver.feature).name : '—'}
            </div>
            <p className="insight-def">
              Evaluated specifically on {cityInfo?.name || city}&apos;s critical and high-tier hotspot
              cells. Identified as the primary driver of extreme local surface thermal anomalies.
            </p>
          </div>
        </div>

        {/* Main 2-Column Section: Global Importance & Feature Dictionary Inspector */}
        <div className="drivers-main-grid">
          {/* Left Column: Global Feature Importance Chart */}
          <div className="chart-panel glass-panel">
            <div className="panel-header-row">
              <div className="title-block">
                <h3>Global Feature Importance Ranking</h3>
                <span className="panel-subtitle font-mono">
                  Mean Absolute SHAP Value: E[|SHAP|] on LST (°C)
                </span>
              </div>

              {/* Directional Filter Controls */}
              <div className="filter-controls">
                <button
                  type="button"
                  className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  All ({globalImportance.length})
                </button>
                <button
                  type="button"
                  className={`filter-btn ${activeFilter === 'heating' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('heating')}
                  title="Filter to features that drive temperatures higher"
                >
                  <span className="symbol-heating">▲</span> Heating
                </button>
                <button
                  type="button"
                  className={`filter-btn ${activeFilter === 'cooling' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('cooling')}
                  title="Filter to features that provide cooling buffering"
                >
                  <span className="symbol-cooling">▼</span> Cooling
                </button>
              </div>
            </div>

            <div className="chart-wrapper">
              {filteredImportance.length > 0 ? (
                <ResponsiveContainer width="100%" height={430}>
                  <BarChart
                    data={filteredImportance}
                    layout="vertical"
                    margin={{
                      top: 10,
                      right: isMobile ? 12 : 30,
                      left: isMobile ? -10 : 10,
                      bottom: 5
                    }}
                    onClick={(e) => {
                      if (e?.activePayload?.[0]?.payload?.feature) {
                        setSelectedFeatureKey(e.activePayload[0].payload.feature);
                      }
                    }}
                  >
                    <CartesianGrid
                      strokeDasharray="2 4"
                      horizontal={false}
                      stroke="var(--line)"
                    />
                    <XAxis
                      type="number"
                      domain={[0, 'dataMax + 0.3']}
                      tick={{ fill: 'var(--text-3)', fontSize: 9.5, fontFamily: 'var(--font-mono)' }}
                      axisLine={{ stroke: 'var(--line)' }}
                      tickLine={false}
                      unit="°C"
                    />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      tickFormatter={(k) => {
                        const name = getFeatureInfo(k).name;
                        if (isMobile && name.length > 14) {
                          return name.slice(0, 13) + '…';
                        }
                        return name;
                      }}
                      width={isMobile ? 105 : 185}
                      axisLine={{ stroke: 'var(--line)' }}
                      tickLine={false}
                      tick={{
                        fill: 'var(--text-2)',
                        fontSize: isMobile ? 9.5 : 11,
                        fontFamily: 'var(--font-sans)'
                      }}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--surface-3)', opacity: 0.5 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          const info = getFeatureInfo(data.feature);
                          const isHeating = data.direction === 'positive';
                          return (
                            <div className="chart-tooltip glass-panel">
                              <div className="tt-header">
                                <span className="tt-name">{info.name}</span>
                                <span className="tt-category font-mono">{info.category}</span>
                              </div>
                              <div className="tt-metric-row font-mono">
                                <span className="tt-label">Mean Marginal Impact:</span>
                                <span className="tt-val">{data.importance.toFixed(3)}°C</span>
                              </div>
                              <div className="tt-dir-row font-mono">
                                <span className="tt-label">Directional Effect:</span>
                                <span
                                  className={`tt-dir-badge ${
                                    isHeating ? 'tt-dir-heating' : 'tt-dir-cooling'
                                  }`}
                                >
                                  {isHeating ? '▲ HEATING FACTOR' : '▼ COOLING FACTOR'}
                                </span>
                              </div>
                              <p className="tt-def">{info.definition}</p>
                              <div className="tt-hint font-mono">Click bar to view full definition</div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar
                      dataKey="importance"
                      radius={[0, 3, 3, 0]}
                      barSize={18}
                      className="clickable-bar"
                    >
                      {filteredImportance.map((entry) => {
                        const isHeating = entry.direction === 'positive';
                        const isSelected = entry.feature === selectedFeatureKey;
                        return (
                          <Cell
                            key={entry.feature}
                            fill={isHeating ? 'var(--tier-high)' : 'var(--tier-cool)'}
                            stroke={isSelected ? 'var(--text-1)' : 'transparent'}
                            strokeWidth={isSelected ? 1.5 : 0}
                            style={{ cursor: 'pointer' }}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-chart">No features match the selected filter.</div>
              )}
            </div>

            {/* Accessible Legend Below Chart */}
            <div className="importance-legend font-mono">
              <div className="legend-item">
                <span className="legend-swatch swatch-heating">▲</span>
                <span>Positive SHAP (Sensible Heating Driver)</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch swatch-cooling">▼</span>
                <span>Negative SHAP (Evaporative / Radiative Cooling Buffer)</span>
              </div>
            </div>
          </div>

          {/* Right Column: Selected Feature Deep Dive Inspector */}
          <div className="inspector-panel glass-panel">
            <div className="inspector-panel-header">
              <span className="inspector-badge font-mono">FEATURE ATTRIBUTION INSPECTOR</span>
              <h3>{selectedFeatureInfo.name}</h3>
              <code className="feature-code font-mono">{selectedFeatureKey}</code>
            </div>

            <div className="inspector-stats-grid">
              <div className="stat-card">
                <span className="stat-label">Model Importance</span>
                <span className="stat-val font-mono">
                  {selectedFeatureData ? `${selectedFeatureData.importance.toFixed(3)}°C` : '—'}
                </span>
                <span className="stat-sub">E[|SHAP|] on LST</span>
              </div>

              <div className="stat-card">
                <span className="stat-label">Directional Effect</span>
                <span
                  className={`stat-val font-mono ${
                    selectedFeatureData?.direction === 'positive'
                      ? 'text-heating'
                      : 'text-cooling'
                  }`}
                >
                  {selectedFeatureData?.direction === 'positive' ? '▲ HEATING' : '▼ COOLING'}
                </span>
                <span className="stat-sub">Marginal effect</span>
              </div>

              <div className="stat-card">
                <span className="stat-label">Measurement Unit</span>
                <span className="stat-val font-mono">{selectedFeatureInfo.unit}</span>
                <span className="stat-sub">Physical scale</span>
              </div>

              <div className="stat-card">
                <span className="stat-label">Domain Category</span>
                <span className="stat-val font-mono">{selectedFeatureInfo.category}</span>
                <span className="stat-sub">Thematic group</span>
              </div>
            </div>

            <div className="feature-definition-block">
              <div className="def-title">Scientific Definition &amp; Mechanism</div>
              <p className="def-text">{selectedFeatureInfo.definition}</p>
            </div>

            <div className="methodology-disclosure-box">
              <div className="disclosure-header">
                <Info size={13} className="disclosure-icon" />
                <span className="font-mono">About Tree SHAP Values</span>
              </div>
              <p>
                SHAP values satisfy efficiency, symmetry, and additivity from cooperative game theory.
                For any cell $x$, $\sum \phi_i = \hat{y}(x) - E[\hat{y}]$. A value of $+2.5^\circ\text{C}$
                means this feature pushed predicted surface temperature $2.5^\circ\text{C}$ higher than
                the citywide baseline average.
              </p>
            </div>
          </div>
        </div>

        {/* SHAP Dependence Plots Section (Task 6) */}
        <div className="dependence-section glass-panel">
          <div className="section-header-block">
            <div className="title-row">
              <TrendingUp size={16} className="section-icon" />
              <h2>SHAP Dependence Plots (Non-linear Feature Responses)</h2>
            </div>
            <p>
              Shows how variations in physical feature values (X-axis) directly affect predicted
              surface temperature impact (Y-axis, SHAP °C) across actual grid cells in{' '}
              <strong>{cityInfo?.name || city}</strong>. Non-linear curves reveal thresholds where
              mitigation interventions become effective.
            </p>
          </div>

          <div className="dependence-grid">
            {topThreeFeatures.map((featKey) => {
              const info = getFeatureInfo(featKey);
              const points = dependenceData[featKey] || [];

              return (
                <div key={featKey} className="dependence-card">
                  <div className="dep-card-header">
                    <span className="dep-feat-name">{info.name}</span>
                    <span className="dep-unit font-mono">Unit: {info.unit}</span>
                  </div>

                  <div className="dep-chart-container">
                    {points.length > 0 ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <ScatterChart margin={{ top: 10, right: 15, bottom: 20, left: 10 }}>
                          <CartesianGrid
                            strokeDasharray="2 4"
                            stroke="var(--line)"
                            opacity={0.7}
                          />
                          <XAxis
                            type="number"
                            dataKey="x"
                            name={info.name}
                            unit=""
                            tick={{
                              fill: 'var(--text-3)',
                              fontSize: 9.5,
                              fontFamily: 'var(--font-mono)'
                            }}
                            axisLine={{ stroke: 'var(--line)' }}
                            tickLine={false}
                          />
                          <YAxis
                            type="number"
                            dataKey="shap"
                            name="SHAP Impact"
                            unit="°"
                            tick={{
                              fill: 'var(--text-3)',
                              fontSize: 9.5,
                              fontFamily: 'var(--font-mono)'
                            }}
                            axisLine={{ stroke: 'var(--line)' }}
                            tickLine={false}
                          />
                          <ReferenceLine
                            y={0}
                            stroke="var(--line-strong)"
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                            label={{
                              value: '0° Baseline',
                              fill: 'var(--text-3)',
                              fontSize: 9,
                              fontFamily: 'var(--font-mono)',
                              position: 'insideBottomRight'
                            }}
                          />
                          <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const pt = payload[0].payload;
                                const isWarming = pt.shap > 0;
                                return (
                                  <div className="scatter-tooltip glass-panel font-mono">
                                    <div>
                                      <span>Value: </span>
                                      <strong>
                                        {pt.x} {info.unit}
                                      </strong>
                                    </div>
                                    <div className={isWarming ? 'text-heating' : 'text-cooling'}>
                                      <span>SHAP: </span>
                                      <strong>
                                        {isWarming ? '+' : ''}
                                        {pt.shap.toFixed(2)}°C
                                      </strong>{' '}
                                      ({isWarming ? '▲ Warming' : '▼ Cooling'})
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Scatter
                            name={info.name}
                            data={points}
                            fill="var(--tier-high)"
                          >
                            {points.map((pt, idx) => (
                              <Cell
                                key={`pt-${idx}`}
                                fill={pt.shap >= 0 ? 'var(--tier-high)' : 'var(--tier-cool)'}
                                opacity={0.75}
                              />
                            ))}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="dep-empty font-mono">
                        Computing dependence distribution for {city}...
                      </div>
                    )}
                  </div>

                  <div className="dep-card-footer font-mono">
                    <span className="dep-axis-label">X: {info.name} ({info.unit})</span>
                    <span className="dep-axis-label">Y: Marginal LST Impact (°C)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
