import { useState, useEffect, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import { Info } from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE } from '../api';
import { useTheme } from '../ThemeContext';
import LstExplainerModal from '../components/LstExplainerModal';
import ServerWakingNotice from '../components/ServerWakingNotice';
import ValidationBadge from '../components/ValidationBadge';
import MethodologyDrawer from '../components/MethodologyDrawer';
import MapControls from '../components/MapControls';
import MapAttribution from '../components/MapAttribution';
import { FlyToInterpolator } from '@deck.gl/core';
import './MapView.css';

// Map basemap styles — switches with the app theme so the map matches
// the surrounding UI instead of always staying dark.
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

export default function MapView({ city, cityInfo }) {
  const { theme } = useTheme();
  const [gridData, setGridData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLstInfo, setShowLstInfo] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [validation, setValidation] = useState(null);

  useEffect(() => {
    if (!city) return;

    let cancelled = false;

    const fetchData = async () => {
      try {
        const [gridRes, overviewRes, validationRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/grid?city=${city}`),
          fetch(`${API_BASE}/api/v1/overview?city=${city}`),
          fetch(`${API_BASE}/api/v1/validation?city=${city}`).catch(() => null),
        ]);

        if (cancelled) return;

        if (gridRes.ok) {
          const data = await gridRes.json();
          setGridData(data);
        }

        if (overviewRes.ok) {
          const data = await overviewRes.json();
          setOverview(data);
        }

        // Validation is best-effort — a missing/failed call just means
        // this city has no real-satellite comparison yet, not an error.
        if (validationRes && validationRes.ok) {
          const data = await validationRes.json();
          setValidation(data);
        } else {
          setValidation(null);
        }

        if (!gridRes.ok || !overviewRes.ok) {
          setError('Could not load data for this city.');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch data', err);
          setError('Could not reach the server. Is the backend running?');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [city]);

  // Dynamically compute the baseline minimum LST across the city dataset
  // so elevation scaling works consistently regardless of whether the city
  // is cooler (e.g. Bengaluru/Guwahati/Kochi < 35°C) or hot arid (e.g. Phoenix/Delhi).
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

  // 2D vs 3D mode is derived directly from camera pitch
  const is3D = (viewState?.pitch || 0) > 10;

  const layers = [
    new GeoJsonLayer({
      id: 'grid-layer',
      data: gridData,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: is3D,
      wireframe: false,
      getFillColor: d => {
        const tier = d.properties.tier;
        const color = TIER_COLORS[tier] || [128, 128, 128];
        // 175 alpha (68% opacity) gives vivid scientific color saturation
        // while allowing basemap road networks, water bodies and place labels to remain legible
        return [...color, 175];
      },
      getElevation: d => {
        // Robust dynamic elevation: scales from city minimum so cooler cities (< 35°C)
        // produce rich topographical 3D relief rather than flat 0-height terrain
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
    })
  ];

  // Controlled camera view state - 2D is the default visualization mode (pitch: 0)
  const [centerLon, centerLat] = cityInfo?.center || [77.20, 28.61];
  const [viewState, setViewState] = useState({
    longitude: centerLon,
    latitude: centerLat,
    zoom: 10.5,
    pitch: 0,
    bearing: 0
  });

  // Smoothly pan & reset to new city center when selected city changes
  useEffect(() => {
    if (cityInfo?.center) {
      setViewState(prev => ({
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
          onViewStateChange={({ viewState: newViewState }) => setViewState(newViewState)}
          controller={true}
          layers={layers}
          getTooltip={({ object }) => {
            if (!object?.properties) return null;
            const p = object.properties;
            const deltaStr = p.delta_above_mean !== undefined
              ? `${p.delta_above_mean >= 0 ? '+' : ''}${p.delta_above_mean.toFixed(2)}°C vs city mean`
              : (overview?.mean_lst_c ? `${(p.lst_mean - overview.mean_lst_c >= 0 ? '+' : '')}${(p.lst_mean - overview.mean_lst_c).toFixed(2)}°C vs city mean` : '');
            return (
              `Cell: ${p.grid_id}
LST: ${p.lst_mean.toFixed(1)}°C ${deltaStr ? `(${deltaStr})` : ''}
Tier: ${p.tier?.toUpperCase()} (Relative Anomaly)
Vegetation: ${(p.frac_vegetation * 100).toFixed(1)}%`
            );
          }}
        >
          <Map mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK} attributionControl={false} />
        </DeckGL>

        {/* Compact Field Atlas Map Navigation Controls (Top-Left) */}
        <MapControls
          className="map-view-controls"
          viewState={viewState}
          onViewStateChange={setViewState}
        />

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
            <div className="modelled-data-chip" title="Simulated microclimate data, uncalibrated against live observations">
              <span className="modelled-dot"></span>
              <span className="modelled-text">MODELLED DATA</span>
            </div>
            <button
              type="button"
              className="methodology-link-btn"
              onClick={() => setShowMethodology(true)}
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
                  Critical &amp; High stress cells ({overview.hotspot_count}{overview.grid_cells ? ` · ${((overview.hotspot_count / overview.grid_cells) * 100).toFixed(1)}%` : ''})
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
            <div className="horizontal-gradient-bar" role="img" aria-label="Stepped horizontal temperature ramp from cool to critical">
              <div className="gradient-segment" style={{ background: '#2C7BB6' }} title={`Cool: < ${(overview.mean_lst_c - 1.5).toFixed(1)}°C (ΔT < -1.5°C)`} />
              <div className="gradient-segment" style={{ background: '#ABD9E9' }} title={`Normal: ${(overview.mean_lst_c - 1.5).toFixed(1)} to ${overview.mean_lst_c.toFixed(1)}°C (ΔT -1.5 to 0.0°C)`} />
              <div className="gradient-segment" style={{ background: '#FFFFBF' }} title={`Moderate: ${overview.mean_lst_c.toFixed(1)} to ${(overview.mean_lst_c + 1.5).toFixed(1)}°C (ΔT 0.0 to +1.5°C)`} />
              <div className="gradient-segment" style={{ background: '#FDAE61' }} title={`High: ${(overview.mean_lst_c + 1.5).toFixed(1)} to ${(overview.mean_lst_c + 3.0).toFixed(1)}°C (ΔT +1.5 to +3.0°C)`} />
              <div className="gradient-segment" style={{ background: '#D7191C' }} title={`Critical: ≥ ${(overview.mean_lst_c + 3.0).toFixed(1)}°C (ΔT ≥ +3.0°C)`} />
            </div>

            {/* Actual temperature threshold ticks */}
            <div className="legend-ticks-row font-mono">
              <span className="legend-tick tick-left">&lt;{(overview.mean_lst_c - 1.5).toFixed(1)}°</span>
              <span className="legend-tick tick-q1">{(overview.mean_lst_c - 1.5).toFixed(1)}°</span>
              <span className="legend-tick tick-center" title="City Baseline Mean">{overview.mean_lst_c.toFixed(1)}°</span>
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
            onOpenMethodology={() => setShowMethodology(true)}
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
