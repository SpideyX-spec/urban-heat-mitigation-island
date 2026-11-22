import { useState } from 'react';
import { Satellite, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import './ValidationBadge.css';

export default function ValidationBadge({ validation, onOpenMethodology }) {
  const [expanded, setExpanded] = useState(false);

  // If no validation data exists for this city, show an honest uncalibrated indicator
  if (!validation || !validation.available) {
    return (
      <div className="validation-badge uncalibrated">
        <div className="validation-badge-trigger" onClick={() => onOpenMethodology?.()}>
          <Satellite size={13} />
          <span className="badge-title">Satellite Cross-Reference</span>
          <span className="discrepancy-tag uncalibrated-tag">Uncalibrated</span>
        </div>
      </div>
    );
  }

  const { validation: stats, scene_datetime, cloud_cover_pct, platform, cells_covered, total_cells } = validation;
  const coveragePct = total_cells ? Math.round((cells_covered / total_cells) * 100) : null;
  const sceneDate = scene_datetime ? new Date(scene_datetime).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'short', day: 'numeric',
  }) : null;

  const rmseText = stats?.rmse_c ? `±${stats.rmse_c}°C RMSE` : 'Uncalibrated';

  return (
    <div className={`validation-badge${expanded ? ' expanded' : ''}`}>
      <button
        type="button"
        className="validation-badge-trigger"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label="Toggle Landsat observation comparison details"
      >
        <Satellite size={13} className="satellite-icon" />
        <span className="badge-title">Landsat Cross-Reference</span>
        {stats && (
          <span className="discrepancy-tag" title="Observed thermal discrepancy against Landsat pass">
            {rmseText}
          </span>
        )}
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {expanded && (
        <div className="validation-detail">
          <div className="validation-summary-status">
            <AlertCircle size={13} />
            <span>Empirical Discrepancy (Weak Spatial Agreement)</span>
          </div>

          <div className="validation-rows-group">
            <div className="validation-row">
              <span>Reference Sensor</span>
              <strong>{platform === 'landsat-9' ? 'Landsat 9' : platform === 'landsat-8' ? 'Landsat 8' : platform} (ST_B10)</strong>
            </div>
            <div className="validation-row">
              <span>Overpass Date</span>
              <strong>{sceneDate || 'N/A'}</strong>
            </div>
            <div className="validation-row">
              <span>Cloud / Coverage</span>
              <strong>{cloud_cover_pct}% cloud · {coveragePct}% grid</strong>
            </div>
            {stats && (
              <>
                <div className="validation-divider" />
                <div className="validation-row highlight">
                  <span>Root Mean Square Error</span>
                  <strong className="mono">±{stats.rmse_c}°C</strong>
                </div>
                <div className="validation-row">
                  <span>Mean Absolute Error</span>
                  <strong className="mono">±{stats.mae_c}°C</strong>
                </div>
                <div className="validation-row highlight">
                  <span>Spatial Correlation (r)</span>
                  <strong className="mono">{stats.correlation}</strong>
                </div>
              </>
            )}
          </div>

          <p className="validation-note">
            Modelled temperatures diverge significantly from this single-scene Landsat overpass
            (RMSE ±{stats?.rmse_c}°C, correlation {stats?.correlation}). The synthetic spatial distribution
            does not replicate empirical satellite passes. This model is uncalibrated against ground observations.
          </p>

          {onOpenMethodology && (
            <button
              type="button"
              className="validation-methodology-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenMethodology();
              }}
            >
              Data Provenance &amp; Methodology ↗
            </button>
          )}
        </div>
      )}
    </div>
  );
}
