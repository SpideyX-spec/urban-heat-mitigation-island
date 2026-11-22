import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import {
  Info,
  X,
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Sparkles,
  Layers
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE, fetchCityGrid, fetchCityOverview, fetchCityValidation } from '../api';
import { useTheme } from '../ThemeContext';
import LstExplainerModal from '../components/LstExplainerModal';
import ServerWakingNotice from '../components/ServerWakingNotice';
import ValidationBadge from '../components/ValidationBadge';
import MethodologyDrawer from '../components/MethodologyDrawer';
import MapControls from '../components/MapControls';
import MapAttribution from '../components/MapAttribution';
import { FlyToInterpolator } from '@deck.gl/core';
import './MapView.css';

// Map basemap styles
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Colorblind-friendlier scientific 5-class temperature ramp (ColorBrewer RdYlBu)
const TIER_COLORS = {
  critical: [215, 25, 28],    // #D7191C - critical heat anomaly
  high: [253, 174, 97],       // #FDAE61 - high heat anomaly
  moderate: [255, 255, 191],  // #FFFFBF - moderate heat anomaly
  normal: [171, 217, 233],    // #ABD9E9 - normal / baseline microclimate
  cool: [44, 123, 182]        // #2C7BB6 - cool microclimate sink
};

// Feature metadata for friendly names and units in SHAP inspector
const FEATURE_META = {
  air_temp_max: { name: 'Peak Air Temperature', format: (v) => `${v.toFixed(1)}°C` },
  veg_imperv_ratio: { name: 'Veg / Impervious Ratio', format: (v) => v.toFixed(2) },
  cooling_potential: { name: 'Cooling Capacity Index', format: (v) => v.toFixed(1) },
  ndvi_mean: { name: 'Vegetation Index (NDVI)', format: (v) => v.toFixed(3) },
  frac_impervious: { name: 'Impervious Surface', format: (v) => `${(v * 100).toFixed(1)}%` },
  wind_speed_mean: { name: 'Mean Wind Speed', format: (v) => `${v.toFixed(2)} m/s` },
  road_density: { name: 'Road Surface Density', format: (v) => `${v.toFixed(0)} m/km²` },
  water_area_frac: { name: 'Water Surface Area', format: (v) => `${(v * 100).toFixed(1)}%` },
  sky_view_factor: { name: 'Sky View Factor', format: (v) => v.toFixed(3) },
  thermal_mass_proxy: { name: 'Thermal Mass Index', format: (v) => v.toFixed(1) },
  solar_radiation: { name: 'Net Solar Radiation', format: (v) => `${v.toFixed(1)} W/m²` },
  building_density: { name: 'Building Footprint', format: (v) => `${v.toFixed(1)}` },
  frac_bare_soil: { name: 'Bare Soil Fraction', format: (v) => `${(v * 100).toFixed(1)}%` },
  frac_water: { name: 'Water Fraction', format: (v) => `${(v * 100).toFixed(1)}%` },
  ndbi_mean: { name: 'Built-up Index (NDBI)', format: (v) => v.toFixed(3) },
  park_area_frac: { name: 'Park / Green Space', format: (v) => `${(v * 100).toFixed(1)}%` },
  frac_vegetation: { name: 'Total Vegetation', format: (v) => `${(v * 100).toFixed(1)}%` },
  dist_to_water: { name: 'Distance to Water', format: (v) => `${Math.round(v)}m` },
  building_height_mean: { name: 'Building Height', format: (v) => `${v.toFixed(1)}m` },
  green_deficit: { name: 'Vegetation Deficit', format: (v) => v.toFixed(3) },
  tree_canopy_frac: { name: 'Tree Canopy Density', format: (v) => `${(v * 100).toFixed(1)}%` },
  ndvi_std: { name: 'Vegetation Variance', format: (v) => v.toFixed(3) }
};

function formatFeatureName(key) {
  if (FEATURE_META[key]) return FEATURE_META[key].name;
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFeatureValue(key, val) {
  if (typeof val !== 'number') return '—';
  if (FEATURE_META[key]?.format) return FEATURE_META[key].format(val);
  return val.toFixed(2);
}

export default function MapView({ city, cityInfo, onOpenMethodology }) {
  const { theme } = useTheme();
  const [gridData, setGridData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLstInfo, setShowLstInfo] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [validation, setValidation] = useState(null);

  // Interactive cell selection & local SHAP inspection state
  const [selectedCell, setSelectedCell] = useState(null);
  const [shapData, setShapData] = useState(null);
  const [shapLoading, setShapLoading] = useState(false);
  const [shapError, setShapError] = useState(null);
  const shapCacheRef = useRef({});

  useEffect(() => {
    if (!city) return;

    let cancelled = false;
    const controller = new AbortController();

    // Reset cell selection & state on city change
    setSelectedCell(null);
    setShapData(null);
    setShapError(null);
    setLoading(true);
    setError(null);

    // 1. Essential Data (Grid GeoJSON & Summary Overview)
    Promise.all([
      fetchCityGrid(city, controller.signal),
      fetchCityOverview(city, controller.signal)
    ])
      .then(([grid, overviewData]) => {
        if (cancelled) return;
        setGridData(grid);
        setOverview(overviewData);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to fetch essential map data', err);
        setError('Could not reach the server. Is the backend running?');
        setLoading(false);
      });

    // 2. Non-blocking Optional Satellite Validation
    fetchCityValidation(city, controller.signal)
      .then((valData) => {
        if (!cancelled) setValidation(valData);
      })
      .catch(() => {
        if (!cancelled) setValidation(null);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [city]);

  // Handle cell click selection and fetch local SHAP explanation
  const handleSelectCell = useCallback(
    (cellProperties) => {
      if (!cellProperties?.grid_id) return;

      setSelectedCell(cellProperties);
      setShapError(null);

      const cacheKey = `${city}:${cellProperties.grid_id}`;
      if (shapCacheRef.current[cacheKey]) {
        setShapData(shapCacheRef.current[cacheKey]);
        setShapLoading(false);
        return;
      }

      setShapLoading(true);
      setShapData(null);

      fetch(`${API_BASE}/api/v1/drivers?city=${city}&grid_id=${cellProperties.grid_id}`)
        .then((res) => {
          if (!res.ok) throw new Error('SHAP request failed');
          return res.json();
        })
        .then((data) => {
          const explanation = data?.cell_explanation || null;
          shapCacheRef.current[cacheKey] = explanation;
          setShapData(explanation);
        })
        .catch((err) => {
          console.warn('Local SHAP explanation unavailable', err);
          setShapError('Local driver breakdown unavailable');
        })
        .finally(() => {
          setShapLoading(false);
        });
    },
    [city]
  );

  // Close inspector on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedCell(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Dynamically compute baseline minimum LST across the city dataset for elevation scaling
  const minLst = useMemo(() => {
    if (overview?.min_lst_c !== undefined && overview?.min_lst_c !== null) {
      return overview.min_lst_c;
    }
    if (gridData?.features && gridData.features.length > 0) {
      let min = Infinity;
      for (let i = 0; i < gridData.features.length; i++) {
        const val = gridData.features[i].properties?.lst_mean;
        if (typeof val === 'number' && val < min) min = val;
      }
      if (min < Infinity) return min;
    }
    return 20;
  }, [overview, gridData]);

  // Controlled camera view state
  const [centerLon, centerLat] = cityInfo?.center || [77.20, 28.61];
  const [viewState, setViewState] = useState({
    longitude: centerLon,
    latitude: centerLat,
    zoom: 10.5,
    pitch: 0,
    bearing: 0
  });

  // 2D vs 3D mode is derived directly from camera pitch
  const is3D = (viewState?.pitch || 0) > 10;

  // Selected cell feature for the highlight outline layer
  const selectedFeature = useMemo(() => {
    if (!selectedCell || !gridData?.features) return null;
    return (
      gridData.features.find((f) => f.properties?.grid_id === selectedCell.grid_id) || null
    );
  }, [selectedCell, gridData]);

  // DeckGL Layers: Main Heatmap Grid + Highlighted Selected Cell Outline
  const layers = useMemo(() => {
    const mainGridLayer = new GeoJsonLayer({
      id: 'grid-layer',
      data: gridData,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: is3D,
      wireframe: false,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 45],
      getFillColor: (d) => {
        const tier = d.properties.tier;
        const color = TIER_COLORS[tier] || [128, 128, 128];
        return [...color, 175];
      },
      getElevation: (d) => {
        const lst = d.properties?.lst_mean ?? minLst;
        const delta = Math.max(0, lst - minLst);
        return 40 + delta * 110;
      },
      transitions: {
        getFillColor: 400,
        getElevation: 600
      },
      updateTriggers: {
        extruded: [is3D],
        getElevation: [minLst]
      }
    });

    const selectedOutlineLayer = selectedFeature
      ? new GeoJsonLayer({
          id: 'selected-cell-outline',
          data: {
            type: 'FeatureCollection',
            features: [selectedFeature]
          },
          pickable: false,
          stroked: true,
          filled: false,
          extruded: is3D,
          wireframe: false,
          lineWidthMinPixels: 2.5,
          getLineColor: [255, 255, 255, 255],
          getElevation: (d) => {
            const lst = d.properties?.lst_mean ?? minLst;
            const delta = Math.max(0, lst - minLst);
            return 40 + delta * 110 + 3;
          },
          updateTriggers: {
            extruded: [is3D],
            getElevation: [minLst]
          }
        })
      : null;

    return selectedOutlineLayer ? [mainGridLayer, selectedOutlineLayer] : [mainGridLayer];
  }, [gridData, is3D, minLst, selectedFeature]);

  // Smoothly pan & reset to new city center when selected city changes
  useEffect(() => {
    if (cityInfo?.center) {
      setViewState((prev) => ({
        ...prev,
        longitude: cityInfo.center[0],
        latitude: cityInfo.center[1],
        zoom: 10.5,
        bearing: 0,
        pitch: prev.pitch > 10 ? 45 : 0,
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator()
      }));
    }
  }, [city, cityInfo]);

  // Top 3 contributing features from SHAP analysis
  const topDrivers = useMemo(() => {
    if (!shapData?.shap_values || shapData.shap_values.length === 0) return [];
    return [...shapData.shap_values]
      .sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap))
      .slice(0, 3);
  }, [shapData]);

  // Delta calculation for selected cell
  const selectedDelta = useMemo(() => {
    if (!selectedCell) return null;
    if (selectedCell.delta_above_mean !== undefined) return selectedCell.delta_above_mean;
    if (overview?.mean_lst_c && selectedCell.lst_mean) {
      return selectedCell.lst_mean - overview.mean_lst_c;
    }
    return 0;
  }, [selectedCell, overview]);

  // Memoized handlers for DeckGL to avoid unnecessary layer/controller recreation
  const handleViewStateChange = useCallback(({ viewState: newViewState }) => {
    setViewState(newViewState);
  }, []);

  const handleMapClick = useCallback(
    (info) => {
      if (info?.object?.properties) {
        handleSelectCell(info.object.properties);
      }
    },
    [handleSelectCell]
  );

  const getTooltip = useCallback(
    ({ object }) => {
      if (!object?.properties) return null;
      const p = object.properties;
      const delta =
        p.delta_above_mean !== undefined
          ? p.delta_above_mean
          : overview?.mean_lst_c
          ? p.lst_mean - overview.mean_lst_c
          : 0;
      const deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}°C vs city mean`;
      const tierStr = p.tier?.toUpperCase() || 'NORMAL';

      return `Cell: ${p.grid_id}
LST: ${p.lst_mean.toFixed(1)}°C (${deltaStr})
Tier: ${tierStr}
Click to pin local SHAP drivers`;
    },
    [overview]
  );

  return (
    <div className="map-view-container animate-fade-in">
      <div className="map-wrapper">
        {loading && (
          <div className="loading-overlay">
            <ServerWakingNotice compact />
          </div>
        )}

        {!loading && error && (
          <div className="loading-overlay">
            <p>{error}</p>
          </div>
        )}

        <DeckGL
          viewState={viewState}
          onViewStateChange={handleViewStateChange}
          controller={true}
          layers={layers}
          onClick={handleMapClick}
          getTooltip={getTooltip}
        >
          <Map
            mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
            attributionControl={false}
          />
        </DeckGL>

        {/* Compact Field Atlas Map Navigation Controls (Top-Left) */}
        <MapControls
          className="map-view-controls"
          viewState={viewState}
          onViewStateChange={setViewState}
        />

        {/* Pinned Cell Inspection Panel (Docked at Left below map controls) */}
        {selectedCell && (
          <aside
            className="cell-inspector-panel glass-panel animate-fade-in"
            role="region"
            aria-label={`Inspection details for cell ${selectedCell.grid_id}`}
          >
            {/* Header with Cell ID, Tier Badge & Close Button */}
            <div className="inspector-header">
              <div className="inspector-title-line">
                <MapPin size={13} className="inspector-icon" />
                <span className="inspector-cell-id font-mono">{selectedCell.grid_id}</span>
                <span
                  className={`inspector-tier-badge tier-${selectedCell.tier} font-mono`}
                  title={`Relative classification: ${selectedCell.tier}`}
                >
                  {selectedCell.tier?.toUpperCase()}
                </span>
              </div>
              <button
                type="button"
                className="inspector-close-btn"
                onClick={() => setSelectedCell(null)}
                title="Dismiss panel (Esc)"
                aria-label="Dismiss panel"
              >
                <X size={13} />
              </button>
            </div>

            {/* Core Thermal Measurement & Difference from Mean */}
            <div className="inspector-temp-block">
              <div className="inspector-temp-row">
                <span className="inspector-temp-val font-mono">
                  {selectedCell.lst_mean.toFixed(1)}
                  <span className="inspector-unit">°C</span>
                </span>
                <span
                  className={`inspector-delta-tag font-mono ${
                    selectedDelta >= 0 ? 'delta-positive' : 'delta-negative'
                  }`}
                  title="Temperature anomaly relative to citywide baseline mean"
                >
                  {selectedDelta >= 0 ? '+' : ''}
                  {selectedDelta.toFixed(2)}°C vs mean
                </span>
              </div>
              <span className="inspector-temp-sub">
                500m Surface Skin Temperature · Baseline {overview?.mean_lst_c?.toFixed(1)}°C
              </span>
            </div>

            {/* Biophysical Attributes Matrix */}
            <div className="inspector-attributes-grid">
              <div className="attr-cell">
                <span className="attr-label">Vegetation Cover</span>
                <span className="attr-value font-mono">
                  {(selectedCell.frac_vegetation * 100).toFixed(1)}%
                </span>
              </div>

              <div className="attr-cell">
                <span className="attr-label">Impervious Surface</span>
                <span className="attr-value font-mono">
                  {(selectedCell.frac_impervious * 100).toFixed(1)}%
                </span>
              </div>

              <div className="attr-cell">
                <span className="attr-label">Vegetation (NDVI)</span>
                <span className="attr-value font-mono">
                  {selectedCell.ndvi_mean !== undefined ? selectedCell.ndvi_mean.toFixed(3) : '—'}
                </span>
              </div>

              <div className="attr-cell">
                <span className="attr-label">Built-up (NDBI)</span>
                <span className="attr-value font-mono">
                  {selectedCell.ndbi_mean !== undefined ? selectedCell.ndbi_mean.toFixed(3) : '—'}
                </span>
              </div>
            </div>

            {/* Top 3 Local SHAP Drivers Section */}
            <div className="inspector-drivers-section">
              <div className="drivers-header">
                <Sparkles size={11} className="drivers-icon" />
                <span className="drivers-title">Local Heat Drivers (SHAP)</span>
                <span className="drivers-sub-tag font-mono">°C Impact</span>
              </div>

              {shapLoading && (
                <div className="drivers-loading">
                  <RefreshCw size={12} className="spin-icon" />
                  <span>Calculating local feature contributions...</span>
                </div>
              )}

              {!shapLoading && shapError && (
                <div className="drivers-empty">{shapError}</div>
              )}

              {!shapLoading && !shapError && topDrivers.length > 0 && (
                <div className="drivers-list">
                  {topDrivers.map((d) => {
                    const isWarming = d.shap > 0;
                    const formattedValue = formatFeatureValue(d.feature, d.value);
                    const featureName = formatFeatureName(d.feature);

                    return (
                      <div key={d.feature} className="driver-row">
                        <div className="driver-info">
                          <span className="driver-name" title={featureName}>
                            {featureName}
                          </span>
                          <span className="driver-raw font-mono">{formattedValue}</span>
                        </div>

                        <div
                          className={`driver-shap-badge font-mono ${
                            isWarming ? 'driver-warming' : 'driver-cooling'
                          }`}
                          title={`Marginal LST impact: ${d.shap > 0 ? '+' : ''}${d.shap.toFixed(
                            3
                          )}°C`}
                        >
                          {isWarming ? (
                            <ArrowUpRight size={11} className="direction-icon" />
                          ) : (
                            <ArrowDownRight size={11} className="direction-icon" />
                          )}
                          <span>
                            {isWarming ? '+' : ''}
                            {d.shap.toFixed(2)}°C
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {!shapLoading && !shapError && topDrivers.length === 0 && (
                <div className="drivers-empty">
                  SHAP feature attribution data is not available for this cell.
                </div>
              )}
            </div>

            <div className="inspector-footer-hint font-mono">
              Press <strong>ESC</strong> or click another cell to update
            </div>
          </aside>
        )}

        {/* Bottom Left: Map Provenance Watermark and Required Map Attributions */}
        <div className="map-footer-left">
          <div className="map-watermark-provenance">
            <span className="watermark-dot"></span>
            <span>SYNTHETIC UHI SIMULATION · 500M ANALYSIS GRID</span>
          </div>
          <MapAttribution className="map-view-attribution" />
        </div>
      </div>

      {/* KPI & Legend Instrument Overlay */}
      {overview && (
        <div className="kpi-overlay glass-panel">
          {/* Subtle but visible MODELLED DATA provenance bar */}
          <div className="modelled-data-bar">
            <div
              className="modelled-data-chip"
              title="Simulated microclimate data, uncalibrated against live observations"
            >
              <span className="modelled-dot"></span>
              <span className="modelled-text">MODELLED DATA</span>
            </div>
            <button
              type="button"
              className="methodology-link-btn"
              onClick={onOpenMethodology || (() => setShowMethodology(true))}
              title="Inspect data provenance, XGBoost model, and Landsat comparison"
            >
              Methodology &amp; Limits ↗
            </button>
          </div>

          <div className="kpi-header">
            <div className="kpi-title-block">
              <h3>
                {overview.city}
                <button
                  className="info-trigger"
                  onClick={() => setShowLstInfo(true)}
                  aria-label="What does LST mean?"
                >
                  <Info size={12} />
                </button>
              </h3>
              <span className="analysis-subtext font-mono">
                {overview.analysis_period} · {overview.grid_cells?.toLocaleString()} CELLS (500M)
              </span>
            </div>
          </div>

          {/* Primary Hero Metric: Urban Heat Island Intensity */}
          <div className="kpi-hero-card">
            <div className="kpi-hero-header">
              <span className="kpi-hero-tag">Key Indicator</span>
              <span className="kpi-hero-scope">Urban Heat Island (UHI) Intensity</span>
            </div>
            <div className="kpi-hero-value-row">
              <span className="kpi-hero-sign font-mono">+</span>
              <span className="kpi-hero-val font-mono">{overview.uhi_intensity_c.toFixed(1)}</span>
              <span className="kpi-hero-unit font-mono">°C</span>
            </div>
            <p className="kpi-hero-def">
              Peak localized thermal elevation above citywide baseline ({overview.mean_lst_c.toFixed(1)}°C mean).
            </p>
          </div>

          {/* Compact Structured Secondary Metrics */}
          <div className="kpi-secondary-list">
            <div className="kpi-secondary-row">
              <div className="kpi-metric-info">
                <span className="kpi-metric-name">Baseline Mean LST</span>
                <span className="kpi-metric-def">Citywide spatial average skin temperature</span>
              </div>
              <div className="kpi-metric-value font-mono">
                {overview.mean_lst_c.toFixed(1)} <span className="kpi-unit">°C</span>
              </div>
            </div>

            <div className="kpi-secondary-row">
              <div className="kpi-metric-info">
                <span className="kpi-metric-name">Peak Surface LST</span>
                <span className="kpi-metric-def">Highest single-cell surface hotspot</span>
              </div>
              <div className="kpi-metric-value font-mono danger">
                {overview.max_lst_c.toFixed(1)} <span className="kpi-unit">°C</span>
              </div>
            </div>

            <div className="kpi-secondary-row">
              <div className="kpi-metric-info">
                <span className="kpi-metric-name">Severe Hotspot Footprint</span>
                <span className="kpi-metric-def">
                  Critical &amp; High stress cells ({overview.hotspot_count}
                  {overview.grid_cells
                    ? ` · ${((overview.hotspot_count / overview.grid_cells) * 100).toFixed(1)}%`
                    : ''}
                  )
                </span>
              </div>
              <div className="kpi-metric-value font-mono warning">
                {overview.hotspot_area_km2.toFixed(1)} <span className="kpi-unit">km²</span>
              </div>
            </div>
          </div>

          {/* Compact Horizontal Temperature Gradient Legend */}
          <div className="heatmap-legend">
            <div className="legend-header">
              <div className="legend-title-row">
                <span className="legend-title">Thermal Anomaly Ramp</span>
                <span className="legend-unit-tag font-mono">Unit: °C</span>
              </div>
              <p className="legend-context">
                Relative classification calibrated to city baseline mean ({overview.mean_lst_c.toFixed(1)}°C).
              </p>
            </div>

            {/* Continuous 5-segment horizontal temperature gradient bar */}
            <div
              className="horizontal-gradient-bar"
              role="img"
              aria-label="Stepped horizontal temperature ramp from cool to critical"
            >
              <div
                className="gradient-segment"
                style={{ background: '#2C7BB6' }}
                title={`Cool: < ${(overview.mean_lst_c - 1.5).toFixed(1)}°C (ΔT < -1.5°C)`}
              />
              <div
                className="gradient-segment"
                style={{ background: '#ABD9E9' }}
                title={`Normal: ${(overview.mean_lst_c - 1.5).toFixed(1)} to ${overview.mean_lst_c.toFixed(1)}°C (ΔT -1.5 to 0.0°C)`}
              />
              <div
                className="gradient-segment"
                style={{ background: '#FFFFBF' }}
                title={`Moderate: ${overview.mean_lst_c.toFixed(1)} to ${(overview.mean_lst_c + 1.5).toFixed(1)}°C (ΔT 0.0 to +1.5°C)`}
              />
              <div
                className="gradient-segment"
                style={{ background: '#FDAE61' }}
                title={`High: ${(overview.mean_lst_c + 1.5).toFixed(1)} to ${(overview.mean_lst_c + 3.0).toFixed(1)}°C (ΔT +1.5 to +3.0°C)`}
              />
              <div
                className="gradient-segment"
                style={{ background: '#D7191C' }}
                title={`Critical: ≥ ${(overview.mean_lst_c + 3.0).toFixed(1)}°C (ΔT ≥ +3.0°C)`}
              />
            </div>

            {/* Actual temperature threshold ticks */}
            <div className="legend-ticks-row font-mono">
              <span className="legend-tick tick-left">&lt;{(overview.mean_lst_c - 1.5).toFixed(1)}°</span>
              <span className="legend-tick tick-q1">{(overview.mean_lst_c - 1.5).toFixed(1)}°</span>
              <span className="legend-tick tick-center" title="City Baseline Mean">
                {overview.mean_lst_c.toFixed(1)}°
              </span>
              <span className="legend-tick tick-q3">{(overview.mean_lst_c + 1.5).toFixed(1)}°</span>
              <span className="legend-tick tick-right">≥{(overview.mean_lst_c + 3.0).toFixed(1)}°</span>
            </div>

            {/* Multi-channel severity tier cards */}
            <div className="legend-tier-grid">
              <div className="tier-cell">
                <div className="tier-pill-head">
                  <span className="tier-swatch" style={{ background: '#2C7BB6' }}></span>
                  <span className="tier-name">Cool</span>
                </div>
                <span className="tier-delta font-mono">&lt;-1.5°</span>
                <span className="tier-desc">Sink</span>
              </div>
              <div className="tier-cell">
                <div className="tier-pill-head">
                  <span className="tier-swatch" style={{ background: '#ABD9E9' }}></span>
                  <span className="tier-name">Normal</span>
                </div>
                <span className="tier-delta font-mono">±0.0°</span>
                <span className="tier-desc">Baseline</span>
              </div>
              <div className="tier-cell">
                <div className="tier-pill-head">
                  <span className="tier-swatch" style={{ background: '#FFFFBF' }}></span>
                  <span className="tier-name">Mod.</span>
                </div>
                <span className="tier-delta font-mono">+1.5°</span>
                <span className="tier-desc">Elevated</span>
              </div>
              <div className="tier-cell">
                <div className="tier-pill-head">
                  <span className="tier-swatch" style={{ background: '#FDAE61' }}></span>
                  <span className="tier-name">High</span>
                </div>
                <span className="tier-delta font-mono">+3.0°</span>
                <span className="tier-desc">Stress</span>
              </div>
              <div className="tier-cell">
                <div className="tier-pill-head">
                  <span className="tier-swatch" style={{ background: '#D7191C' }}></span>
                  <span className="tier-name">Crit.</span>
                </div>
                <span className="tier-delta font-mono">≥+3.0°</span>
                <span className="tier-desc">Severe</span>
              </div>
            </div>
          </div>

          <ValidationBadge
            validation={validation}
            onOpenMethodology={onOpenMethodology || (() => setShowMethodology(true))}
          />
        </div>
      )}

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
      <MethodologyDrawer
        isOpen={showMethodology}
        onClose={() => setShowMethodology(false)}
        city={city}
        cityInfo={cityInfo}
        validation={validation}
      />
    </div>
  );
}
