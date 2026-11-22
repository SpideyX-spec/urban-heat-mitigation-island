import { useEffect } from 'react';
import { X, Database, Cpu, Satellite, AlertTriangle, ExternalLink } from 'lucide-react';
import './MethodologyDrawer.css';

export default function MethodologyDrawer({ isOpen, onClose, city, cityInfo, validation }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const stats = validation?.validation;
  const cityName = cityInfo?.name || city || 'Selected City';

  return (
    <div className="methodology-backdrop" onClick={onClose}>
      <aside
        className="methodology-drawer glass-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Data Provenance and Methodology"
      >
        <div className="drawer-header">
          <div className="drawer-title-group">
            <span className="drawer-eyebrow">Scientific Documentation</span>
            <h2>Data Provenance &amp; Methodology</h2>
          </div>
          <button
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close methodology panel"
          >
            <X size={18} />
          </button>
        </div>

        <div className="drawer-content">
          {/* Important Transparency Notice */}
          <div className="drawer-notice-box">
            <div className="notice-icon">
              <AlertTriangle size={16} />
            </div>
            <div className="notice-body">
              <strong>Simulated / Modelled Dataset Notice</strong>
              <p>
                All spatial grids, building morphology metrics, and land surface temperatures
                displayed in this dashboard are generated through synthetic simulation models,
                not continuous satellite telemetry. Real-world satellite overpass comparisons
                exhibit substantial discrepancies (±6.43°C average RMSE). This system is
                designed for exploratory decision support and scenario evaluation, not
                operational monitoring.
              </p>
            </div>
          </div>

          {/* Section 1: Synthetic Data Generation */}
          <section className="methodology-section">
            <div className="section-head">
              <Database size={16} />
              <h3>1. Synthetic Feature Generation</h3>
            </div>
            <p>
              To enable cross-city comparisons across 20 Indian metropolitan regions without
              prohibitive compute overhead and satellite acquisition gaps, the platform
              constructs synthetic 500m fishnet analysis grids:
            </p>
            <ul className="methodology-list">
              <li>
                <strong>Spatial Projections:</strong> Grids are projected into city-specific local
                UTM zones (e.g., <code>EPSG:32643</code>) via <code>pyproj</code> to eliminate
                distance and area distortion across varied latitudes.
              </li>
              <li>
                <strong>Morphology Features:</strong> Synthetic estimators define building density,
                mean building heights, road densities, sky view factor (SVF), and impervious
                surface fractions based on urban density decay gradients radiating from city centers.
              </li>
              <li>
                <strong>Environmental Proxies:</strong> Vegetation cover (NDVI proxy), proximity to
                water channels (rivers, lakes, coastlines), and solar radiation indices are
                parameterized using localized urban geography.
              </li>
              <li>
                <strong>Macro-Climate Baselines:</strong> Baseline temperatures are anchored to
                historical summer climatological normals published by the India Meteorological
                Department (IMD) for each specific city (e.g., 44°C max baseline for New Delhi/Nagpur vs. 34°C for coastal Mumbai).
              </li>
            </ul>
          </section>

          {/* Section 2: Machine Learning Prediction Model */}
          <section className="methodology-section">
            <div className="section-head">
              <Cpu size={16} />
              <h3>2. Machine Learning Architecture</h3>
            </div>
            <p>
              A single unified machine learning pipeline predicts Land Surface Temperature (LST)
              and quantifies feature contributions:
            </p>
            <div className="specs-grid">
              <div className="spec-card">
                <span className="spec-label">Model Type</span>
                <span className="spec-value">XGBoost Regressor</span>
              </div>
              <div className="spec-card">
                <span className="spec-label">Target Variable</span>
                <span className="spec-value">lst_mean (°C)</span>
              </div>
              <div className="spec-card">
                <span className="spec-label">Validation Scheme</span>
                <span className="spec-value">5-Fold Leave-Cities-Out CV</span>
              </div>
              <div className="spec-card">
                <span className="spec-label">Explainability</span>
                <span className="spec-value">TreeSHAP (Local &amp; Global)</span>
              </div>
            </div>
            <ul className="methodology-list" style={{ marginTop: 12 }}>
              <li>
                <strong>Spatial Anti-Leakage:</strong> Raw geographic coordinates (latitude and
                longitude) were deliberately excluded from the feature set. This prevents the model
                from memorizing individual city geography, forcing it to learn physically
                actionable relationships between urban morphology and heat.
              </li>
              <li>
                <strong>Leave-Cities-Out Validation:</strong> Cross-validation splits hold out entire
                cities rather than random cells, testing whether heat-mitigation relationships
                generalize to previously unseen urban centers.
              </li>
              <li>
                <strong>Explainable Attributions:</strong> SHAP values explain individual cell
                elevations by isolating specific drivers (such as green deficit, impervious ratio,
                and wind dispersion resistance).
              </li>
            </ul>
          </section>

          {/* Section 3: Landsat Satellite Reference Comparison */}
          <section className="methodology-section">
            <div className="section-head">
              <Satellite size={16} />
              <h3>3. Landsat Observation Comparison</h3>
            </div>
            <p>
              To measure how synthetic representations compare against empirical observation,
              the pipeline queries Microsoft Planetary Computer STAC for USGS Landsat 8/9
              Collection 2 Level-2 Surface Temperature (thermal band <code>ST_B10</code>):
            </p>

            {stats ? (
              <div className="comparison-card">
                <div className="comparison-card-title">
                  Comparison Metrics for {cityName}
                </div>
                <div className="comparison-table">
                  <div className="table-row">
                    <span>Reference Sensor</span>
                    <code>{validation?.platform || 'Landsat 8/9'} (ST_B10)</code>
                  </div>
                  <div className="table-row">
                    <span>Scene Timestamp</span>
                    <span>
                      {validation?.scene_datetime
                        ? new Date(validation.scene_datetime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="table-row">
                    <span>Cloud Cover</span>
                    <span>{validation?.cloud_cover_pct ?? '0'}%</span>
                  </div>
                  <div className="table-row highlight">
                    <span>Root Mean Square Error (RMSE)</span>
                    <strong className="mono">±{stats.rmse_c}°C</strong>
                  </div>
                  <div className="table-row">
                    <span>Mean Absolute Error (MAE)</span>
                    <strong className="mono">±{stats.mae_c}°C</strong>
                  </div>
                  <div className="table-row highlight">
                    <span>Pearson Spatial Correlation (r)</span>
                    <strong className="mono">{stats.correlation}</strong>
                  </div>
                </div>
                <p className="comparison-interpretation">
                  <strong>Empirical Discrepancy Analysis:</strong> The RMSE of ±{stats.rmse_c}°C and
                  correlation of {stats.correlation} indicate weak agreement between the synthetic
                  model and instantaneous satellite telemetry. While macro temperature averages
                  align with regional seasonal envelopes, localized intra-urban microclimates in
                  this simulation do not match actual ground satellite passes.
                </p>
              </div>
            ) : (
              <div className="comparison-card empty">
                <p>
                  No single-scene Landsat overpass has been cataloged for {cityName} yet. Across
                  cataloged cities, comparisons yield an average RMSE of approximately ±6.43°C
                  and weak or negative spatial correlation.
                </p>
              </div>
            )}

            <p className="methodology-note">
              <strong>Why observations diverge from simulations:</strong> Single-scene satellite
              overpasses capture transient real-time atmospheric states (recent rain, soil moisture,
              instantaneous cloud shadow cooling, and aerosol haze). The synthetic model represents
              a steady-state generalized urban microclimate, leading to significant divergence on
              individual days.
            </p>
          </section>

          {/* Section 4: Limitations and Scope */}
          <section className="methodology-section">
            <div className="section-head">
              <AlertTriangle size={16} />
              <h3>4. Known Limitations &amp; Scope</h3>
            </div>
            <ul className="methodology-list">
              <li>
                <strong>Not Live Monitoring:</strong> The heatmap does not ingest live weather feeds
                or daily satellite passes in real time.
              </li>
              <li>
                <strong>Surface vs. Air Temperature:</strong> The system models Land Surface
                Temperature (radiometric skin temperature of roofs and pavements), which is
                typically 10–20°C higher than 2-meter ambient air temperature experienced by
                pedestrians.
              </li>
              <li>
                <strong>Anthropogenic Heat:</strong> Heat rejected from air conditioning units,
                combustion engines, and industrial exhausts is not dynamically simulated.
              </li>
              <li>
                <strong>Linearized Scenarios:</strong> Cooling scenario deltas (e.g., +20% tree
                cover) represent model inference shifts based on empirical literature guidelines,
                not full 3D Computational Fluid Dynamics (CFD) microclimate simulations.
              </li>
            </ul>
          </section>
        </div>

        <div className="drawer-footer">
          <span className="drawer-footer-text">Urban Heat Mitigation MVP · Version 1.6</span>
          <button className="drawer-footer-close" onClick={onClose}>
            Close Panel
          </button>
        </div>
      </aside>
    </div>
  );
}
