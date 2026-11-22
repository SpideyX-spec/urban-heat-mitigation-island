import './MapAttribution.css';

export default function MapAttribution({ className = '' }) {
  return (
    <div className={`map-attribution-bar ${className}`} role="contentinfo" aria-label="Map Data Attribution">
      <span>
        &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors
      </span>
      <span className="attribution-sep">&middot;</span>
      <span>
        &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>
      </span>
      <span className="attribution-sep">&middot;</span>
      <span>
        <a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a>
      </span>
    </div>
  );
}
