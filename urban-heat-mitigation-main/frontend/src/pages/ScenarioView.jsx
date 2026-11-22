import { useState, useEffect, useCallback, useMemo } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import Map from 'react-map-gl/maplibre';
import {
  Info,
  Trees,
  Building2,
  Leaf,
  Droplets,
  SunMedium,
  Play,
  RotateCcw,
  Target,
  RefreshCw,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Sliders,
  Sparkles,
  X
} from 'lucide-react';
import { FlyToInterpolator } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { API_BASE, fetchCityGrid, fetchCityPresets } from '../api';
import { useTheme } from '../ThemeContext';
import { TIER_SYMBOLS } from './MapView';
import LstExplainerModal from '../components/LstExplainerModal';
import MapControls from '../components/MapControls';
import MapAttribution from '../components/MapAttribution';
import './ScenarioView.css';

const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

// Detailed intervention definitions reflecting the underlying ML feature modification parameters
// defined in pipeline/config.py (INTERVENTIONS dictionary)
const INTERVENTIONS_CONFIG = [
  {
    id: 'tree_cover',
    label: 'Tree Canopy Cover',
    shortLabel: 'Tree Cover',
    icon: Trees,
    unit: 'canopy %',
    costPerKm2: 2.5,
    tagline: 'Urban street trees & canopy density',
    description: 'Increases vegetated fraction and canopy density while displacing impervious surface area in targeted cells.',
    modelFeatures: 'frac_vegetation (+30%), ndvi_mean (+0.15), tree_canopy_frac (+30%), frac_impervious (-15%)',
    getPhysicalShift: (x) => {
      if (x <= 0) return '0% — Baseline canopy';
      const veg = (30 * x).toFixed(1);
      const imp = (15 * x).toFixed(1);
      const ndvi = (0.15 * x).toFixed(3);
      return `+${veg}% Canopy/Veg, -${imp}% Impervious, +${ndvi} NDVI`;
    },
    benchmarks: [
      { pct: '0%', title: 'Baseline', detail: 'Existing urban tree canopy; 0% parameter modification.' },
      { pct: '50%', title: 'Moderate (+15% Canopy)', detail: '+15% tree canopy & vegetation fraction, -7.5% impervious surface, +0.075 NDVI.' },
      { pct: '100%', title: 'Maximum (+30% Canopy)', detail: '+30% canopy density, +30% vegetation cover, -15% impervious surface, +0.150 NDVI.' }
    ]
  },
  {
    id: 'cool_roofs',
    label: 'Cool Roof Retrofits',
    shortLabel: 'Cool Roofs',
    icon: Building2,
    unit: 'reflectance %',
    costPerKm2: 1.5,
    tagline: 'High-albedo reflective roof coatings',
    description: 'Applies reflective elastomeric coatings to roofs, reducing net absorbed solar radiation and lowering built-up index.',
    modelFeatures: 'solar_radiation (-15%), ndbi_mean (-0.12)',
    getPhysicalShift: (x) => {
      if (x <= 0) return '0% — Baseline roof albedo';
      const sol = (15 * x).toFixed(1);
      const ndbi = (0.12 * x).toFixed(3);
      return `-${sol}% Solar Absorption, -${ndbi} Built-up Index (NDBI)`;
    },
    benchmarks: [
      { pct: '0%', title: 'Baseline', detail: 'Conventional low-reflectance commercial and residential rooftops.' },
      { pct: '50%', title: 'Moderate (-7.5% Solar)', detail: '-7.5% net surface solar absorption, -0.060 built-up index (NDBI).' },
      { pct: '100%', title: 'Maximum (-15% Solar)', detail: '-15% net surface solar absorption, -0.120 built-up index (NDBI).' }
    ]
  },
  {
    id: 'green_roofs',
    label: 'Green Roof Systems',
    shortLabel: 'Green Roofs',
    icon: Leaf,
    unit: 'rooftop veg %',
    costPerKm2: 4.0,
    tagline: 'Extensive vegetative roof installations',
    description: 'Installs living plants on flat rooftops to promote evapotranspiration and replace impervious surfaces.',
    modelFeatures: 'frac_vegetation (+15%), ndbi_mean (-0.08), frac_impervious (-10%)',
    getPhysicalShift: (x) => {
      if (x <= 0) return '0% — Baseline roof cover';
      const veg = (15 * x).toFixed(1);
      const imp = (10 * x).toFixed(1);
      const ndbi = (0.08 * x).toFixed(3);
      return `+${veg}% Rooftop Veg, -${imp}% Impervious, -${ndbi} NDBI`;
    },
    benchmarks: [
      { pct: '0%', title: 'Baseline', detail: 'Standard non-vegetated roof structures.' },
      { pct: '50%', title: 'Moderate (+7.5% Veg)', detail: '+7.5% rooftop vegetation, -5% impervious surface, -0.040 NDBI.' },
      { pct: '100%', title: 'Maximum (+15% Veg)', detail: '+15% rooftop vegetation cover, -10% impervious surface, -0.080 NDBI.' }
    ]
  },
  {
    id: 'water_bodies',
    label: 'Water Bodies & Retention',
    shortLabel: 'Water Bodies',
    icon: Droplets,
    unit: 'water area %',
    costPerKm2: 6.0,
    tagline: 'Urban wetlands, retention ponds & bioswales',
    description: 'Introduces localized retention basins, swales, or open water, reducing cell distance to water and expanding water area.',
    modelFeatures: 'water_area_frac (+5%), dist_to_water (-200m clamped to 50m)',
    getPhysicalShift: (x) => {
      if (x <= 0) return '0% — Baseline water distribution';
      const area = (5 * x).toFixed(1);
      const dist = Math.round(200 * x);
      return `+${area}% Water Area, -${dist}m Distance to Nearest Water`;
    },
    benchmarks: [
      { pct: '0%', title: 'Baseline', detail: 'Existing natural water bodies, lakes, and drainage channels.' },
      { pct: '50%', title: 'Moderate (+2.5% Water)', detail: '+2.5% open water surface area fraction, -100m to nearest water feature.' },
      { pct: '100%', title: 'Maximum (+5% Water)', detail: '+5% open water surface area fraction, -200m to nearest water feature (min 50m).' }
    ]
  },
  {
    id: 'albedo_improvement',
    label: 'Pavement Albedo Upgrades',
    shortLabel: 'Pavement Albedo',
    icon: SunMedium,
    unit: 'pavement albedo %',
    costPerKm2: 1.0,
    tagline: 'Permeable & reflective street pavements',
    description: 'Upgrades roads, parking lots, and walkways with lighter reflective aggregates and permeable materials.',
    modelFeatures: 'solar_radiation (-10%), ndbi_mean (-0.06)',
    getPhysicalShift: (x) => {
      if (x <= 0) return '0% — Baseline pavement albedo';
      const sol = (10 * x).toFixed(1);
      const ndbi = (0.06 * x).toFixed(3);
      return `-${sol}% Solar Absorption, -${ndbi} Built-up Index (NDBI)`;
    },
    benchmarks: [
      { pct: '0%', title: 'Baseline', detail: 'Standard dark weathered asphalt and dense concrete pavements.' },
      { pct: '50%', title: 'Moderate (-5% Solar)', detail: '-5% net surface solar absorption, -0.030 built-up index (NDBI).' },
      { pct: '100%', title: 'Maximum (-10% Solar)', detail: '-10% net surface solar absorption, -0.060 built-up index (NDBI).' }
    ]
  }
];

const EMPTY_INTENSITIES = {
  tree_cover: 0,
  cool_roofs: 0,
  green_roofs: 0,
  water_bodies: 0,
  albedo_improvement: 0
};

// Colorblind-friendlier scientific 5-class temperature ramp (ColorBrewer RdYlBu)
const TIER_COLORS = {
  critical: [215, 25, 28],    // #D7191C
  high: [253, 174, 97],       // #FDAE61
  moderate: [255, 255, 191],  // #FFFFBF
  normal: [171, 217, 233],    // #ABD9E9
  cool: [44, 123, 182]        // #2C7BB6
};

export default function ScenarioView({ city, cityInfo }) {
  const { theme } = useTheme();
  const [showLstInfo, setShowLstInfo] = useState(false);
  const [gridData, setGridData] = useState(null);
  const [presets, setPresets] = useState([]);
  const [intensities, setIntensities] = useState(EMPTY_INTENSITIES);
  const [targetScope, setTargetScope] = useState('hotspots'); // 'hotspots' | 'all'
  const [simulationResult, setSimulationResult] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [activePresetId, setActivePresetId] = useState(null);
  const [statusMessage, setStatusMessage] = useState(null);
  const [expandedExplanation, setExpandedExplanation] = useState(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [simDurationMs, setSimDurationMs] = useState(null);

  // Responsive state for mobile layout & comparison
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 900
  );
  const [mobileCompareMode, setMobileCompareMode] = useState('after'); // 'before' | 'after'
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 900);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load grid geometry and presets when city changes (shared cached fetch)
  useEffect(() => {
    if (!city) return;

    let cancelled = false;
    const controller = new AbortController();

    // Reset simulation state on city change
    setSimulationResult(null);
    setIntensities(EMPTY_INTENSITIES);
    setActivePresetId(null);
    setStatusMessage(null);

    Promise.all([
      fetchCityGrid(city, controller.signal),
      fetchCityPresets(city, controller.signal)
    ])
      .then(([grid, presetsData]) => {
        if (cancelled) return;
        setGridData(grid);
        setPresets(presetsData || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load scenario data', err);
        setStatusMessage({ type: 'error', text: 'Could not load grid geometry for this city.' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [city]);

  // Compute cell counts and areas
  const totalCellsCount = gridData?.features?.length || 0;
  const totalAreaKm2 = (totalCellsCount * 0.25).toFixed(1);

  const hotspotsCount = useMemo(() => {
    if (!gridData?.features) return 0;
    return gridData.features.filter(
      (f) => f.properties?.tier === 'critical' || f.properties?.tier === 'high'
    ).length;
  }, [gridData]);

  const hotspotsAreaKm2 = (hotspotsCount * 0.25).toFixed(1);

  const activeTargetCount = targetScope === 'all' ? totalCellsCount : hotspotsCount;
  const activeTargetAreaKm2 = targetScope === 'all' ? totalAreaKm2 : hotspotsAreaKm2;

  const handleSliderChange = (id, value) => {
    setIntensities((prev) => ({ ...prev, [id]: parseFloat(value) }));
    setActivePresetId(null);
  };

  const handleResetSliders = () => {
    setIntensities(EMPTY_INTENSITIES);
    setActivePresetId(null);
    setSimulationResult(null);
    setStatusMessage({ type: 'info', text: 'Interventions reset to 0% (baseline conditions).' });
  };

  // Shared simulation runner connecting to backend simulate_scenario
  const runInterventions = useCallback(
    async (interventionDict, chosenTargetScope = targetScope) => {
      const activeInterventions = Object.entries(interventionDict)
        .filter(([, intensity]) => intensity > 0)
        .map(([type, intensity]) => ({ type, intensity }));

      if (activeInterventions.length === 0) {
        setSimulationResult(null);
        setStatusMessage({
          type: 'info',
          text: 'Adjust at least one slider above 0%, or choose a preset, before running a simulation.'
        });
        return;
      }

      setIsSimulating(true);
      setStatusMessage(null);
      const startTime = performance.now();

      try {
        const payload = {
          interventions: activeInterventions,
          target_cells: chosenTargetScope === 'all' ? ['all'] : null
        };

        const res = await fetch(`${API_BASE}/api/v1/scenarios/simulate?city=${city}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const elapsed = Math.round(performance.now() - startTime);
        setSimDurationMs(elapsed);

        if (res.ok) {
          const data = await res.json();
          setSimulationResult(data);
          setStatusMessage({
            type: 'success',
            text: `Simulation complete in ${elapsed}ms: ${data.summary.cells_modified} cells re-evaluated.`
          });
          if (isMobile) {
            setMobileCompareMode('after');
            setIsBottomSheetOpen(false);
          }
        } else {
          const errBody = await res.json().catch(() => ({}));
          setStatusMessage({
            type: 'error',
            text: errBody.detail || 'Simulation request failed. Please check inputs.'
          });
        }
      } catch (err) {
        console.error(err);
        setStatusMessage({
          type: 'error',
          text: 'Could not connect to simulation service. Please verify the backend API is active.'
        });
      } finally {
        setIsSimulating(false);
      }
    },
    [city, targetScope]
  );

  const runSimulation = () => {
    setActivePresetId(null);
    runInterventions(intensities, targetScope);
  };

  const loadPreset = (preset) => {
    const newIntensities = { ...EMPTY_INTENSITIES };
    Object.entries(preset.interventions || {}).forEach(([k, v]) => {
      if (k in newIntensities) newIntensities[k] = v;
    });
    setIntensities(newIntensities);
    setActivePresetId(preset.scenario_id);

    if (Object.keys(preset.interventions || {}).length === 0) {
      setSimulationResult(null);
      setStatusMessage({
        type: 'info',
        text: 'Baseline preset selected: No interventions applied (current unmodified city).'
      });
      return;
    }

    // Default presets run on hotspots; execute through live simulator
    runInterventions(preset.interventions, targetScope);
  };

  // Map of per-cell simulation results for instant lookup in tooltip & layer
  const cellResultsMap = useMemo(() => {
    if (!simulationResult?.cell_results) return {};
    const map = {};
    for (let i = 0; i < simulationResult.cell_results.length; i++) {
      const r = simulationResult.cell_results[i];
      map[r.grid_id] = r;
    }
    return map;
  }, [simulationResult]);

  // Compute city baseline minimum for 3D elevation scaling
  const minLst = useMemo(() => {
    if (gridData?.features && gridData.features.length > 0) {
      let min = Infinity;
      for (let i = 0; i < gridData.features.length; i++) {
        const val = gridData.features[i].properties?.lst_mean;
        if (typeof val === 'number' && val < min) min = val;
      }
      if (min < Infinity) return min;
    }
    return 20;
  }, [gridData]);

  // Controlled camera view state
  const [centerLon, centerLat] = cityInfo?.center || [77.20, 28.61];
  const [viewState, setViewState] = useState({
    longitude: centerLon,
    latitude: centerLat,
    zoom: 10,
    pitch: 0,
    bearing: 0
  });

  const is3D = (viewState?.pitch || 0) > 10;

  // DeckGL Layers: Memoized to prevent recreation during slider drags.
  // Re-uses gridData directly without cloning or copying 10k GeoJSON feature objects.
  const beforeLayer = useMemo(() => {
    if (!gridData) return null;
    return new GeoJsonLayer({
      id: 'before-layer',
      data: gridData,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: is3D,
      wireframe: false,
      getFillColor: (d) => {
        const color = TIER_COLORS[d.properties.tier] || [128, 128, 128];
        return [...color, 175];
      },
      getElevation: (d) => {
        const lst = d.properties?.lst_mean ?? minLst;
        const delta = Math.max(0, lst - minLst);
        return 40 + delta * 110;
      },
      transitions: { getElevation: 600, getFillColor: 400 },
      updateTriggers: {
        extruded: [is3D],
        getElevation: [minLst]
      }
    });
  }, [gridData, is3D, minLst]);

  const afterLayer = useMemo(() => {
    if (!gridData) return null;
    return new GeoJsonLayer({
      id: 'after-layer',
      data: gridData,
      pickable: true,
      stroked: false,
      filled: true,
      extruded: is3D,
      wireframe: false,
      getFillColor: (d) => {
        const sim = cellResultsMap[d.properties.grid_id];
        const tier = sim ? sim.tier_after : d.properties.tier;
        const color = TIER_COLORS[tier] || [128, 128, 128];
        return [...color, 175];
      },
      getElevation: (d) => {
        const sim = cellResultsMap[d.properties.grid_id];
        const lst = sim ? sim.lst_after : (d.properties?.lst_mean ?? minLst);
        const delta = Math.max(0, lst - minLst);
        return 40 + delta * 110;
      },
      transitions: { getElevation: 600, getFillColor: 400 },
      updateTriggers: {
        extruded: [is3D],
        getElevation: [minLst, cellResultsMap],
        getFillColor: [cellResultsMap]
      }
    });
  }, [gridData, is3D, minLst, cellResultsMap]);

  const beforeLayers = useMemo(() => (beforeLayer ? [beforeLayer] : []), [beforeLayer]);
  const afterLayers = useMemo(() => (afterLayer ? [afterLayer] : []), [afterLayer]);

  // Memoized tooltip formatters with accessible multi-channel classification
  const getBeforeTooltip = useCallback(
    ({ object }) => {
      if (!object) return null;
      const rawTier = object.properties?.tier?.toLowerCase() || 'normal';
      const tierSymbol = TIER_SYMBOLS[rawTier] || '■';
      const tier = rawTier.toUpperCase();
      const isHotspot = tier === 'CRITICAL' || tier === 'HIGH';
      return `Cell: ${object.properties.grid_id}\nLST: ${object.properties.lst_mean?.toFixed(1)}°C ([${tierSymbol}] ${tier})\nTarget Status: ${
        isHotspot
          ? 'Hotspot (Targeted)'
          : targetScope === 'all'
          ? 'Targeted (City-wide)'
          : 'Baseline (Unmodified)'
      }`;
    },
    [targetScope]
  );

  const getAfterTooltip = useCallback(
    ({ object }) => {
      if (!object) return null;
      const sim = cellResultsMap[object.properties.grid_id];
      const deltaT = sim?.delta_t ?? 0;
      const isTargeted = sim && Math.abs(deltaT) > 0.001;
      const rawTier = (sim ? sim.tier_after : object.properties?.tier)?.toLowerCase() || 'normal';
      const tierSymbol = TIER_SYMBOLS[rawTier] || '■';
      const tier = rawTier.toUpperCase();
      const lst = sim ? sim.lst_after : object.properties?.lst_mean;
      return `Cell: ${object.properties.grid_id}\nSimulated LST: ${lst?.toFixed(1)}°C ([${tierSymbol}] ${tier})\nCooling ΔT: ${
        deltaT < 0 ? deltaT.toFixed(2) + '°C' : '0.00°C'
      }\nTarget Status: ${
        isTargeted
          ? 'Intervention Applied'
          : targetScope === 'hotspots'
          ? 'Untargeted (Non-Hotspot)'
          : 'No Modification'
      }`;
    },
    [cellResultsMap, targetScope]
  );

  // Dismiss open sheets and panels on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isBottomSheetOpen) {
          setIsBottomSheetOpen(false);
        } else if (expandedExplanation) {
          setExpandedExplanation(null);
        } else if (showAssumptions) {
          setShowAssumptions(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBottomSheetOpen, expandedExplanation, showAssumptions]);

  // Synchronized camera handler between Before and After maps
  const handleViewStateChange = useCallback(({ viewState: nv }) => {
    setViewState((prev) => {
      if (
        Math.abs(prev.longitude - nv.longitude) < 0.0000001 &&
        Math.abs(prev.latitude - nv.latitude) < 0.0000001 &&
        Math.abs(prev.zoom - nv.zoom) < 0.00001 &&
        Math.abs(prev.pitch - nv.pitch) < 0.001 &&
        Math.abs(prev.bearing - nv.bearing) < 0.001
      ) {
        return prev;
      }

      return {
        ...prev,
        longitude: nv.longitude,
        latitude: nv.latitude,
        zoom: nv.zoom,
        pitch: nv.pitch,
        bearing: nv.bearing,
        maxZoom: nv.maxZoom ?? prev.maxZoom,
        minZoom: nv.minZoom ?? prev.minZoom,
        maxPitch: nv.maxPitch ?? prev.maxPitch,
        minPitch: nv.minPitch ?? prev.minPitch,
        transitionDuration: 0,
        transitionInterpolator: undefined
      };
    });
  }, []);

  // Center camera when selected city changes
  useEffect(() => {
    if (cityInfo?.center) {
      setViewState((prev) => ({
        ...prev,
        longitude: cityInfo.center[0],
        latitude: cityInfo.center[1],
        zoom: 10,
        bearing: 0,
        transitionDuration: 1000,
        transitionInterpolator: new FlyToInterpolator()
      }));
    }
  }, [city, cityInfo]);

  const hasActiveIntervention = Object.values(intensities).some((v) => v > 0);

  // Common Builder Content (Rendered in desktop sidebar or mobile bottom sheet)
  const renderBuilderContent = () => (
    <>
      <div className="panel-header">
        <div className="panel-title-row">
          <Sliders size={16} className="panel-icon" aria-hidden="true" />
          <h2 id="scenario-builder-title">Scenario Builder</h2>
        </div>
        <p className="panel-description">
          Simulate cooling intervention scenarios for{' '}
          <strong>{cityInfo?.name || city}</strong>. Modifies ML feature inputs to re-predict
          Land Surface Temperature.
        </p>
      </div>

      {/* Explicit Targeting Control */}
      <div className="targeting-card">
        <div className="targeting-header">
          <Target size={14} className="targeting-icon" aria-hidden="true" />
          <span className="targeting-title">Spatial Targeting</span>
          <span className="targeting-badge font-mono">
            {activeTargetCount} cells · ~{activeTargetAreaKm2} km²
          </span>
        </div>

        <div
          className="targeting-toggle-group"
          role="radiogroup"
          aria-label="Spatial targeting scope"
        >
          <button
            type="button"
            role="radio"
            aria-checked={targetScope === 'hotspots'}
            className={`target-btn ${targetScope === 'hotspots' ? 'active' : ''}`}
            onClick={() => setTargetScope('hotspots')}
          >
            <div className="target-btn-title">Hotspots Only</div>
            <div className="target-btn-sub">Critical &amp; High Tiers</div>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={targetScope === 'all'}
            className={`target-btn ${targetScope === 'all' ? 'active' : ''}`}
            onClick={() => setTargetScope('all')}
          >
            <div className="target-btn-title">Entire City</div>
            <div className="target-btn-sub">All Grid Cells</div>
          </button>
        </div>

        <p className="targeting-explanation">
          {targetScope === 'hotspots' ? (
            <>
              Applies interventions strictly to <strong>{hotspotsCount} hotspot cells</strong> (~
              {hotspotsAreaKm2} km²) where baseline LST exceeds <code>Mean + 1σ</code>. Moderate
              and cool cells remain unchanged, optimizing municipal cost efficiency.
            </>
          ) : (
            <>
              Applies interventions uniformly across all <strong>{totalCellsCount} grid cells</strong> (~
              {totalAreaKm2} km²) within urban bounds. Models widespread city-wide infrastructure
              deployment at higher capital cost.
            </>
          )}
        </p>
      </div>

      {/* Intervention Sliders Container */}
      <div className="sliders-section">
        <div className="section-title-row">
          <span className="section-title">Intervention Parameters</span>
          <span className="section-note font-mono">0% to 100% Intensity</span>
        </div>

        <div className="sliders-container">
          {INTERVENTIONS_CONFIG.map((inv) => {
            const IconComp = inv.icon;
            const value = intensities[inv.id] || 0;
            const pct = Math.round(value * 100);
            const isExpanded = expandedExplanation === inv.id;
            const physicalShift = inv.getPhysicalShift(value);

            return (
              <div key={inv.id} className={`slider-group ${value > 0 ? 'active-slider' : ''}`}>
                <div className="slider-header">
                  <div className="slider-title-line">
                    <span className="icon" aria-hidden="true">
                      <IconComp size={14} />
                    </span>
                    <label htmlFor={`slider-${inv.id}`} className="name">
                      {inv.label}
                    </label>
                    <span className="value font-mono">{pct}%</span>
                  </div>

                  {/* Real-time Physical Input Change Readout */}
                  <div className="physical-shift-readout font-mono">
                    <span className="shift-label">Input Shift:</span>
                    <span className={`shift-value ${value > 0 ? 'text-accent' : ''}`}>
                      {physicalShift}
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  id={`slider-${inv.id}`}
                  min="0"
                  max="1"
                  step="0.05"
                  value={value}
                  onChange={(e) => handleSliderChange(inv.id, e.target.value)}
                  className="range-slider"
                  style={{
                    '--slider-pct': `${pct}%`
                  }}
                  aria-label={`${inv.label} intervention intensity`}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={pct}
                  aria-valuetext={`${pct}% ${inv.label}`}
                />

                <div className="slider-footer">
                  <button
                    type="button"
                    className="toggle-explanation-btn"
                    onClick={() => setExpandedExplanation(isExpanded ? null : inv.id)}
                    aria-expanded={isExpanded}
                    aria-controls={`benchmark-matrix-${inv.id}`}
                  >
                    <HelpCircle size={11} aria-hidden="true" />
                    <span>What do 0%, 50%, 100% mean?</span>
                    {isExpanded ? <ChevronUp size={11} aria-hidden="true" /> : <ChevronDown size={11} aria-hidden="true" />}
                  </button>
                </div>

                {/* Explanatory Benchmark Matrix */}
                {isExpanded && (
                  <div id={`benchmark-matrix-${inv.id}`} className="benchmark-matrix animate-fade-in">
                    <div className="benchmark-tagline">{inv.tagline}</div>
                    <div className="benchmark-features">
                      <strong>Model Features:</strong> <code>{inv.modelFeatures}</code>
                    </div>
                    <div className="benchmark-list">
                      {inv.benchmarks.map((b) => (
                        <div key={b.pct} className="benchmark-item">
                          <span className="benchmark-pct font-mono">{b.pct}</span>
                          <div className="benchmark-content">
                            <strong>{b.title}</strong>
                            <span>{b.detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="actions-group">
        <button
          className="btn-simulate"
          onClick={runSimulation}
          disabled={isSimulating || !hasActiveIntervention}
          aria-label={
            isSimulating
              ? `Re-predicting scenario cooling for ${activeTargetCount} cells...`
              : 'Run cooling intervention scenario simulation'
          }
          title={
            !hasActiveIntervention
              ? 'Adjust at least one slider above 0% to run simulation'
              : undefined
          }
        >
          {isSimulating ? (
            <>
              <RefreshCw size={14} className="spin-icon" aria-hidden="true" />
              <span>Re-Predicting ({activeTargetCount} Cells)...</span>
            </>
          ) : (
            <>
              <Play size={13} className="btn-icon" aria-hidden="true" />
              <span>Run Simulation</span>
            </>
          )}
        </button>

        <button
          className="btn-reset"
          onClick={handleResetSliders}
          disabled={isSimulating || !hasActiveIntervention}
          aria-label="Reset all scenario intervention sliders to baseline (0%)"
          title="Reset all sliders to baseline (0%)"
        >
          <RotateCcw size={13} aria-hidden="true" />
          <span>Reset</span>
        </button>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div
          role="status"
          className={`status-message status-${statusMessage.type} animate-fade-in`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Presets Section */}
      <div className="presets-section">
        <div className="presets-header">
          <Sparkles size={12} className="presets-icon" aria-hidden="true" />
          <h3>Scenario Presets</h3>
        </div>
        <div className="preset-buttons" role="group" aria-label="Intervention preset scenarios">
          {presets.map((p) => (
            <button
              key={p.scenario_id}
              onClick={() => loadPreset(p)}
              className={`btn-preset ${activePresetId === p.scenario_id ? 'active' : ''}`}
              disabled={isSimulating}
              aria-pressed={activePresetId === p.scenario_id}
            >
              <div className="preset-btn-top">
                <span className="preset-name">{p.name}</span>
                {p.mean_cooling_c !== undefined && p.mean_cooling_c !== 0 && (
                  <span className="preset-cooling font-mono">
                    {p.mean_cooling_c.toFixed(1)}°C
                  </span>
                )}
              </div>
              {p.description && <div className="preset-desc">{p.description}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Assumptions & Model Limitations Disclosure */}
      <div className="assumptions-card">
        <button
          type="button"
          className="assumptions-toggle"
          onClick={() => setShowAssumptions(!showAssumptions)}
          aria-expanded={showAssumptions}
          aria-controls="scenario-assumptions-panel"
        >
          <AlertTriangle size={13} className="assumptions-icon" aria-hidden="true" />
          <span>Assumptions &amp; Model Limitations</span>
          {showAssumptions ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
        </button>

        {showAssumptions && (
          <div id="scenario-assumptions-panel" className="assumptions-content animate-fade-in">
            <ul>
              <li>
                <strong>Statistical Surrogate (Not CFD):</strong> Predictions are computed by an
                XGBoost regression model trained on satellite observations, not a physics-based
                fluid dynamic or thermal microclimate simulation.
              </li>
              <li>
                <strong>Land Surface Temperature (LST):</strong> Results represent radiometric
                surface skin temperature (e.g. roofs/asphalt), not 2-meter ambient air
                temperature. Air cooling is typically lower and moderated by atmospheric mixing.
              </li>
              <li>
                <strong>Instantaneous Implementation:</strong> Simulates mature canopy density
                and fully completed infrastructure without accounting for multi-year growth or
                construction phases.
              </li>
              <li>
                <strong>Zero Spatial Advection:</strong> Grid cells are evaluated independently;
                lateral thermal advection between neighboring cells is not modeled.
              </li>
            </ul>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="page-container animate-fade-in">
      <div className={`scenario-layout ${isMobile ? 'is-mobile-layout' : ''}`}>
        {/* Desktop Left Panel: Scenario Builder & Parameter Tuning */}
        {!isMobile && (
          <div className="builder-panel glass-panel">
            {renderBuilderContent()}
          </div>
        )}

        {/* Mobile Bottom Sheet: Scenario Builder */}
        {isMobile && isBottomSheetOpen && (
          <>
            <div
              className="bottom-sheet-backdrop"
              onClick={() => setIsBottomSheetOpen(false)}
              aria-hidden="true"
            />
            <div
              className="builder-panel mobile-sheet glass-panel animate-fade-in"
              role="dialog"
              aria-modal="true"
              aria-labelledby="scenario-builder-title"
              tabIndex={-1}
            >
              <div className="mobile-sheet-top-bar">
                <div className="mobile-sheet-handle" />
                <button
                  type="button"
                  className="mobile-sheet-close"
                  onClick={() => setIsBottomSheetOpen(false)}
                  aria-label="Close parameters sheet"
                >
                  <X size={16} />
                </button>
              </div>
              {renderBuilderContent()}
            </div>
          </>
        )}

        {/* Desktop Right Panel: Synchronized Split Maps & Results Summary */}
        {!isMobile && (
          <div className="results-panel">
            {/* Synchronized Field Atlas Map Controls (Top-Right of results panel) */}
            <MapControls
              className="scenario-map-controls"
              viewState={viewState}
              onViewStateChange={setViewState}
            />

            <div className="split-maps">
              {/* Before Map */}
              <div className="map-half">
                <div className="map-label">
                  <span>Before (Baseline)</span>
                  <button
                    className="info-trigger"
                    onClick={() => setShowLstInfo(true)}
                    aria-label="What does LST mean?"
                  >
                    <Info size={12} />
                  </button>
                </div>
                <DeckGL
                  id="deckgl-before"
                  viewState={viewState}
                  onViewStateChange={handleViewStateChange}
                  controller={true}
                  layers={beforeLayers}
                  getTooltip={getBeforeTooltip}
                >
                  <Map
                    {...viewState}
                    mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
                    attributionControl={false}
                  />
                </DeckGL>
              </div>

              {/* After Map */}
              <div className="map-half">
                <div className="map-label">
                  <span>After (Scenario Simulation)</span>
                  {simulationResult && (
                    <span className="map-sim-tag font-mono">
                      {simulationResult.summary.cells_modified} cells{simDurationMs ? ` · ${simDurationMs}ms` : ''}
                    </span>
                  )}
                </div>
                <DeckGL
                  id="deckgl-after"
                  viewState={viewState}
                  onViewStateChange={handleViewStateChange}
                  controller={true}
                  layers={afterLayers}
                  getTooltip={getAfterTooltip}
                >
                  <Map
                    {...viewState}
                    mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
                    attributionControl={false}
                  />
                </DeckGL>
              </div>
            </div>

            {/* Map Attribution Bar */}
            <MapAttribution className="scenario-map-attribution" />

            {/* Results Summary Overlay */}
            {simulationResult && simulationResult.summary && (
              <div className="results-summary glass-panel animate-fade-in">
                <div className="result-metric">
                  <span className="metric-label">Mean Cooling</span>
                  <span className="metric-value text-success">
                    {simulationResult.summary.mean_cooling_c.toFixed(2)}°C
                  </span>
                  <span className="metric-sub font-mono">
                    Max: {simulationResult.summary.max_cooling_c.toFixed(2)}°C
                  </span>
                </div>

                <div className="result-metric">
                  <span className="metric-label">Hotspot Reduction</span>
                  <span className="metric-value text-success">
                    {simulationResult.summary.hotspot_reduction_pct.toFixed(1)}%
                  </span>
                  <span className="metric-sub font-mono">
                    {simulationResult.summary.hotspots_after} remaining
                  </span>
                </div>

                <div className="result-metric">
                  <span className="metric-label">Targeted Cells</span>
                  <span className="metric-value">
                    {simulationResult.summary.cells_modified}
                  </span>
                  <span className="metric-sub font-mono">
                    ~{(simulationResult.summary.cells_modified * 0.25).toFixed(1)} km²
                  </span>
                </div>

                <div className="result-metric">
                  <span className="metric-label">Est. Capital Cost</span>
                  <span className="metric-value text-warning">
                    ${simulationResult.summary.cost_estimate_m.toFixed(1)}M
                  </span>
                  <span className="metric-sub font-mono">
                    {simulationResult.summary.cost_efficiency_c_per_m > 0
                      ? `${(simulationResult.summary.cost_efficiency_c_per_m * 1000).toFixed(1)}m°C/$M`
                      : '—'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Mobile View: Single Full Map with A/B Toggle & Collapsible Bottom Controls */}
        {isMobile && (
          <div className="results-panel mobile-results">
            {/* Prominent segmented toggle for A/B comparison on the same full map */}
            <div
              className="scenario-mobile-compare-toggle glass-panel"
              role="group"
              aria-label="Scenario before and after view comparison"
            >
              <button
                type="button"
                className={`compare-toggle-tab ${mobileCompareMode === 'before' ? 'active' : ''}`}
                onClick={() => setMobileCompareMode('before')}
                aria-pressed={mobileCompareMode === 'before'}
              >
                <span>Before (Baseline)</span>
              </button>
              <button
                type="button"
                className={`compare-toggle-tab ${mobileCompareMode === 'after' ? 'active' : ''}`}
                onClick={() => setMobileCompareMode('after')}
                aria-pressed={mobileCompareMode === 'after'}
              >
                <span>After (Simulation)</span>
                {simulationResult && (
                  <span className="compare-tag-dot font-mono">
                    {simulationResult.summary.cells_modified}
                  </span>
                )}
              </button>
            </div>

            <MapControls
              className="scenario-map-controls mobile-controls"
              viewState={viewState}
              onViewStateChange={setViewState}
            />

            <div className="mobile-single-map">
              <DeckGL
                id="deckgl-mobile-compare"
                viewState={viewState}
                onViewStateChange={handleViewStateChange}
                controller={true}
                layers={mobileCompareMode === 'after' ? afterLayers : beforeLayers}
                getTooltip={mobileCompareMode === 'after' ? getAfterTooltip : getBeforeTooltip}
              >
                <Map
                  {...viewState}
                  mapStyle={theme === 'light' ? MAP_STYLE_LIGHT : MAP_STYLE_DARK}
                  attributionControl={false}
                />
              </DeckGL>
            </div>

            <MapAttribution className="scenario-map-attribution mobile-attribution" />

            {/* Compact mobile results summary overlay */}
            {simulationResult && simulationResult.summary && (
              <div className="results-summary glass-panel mobile-summary animate-fade-in">
                <div className="result-metric">
                  <span className="metric-label">Mean Cooling</span>
                  <span className="metric-value text-success font-mono">
                    {simulationResult.summary.mean_cooling_c.toFixed(2)}°C
                  </span>
                </div>
                <div className="result-metric">
                  <span className="metric-label">Hotspots</span>
                  <span className="metric-value text-success font-mono">
                    -{simulationResult.summary.hotspot_reduction_pct.toFixed(0)}%
                  </span>
                </div>
                <div className="result-metric">
                  <span className="metric-label">Cost</span>
                  <span className="metric-value text-warning font-mono">
                    ${simulationResult.summary.cost_estimate_m.toFixed(1)}M
                  </span>
                </div>
              </div>
            )}

            {/* Collapsed bottom bar trigger */}
            {!isBottomSheetOpen && (
              <div className="mobile-builder-bottom-bar glass-panel animate-fade-in">
                <button
                  type="button"
                  className="builder-drawer-trigger"
                  onClick={() => setIsBottomSheetOpen(true)}
                  aria-label="Open Scenario Parameters"
                >
                  <Sliders size={15} />
                  <div className="drawer-title-group">
                    <span className="drawer-title">Scenario Parameters</span>
                    <span className="drawer-sub font-mono">
                      {hasActiveIntervention
                        ? `${Object.values(intensities).filter((v) => v > 0).length} active · ${
                            targetScope === 'all' ? 'All cells' : `${hotspotsCount} hotspots`
                          }`
                        : 'Configure cooling interventions'}
                    </span>
                  </div>
                  <ChevronUp size={16} className="drawer-chevron" />
                </button>

                {hasActiveIntervention && (
                  <button
                    type="button"
                    className="drawer-quick-simulate-btn"
                    onClick={runSimulation}
                    disabled={isSimulating}
                  >
                    {isSimulating ? (
                      <RefreshCw size={13} className="spin-icon" />
                    ) : (
                      <Play size={13} />
                    )}
                    <span>{isSimulating ? 'Simulating' : 'Simulate'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showLstInfo && <LstExplainerModal onClose={() => setShowLstInfo(false)} />}
    </div>
  );
}
