// In production, set VITE_API_BASE_URL in your deployment platform's
// environment variables (e.g. https://your-backend.onrender.com).
// Locally, it falls back to your FastAPI dev server.
export const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ─── Shared In-Memory Cache & Request Deduplication ─────────────
// Prevents duplicate multi-megabyte GeoJSON downloads and JSON parsing
// when navigating between Map, Drivers, and Scenarios views.
const cache = new Map();
const inFlightRequests = new Map();

/**
 * Fetch JSON with in-memory caching and in-flight request deduplication.
 *
 * @param {string} url - Target URL to fetch
 * @param {object} options - Options including signal and maxAge (in ms)
 * @returns {Promise<any>}
 */
export async function fetchWithCache(url, options = {}) {
  const { maxAge = 10 * 60 * 1000, signal } = options;
  const now = Date.now();

  // Return fresh cached copy if available
  const cached = cache.get(url);
  if (cached && now - cached.timestamp < maxAge) {
    return cached.data;
  }

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  // Deduplicate concurrent requests for the exact same resource
  let promise = inFlightRequests.get(url);
  if (!promise) {
    promise = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Failed to fetch ${url}`);
        }
        const data = await res.json();
        cache.set(url, { data, timestamp: Date.now() });
        return data;
      } finally {
        inFlightRequests.delete(url);
      }
    })();
    inFlightRequests.set(url, promise);
  }

  if (!signal) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then((data) => {
        signal.removeEventListener('abort', onAbort);
        resolve(data);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

/**
 * Fetch city grid GeoJSON with shared caching.
 */
export function fetchCityGrid(city, signal) {
  return fetchWithCache(`${API_BASE}/api/v1/grid?city=${city}`, {
    signal,
    maxAge: 15 * 60 * 1000 // 15 minutes
  });
}

/**
 * Fetch city summary overview with shared caching.
 */
export function fetchCityOverview(city, signal) {
  return fetchWithCache(`${API_BASE}/api/v1/overview?city=${city}`, {
    signal,
    maxAge: 15 * 60 * 1000
  });
}

/**
 * Fetch precomputed scenario presets with shared caching.
 */
export function fetchCityPresets(city, signal) {
  return fetchWithCache(`${API_BASE}/api/v1/scenarios/presets?city=${city}`, {
    signal,
    maxAge: 15 * 60 * 1000
  });
}

/**
 * Fetch city model explainability (global SHAP) with shared caching.
 */
export function fetchCityDrivers(city, signal) {
  return fetchWithCache(`${API_BASE}/api/v1/drivers?city=${city}`, {
    signal,
    maxAge: 15 * 60 * 1000
  });
}

/**
 * Fetch hotspot-specific drivers with shared caching.
 */
export async function fetchCityHotspotDrivers(city, signal) {
  try {
    return await fetchWithCache(`${API_BASE}/api/v1/drivers/hotspot-drivers?city=${city}`, {
      signal,
      maxAge: 15 * 60 * 1000
    });
  } catch (err) {
    return null;
  }
}

/**
 * Fetch SHAP dependence data with shared caching.
 */
export async function fetchCityDependence(city, signal) {
  try {
    return await fetchWithCache(`${API_BASE}/api/v1/drivers/dependence?city=${city}`, {
      signal,
      maxAge: 15 * 60 * 1000
    });
  } catch (err) {
    return null;
  }
}

/**
 * Fetch optional Landsat satellite validation.
 * Non-blocking: failures or missing comparisons gracefully return null
 * without throwing errors or blocking the essential dashboard.
 */
export async function fetchCityValidation(city, signal) {
  try {
    const res = await fetch(`${API_BASE}/api/v1/validation?city=${city}`, { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    // Non-blocking best-effort call
    return null;
  }
}

/**
 * Clear cache for a specific city or clear entire store.
 */
export function clearCache(cityFilter) {
  if (!cityFilter) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(cityFilter)) {
      cache.delete(key);
    }
  }
}
