import { useMemo } from 'react';
import { Plus, Minus, Compass, Box } from 'lucide-react';
import { FlyToInterpolator } from '@deck.gl/core';
import './MapControls.css';

export default function MapControls({
  viewState,
  onViewStateChange,
  minZoom = 3,
  maxZoom = 19,
  className = ''
}) {
  const is3D = (viewState?.pitch || 0) > 10;
  const bearing = viewState?.bearing || 0;
  const zoom = viewState?.zoom || 10;

  const canZoomIn = zoom < maxZoom;
  const canZoomOut = zoom > minZoom;

  const handleZoomIn = () => {
    if (!canZoomIn) return;
    onViewStateChange((prev) => ({
      ...prev,
      zoom: Math.min(prev.zoom + 1, maxZoom),
      transitionDuration: 300,
      transitionInterpolator: new FlyToInterpolator()
    }));
  };

  const handleZoomOut = () => {
    if (!canZoomOut) return;
    onViewStateChange((prev) => ({
      ...prev,
      zoom: Math.max(prev.zoom - 1, minZoom),
      transitionDuration: 300,
      transitionInterpolator: new FlyToInterpolator()
    }));
  };

  const handleResetNorth = () => {
    onViewStateChange((prev) => ({
      ...prev,
      bearing: 0,
      transitionDuration: 400,
      transitionInterpolator: new FlyToInterpolator()
    }));
  };

  const handleToggle3D = () => {
    onViewStateChange((prev) => ({
      ...prev,
      pitch: is3D ? 0 : 45,
      transitionDuration: 500,
      transitionInterpolator: new FlyToInterpolator()
    }));
  };

  return (
    <div className={`map-controls-group ${className}`} role="toolbar" aria-label="Map Navigation Controls">
      {/* Zoom In */}
      <button
        type="button"
        className="map-ctrl-btn"
        onClick={handleZoomIn}
        disabled={!canZoomIn}
        title="Zoom In"
        aria-label="Zoom in"
      >
        <Plus size={15} />
      </button>

      {/* Zoom Out */}
      <button
        type="button"
        className="map-ctrl-btn"
        onClick={handleZoomOut}
        disabled={!canZoomOut}
        title="Zoom Out"
        aria-label="Zoom out"
      >
        <Minus size={15} />
      </button>

      <div className="map-ctrl-divider" />

      {/* Reset Orientation / North */}
      <button
        type="button"
        className={`map-ctrl-btn compass-btn${bearing !== 0 ? ' is-rotated' : ''}`}
        onClick={handleResetNorth}
        title={`Reset Orientation to North (${Math.round(bearing)}°)`}
        aria-label="Reset orientation to North"
      >
        <Compass
          size={16}
          style={{
            transform: `rotate(${-bearing}deg)`,
            transition: 'transform 0.15s ease-out'
          }}
        />
      </button>

      {/* 2D / 3D Perspective Toggle */}
      <button
        type="button"
        className={`map-ctrl-btn perspective-btn${is3D ? ' is-3d' : ''}`}
        onClick={handleToggle3D}
        title={is3D ? 'Switch to 2D Top-Down View' : 'Switch to 3D Perspective View'}
        aria-label={is3D ? 'Switch to 2D view' : 'Switch to 3D view'}
      >
        <span className="dimension-badge">{is3D ? '3D' : '2D'}</span>
      </button>
    </div>
  );
}
