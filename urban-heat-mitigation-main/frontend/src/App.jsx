import { useState, useEffect, useMemo, useCallback } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, useParams, Navigate } from 'react-router-dom';
import { Map, BarChart2, Layers, Sun, Moon, Info, Database } from 'lucide-react';
import './App.css';
import { API_BASE } from './api';
import { useTheme } from './ThemeContext';
import AboutModal from './components/AboutModal';
import ServerWakingNotice from './components/ServerWakingNotice';
import CityCombobox from './components/CityCombobox';
import MethodologyDrawer from './components/MethodologyDrawer';

import MapView from './pages/MapView';
import DriversView from './pages/DriversView';
import ScenarioView from './pages/ScenarioView';

// Minimal 3x3 geospatial raster grid product mark with thermal centroid
function GridMark() {
  return (
    <div className="product-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="4" height="4" rx="0.75" fill="var(--text-3)" opacity="0.6" />
        <rect x="7" y="1" width="4" height="4" rx="0.75" fill="var(--text-2)" opacity="0.8" />
        <rect x="13" y="1" width="4" height="4" rx="0.75" fill="var(--text-3)" opacity="0.6" />
        <rect x="1" y="7" width="4" height="4" rx="0.75" fill="var(--text-2)" opacity="0.8" />
        <rect x="7" y="7" width="4" height="4" rx="0.75" fill="var(--tier-critical)" />
        <rect x="13" y="7" width="4" height="4" rx="0.75" fill="var(--tier-high)" />
        <rect x="1" y="13" width="4" height="4" rx="0.75" fill="var(--tier-cool)" />
        <rect x="7" y="13" width="4" height="4" rx="0.75" fill="var(--text-2)" opacity="0.8" />
        <rect x="13" y="13" width="4" height="4" rx="0.75" fill="var(--text-3)" opacity="0.6" />
      </svg>
    </div>
  );
}

// Resolves aliases and fuzzy city names (e.g. "delhi" -> "new_delhi", "bangalore" -> "bengaluru")
export function resolveCityId(input, cities = [], defaultCity = 'new_delhi') {
  if (!input) return defaultCity;
  const normalized = input.toLowerCase().trim().replace(/[\s-]+/g, '_');

  // Exact match
  const exact = cities.find((c) => c.id.toLowerCase() === normalized);
  if (exact) return exact.id;

  // Well-known colloquial aliases
  if (normalized === 'delhi') return 'new_delhi';
  if (normalized === 'bangalore') return 'bengaluru';
  if (normalized === 'calcutta') return 'kolkata';
  if (normalized === 'madras') return 'chennai';
  if (normalized === 'bombay') return 'mumbai';

  // Match by name
  const byName = cities.find((c) => c.name.toLowerCase().replace(/[\s-]+/g, '_') === normalized);
  if (byName) return byName.id;

  // Prefix match
  const prefix = cities.find((c) => c.id.toLowerCase().startsWith(normalized));
  if (prefix) return prefix.id;

  return defaultCity;
}

// Synchronizes URL parameters with view components and updates active city
function DashboardRouter({ cities, defaultCity, onCityChange, onOpenMethodology }) {
  const { cityId, view } = useParams();
  const navigate = useNavigate();

  const resolvedCity = useMemo(() => {
    return resolveCityId(cityId, cities, defaultCity);
  }, [cityId, cities, defaultCity]);

  const activeCityInfo = useMemo(() => {
    return cities.find((c) => c.id === resolvedCity);
  }, [cities, resolvedCity]);

  const validView = view === 'drivers' || view === 'scenarios' ? view : 'map';

  // Synchronize city change back to parent for top combobox
  useEffect(() => {
    if (resolvedCity) {
      onCityChange(resolvedCity);
    }
  }, [resolvedCity, onCityChange]);

  // Normalize URL if alias was used or view is absent
  useEffect(() => {
    if (cityId && (cityId.toLowerCase() !== resolvedCity || view !== validView)) {
      navigate(`/${resolvedCity}/${validView}`, { replace: true });
    }
  }, [cityId, resolvedCity, view, validView, navigate]);

  if (!resolvedCity) return null;

  if (validView === 'drivers') {
    return <DriversView key={resolvedCity} city={resolvedCity} cityInfo={activeCityInfo} />;
  }
  if (validView === 'scenarios') {
    return <ScenarioView key={resolvedCity} city={resolvedCity} cityInfo={activeCityInfo} />;
  }
  return (
    <MapView
      key={resolvedCity}
      city={resolvedCity}
      cityInfo={activeCityInfo}
      onOpenMethodology={onOpenMethodology}
    />
  );
}

function App() {
  const { theme, toggleTheme } = useTheme();
  const [showAbout, setShowAbout] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);

  const [cities, setCities] = useState([]);
  const [defaultCity, setDefaultCity] = useState('new_delhi');
  const [selectedCity, setSelectedCity] = useState(null);
  const [loadingCities, setLoadingCities] = useState(true);
  const [citiesError, setCitiesError] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Extract current view from pathname
  const currentView = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const v = parts[1];
      if (['map', 'drivers', 'scenarios'].includes(v)) return v;
    }
    if (parts.length === 1 && ['map', 'drivers', 'scenarios'].includes(parts[0])) {
      return parts[0];
    }
    return 'map';
  }, [location.pathname]);

  const activeCityId = selectedCity || defaultCity || 'new_delhi';
  const activeCityInfo = cities.find((c) => c.id === activeCityId);

  const fetchCities = useCallback(() => {
    setLoadingCities(true);
    setCitiesError(null);
    fetch(`${API_BASE}/api/v1/cities`)
      .then((res) => res.json())
      .then((data) => {
        const cityList = data.cities || [];
        const defCity = data.default_city || (cityList[0] && cityList[0].id) || 'new_delhi';
        setCities(cityList);
        setDefaultCity(defCity);
      })
      .catch((err) => {
        console.error('Failed to load city list:', err);
        setCitiesError(err.message || 'Could not reach the server.');
      })
      .finally(() => setLoadingCities(false));
  }, []);

  useEffect(() => {
    fetchCities();
  }, [fetchCities]);

  const handleSelectCity = (newCityId) => {
    setSelectedCity(newCityId);
    navigate(`/${newCityId}/${currentView}`);
  };

  return (
    <div className="app-container">
      {/* Compact Top Navigation Bar */}
      <header className="top-navbar" role="banner">
        {/* Left Section: Brand & Searchable City Combobox */}
        <div className="nav-left-section">
          <NavLink to={`/${activeCityId}/map`} className="brand-group" title="Urban Heat Mitigation">
            <GridMark />
            <div className="brand-text">
              <span className="product-title">Urban Heat Mitigation</span>
              <span className="product-tag font-mono">ATLAS</span>
            </div>
          </NavLink>

          <div className="nav-divider" aria-hidden="true" />

          {/* Searchable, Keyboard-Accessible City Combobox */}
          <CityCombobox
            cities={cities}
            selectedCityId={activeCityId}
            onSelectCity={handleSelectCity}
            disabled={loadingCities}
          />
        </div>

        {/* Center Section: Primary Navigation Tabs */}
        <nav className="top-nav-tabs" role="navigation" aria-label="Primary Navigation">
          <NavLink
            to={`/${activeCityId}/map`}
            className={() => `nav-tab${currentView === 'map' ? ' active' : ''}`}
            end
          >
            <Map size={14} aria-hidden="true" />
            <span>Heat Map</span>
          </NavLink>

          <NavLink
            to={`/${activeCityId}/drivers`}
            className={() => `nav-tab${currentView === 'drivers' ? ' active' : ''}`}
          >
            <BarChart2 size={14} aria-hidden="true" />
            <span>Heat Drivers</span>
          </NavLink>

          <NavLink
            to={`/${activeCityId}/scenarios`}
            className={() => `nav-tab${currentView === 'scenarios' ? ' active' : ''}`}
          >
            <Layers size={14} aria-hidden="true" />
            <span>Scenarios</span>
          </NavLink>
        </nav>

        {/* Right Section: Data & Methodology, Theme, Instructions */}
        <div className="top-nav-utilities">
          <button
            type="button"
            className="nav-tool-btn methodology-btn"
            onClick={() => setShowMethodology(true)}
            title="Inspect Data Provenance, XGBoost Model, and Landsat Comparison"
          >
            <Database size={13} aria-hidden="true" />
            <span className="tool-label">Methodology</span>
          </button>

          <button
            type="button"
            className="nav-tool-btn icon-only"
            onClick={() => setShowAbout(true)}
            title="Platform Instructions & Architecture"
            aria-label="About & Instructions"
          >
            <Info size={14} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="nav-tool-btn icon-only theme-toggle-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} theme`}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        </div>
      </header>

      {/* Main Content Area: Map remains the dominant visual canvas */}
      <main className="main-content" role="main">
        {loadingCities && !selectedCity && (
          <div className="page-loading-scrim">
            <ServerWakingNotice compact onRetry={fetchCities} error={citiesError} />
          </div>
        )}

        {cities.length > 0 && (
          <Routes>
            {/* Direct URL Route: /:cityId/:view */}
            <Route
              path="/:cityId/:view"
              element={
                <DashboardRouter
                  cities={cities}
                  defaultCity={defaultCity}
                  onCityChange={setSelectedCity}
                  onOpenMethodology={() => setShowMethodology(true)}
                />
              }
            />

            {/* City Root: /:cityId -> defaults to /:cityId/map */}
            <Route
              path="/:cityId"
              element={
                <DashboardRouter
                  cities={cities}
                  defaultCity={defaultCity}
                  onCityChange={setSelectedCity}
                  onOpenMethodology={() => setShowMethodology(true)}
                />
              }
            />

            {/* Legacy Routes backward compatibility */}
            <Route
              path="/map"
              element={<Navigate to={`/${activeCityId}/map`} replace />}
            />
            <Route
              path="/drivers"
              element={<Navigate to={`/${activeCityId}/drivers`} replace />}
            />
            <Route
              path="/scenarios"
              element={<Navigate to={`/${activeCityId}/scenarios`} replace />}
            />

            {/* Root Path: / -> defaults to defaultCity/map */}
            <Route
              path="/"
              element={<Navigate to={`/${activeCityId}/map`} replace />}
            />

            {/* Fallback Catch-all */}
            <Route
              path="*"
              element={<Navigate to={`/${activeCityId}/map`} replace />}
            />
          </Routes>
        )}
      </main>

      {/* Global Modals & Drawers */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      <MethodologyDrawer
        isOpen={showMethodology}
        onClose={() => setShowMethodology(false)}
        city={activeCityId}
        cityInfo={activeCityInfo}
      />
    </div>
  );
}

export default App;
