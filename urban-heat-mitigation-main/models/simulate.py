"""
Cooling Scenario Simulation Engine

Modifies feature vectors per intervention rules, re-predicts LST
using the trained model, and computes cooling deltas.
Includes thread-safe application-level caching for models, scalers,
and city feature datasets.
"""

import json
import logging
import threading
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from pipeline.config import (
    MODEL_FILE, SCALER_FILE, MODEL_DIR,
    INTERVENTIONS, city_features_file, city_presets_file
)

logger = logging.getLogger("uvicorn.error")

# ─── Thread-Safe Application Cache ──────────────────────────────
_cache_lock = threading.Lock()

_model_cache = None          # loaded xgb.XGBRegressor
_scaler_cache = None         # loaded joblib scaler
_feature_names_cache = None  # list of feature column names
_city_cache = {}             # city_id -> cached baseline dict
_presets_cache = {}          # city_id -> cached presets list


def classify_lst(lst: float, mean: float, std: float) -> str:
    """Classify a temperature value into heat tiers relative to city baseline."""
    if lst > mean + 2 * std:
        return "critical"
    elif lst > mean + 1 * std:
        return "high"
    elif lst > mean:
        return "moderate"
    elif lst > mean - 1 * std:
        return "normal"
    else:
        return "cool"


def get_shared_resources(force_reload: bool = False):
    """
    Thread-safe access to shared model artifacts: (model, scaler, feature_names).
    Loads once on first use and caches in memory.
    """
    global _model_cache, _scaler_cache, _feature_names_cache

    if not force_reload and _model_cache is not None and _scaler_cache is not None and _feature_names_cache is not None:
        return _model_cache, _scaler_cache, _feature_names_cache

    with _cache_lock:
        if not force_reload and _model_cache is not None and _scaler_cache is not None and _feature_names_cache is not None:
            return _model_cache, _scaler_cache, _feature_names_cache

        if not MODEL_FILE.exists():
            raise FileNotFoundError(f"Trained model artifact not found at {MODEL_FILE}")
        if not SCALER_FILE.exists():
            raise FileNotFoundError(f"Scaler artifact not found at {SCALER_FILE}")

        feature_names_file = MODEL_DIR / "feature_names.json"
        if not feature_names_file.exists():
            raise FileNotFoundError(f"Feature names file not found at {feature_names_file}")

        import xgboost as xgb
        import joblib

        logger.info(f"Loading shared model artifacts into cache from {MODEL_DIR}...")
        model = xgb.XGBRegressor()
        model.load_model(str(MODEL_FILE))

        scaler = joblib.load(SCALER_FILE)

        with open(feature_names_file, "r") as f:
            feature_names = json.load(f)

        _model_cache = model
        _scaler_cache = scaler
        _feature_names_cache = feature_names

        return _model_cache, _scaler_cache, _feature_names_cache


def get_city_simulation_data(city_id: str, force_reload: bool = False) -> dict:
    """
    Thread-safe access to cached city features, precomputed baseline predictions,
    and tier classifications.
    """
    if not force_reload and city_id in _city_cache:
        return _city_cache[city_id]

    with _cache_lock:
        if not force_reload and city_id in _city_cache:
            return _city_cache[city_id]

        feat_path = city_features_file(city_id)
        if not feat_path.exists():
            raise FileNotFoundError(f"Features file for city '{city_id}' not found at {feat_path}")

        model, scaler, feature_names = get_shared_resources()

        logger.info(f"Loading and precomputing baseline for city '{city_id}' into cache...")
        features_df = pd.read_parquet(feat_path)
        grid_ids = features_df["grid_id"].values

        # Precompute baseline predictions once per city
        X_original = features_df[feature_names].fillna(0)
        X_orig_scaled = scaler.transform(X_original)
        lst_original = model.predict(X_orig_scaled)

        mean_lst_orig = float(lst_original.mean())
        std_lst_orig = float(lst_original.std())

        tiers_before = [classify_lst(l, mean_lst_orig, std_lst_orig) for l in lst_original]
        default_targets = [
            gid for gid, t in zip(grid_ids, tiers_before) if t in ("critical", "high")
        ]

        city_data = {
            "features_df": features_df,
            "grid_ids": grid_ids,
            "lst_original": lst_original,
            "mean_lst_orig": mean_lst_orig,
            "std_lst_orig": std_lst_orig,
            "tiers_before": tiers_before,
            "default_targets": default_targets,
        }

        _city_cache[city_id] = city_data
        return city_data


def load_model_and_data(city_id: str):
    """
    Backwards-compatible loader backed by the in-memory cache.
    Returns (model, scaler, features_df, feature_names).
    """
    model, scaler, feature_names = get_shared_resources()
    city_data = get_city_simulation_data(city_id)
    return model, scaler, city_data["features_df"], feature_names


def preload_resources(cities: Optional[list[str]] = None) -> dict:
    """
    Preload model artifacts and optional city datasets into memory.
    Handles missing files and errors gracefully without crashing the application.
    """
    status = {
        "model_loaded": False,
        "scaler_loaded": False,
        "preloaded_cities": [],
        "errors": []
    }

    try:
        get_shared_resources()
        status["model_loaded"] = True
        status["scaler_loaded"] = True
    except Exception as e:
        err_msg = f"Failed to preload shared ML model artifacts: {e}"
        logger.warning(err_msg)
        status["errors"].append(err_msg)

    if cities:
        for c in cities:
            try:
                get_city_simulation_data(c)
                status["preloaded_cities"].append(c)
            except Exception as e:
                err_msg = f"Failed to preload city '{c}': {e}"
                logger.warning(err_msg)
                status["errors"].append(err_msg)

    return status


def clear_simulation_cache():
    """Clear all in-memory caches (used for tests or reloading updated artifacts)."""
    global _model_cache, _scaler_cache, _feature_names_cache
    with _cache_lock:
        _model_cache = None
        _scaler_cache = None
        _feature_names_cache = None
        _city_cache.clear()
        _presets_cache.clear()


def apply_intervention(features: pd.DataFrame, intervention: str,
                       intensity: float, target_cells: list[str] = None) -> pd.DataFrame:
    """
    Apply a cooling intervention by modifying feature values.
    
    Args:
        features: DataFrame of grid cell features
        intervention: intervention key from INTERVENTIONS config
        intensity: 0.0 to 1.0 (fraction of maximum intervention)
        target_cells: list of grid_ids to modify (None = all hotspots)
    
    Returns:
        Modified features DataFrame
    """
    if intervention not in INTERVENTIONS:
        raise ValueError(f"Unknown intervention: {intervention}")

    modified = features.copy()
    config = INTERVENTIONS[intervention]

    # Determine target mask
    if target_cells:
        mask = modified["grid_id"].isin(target_cells)
    else:
        # Default: apply to hotspot cells
        mask = modified["tier"].isin(["critical", "high"])

    if mask.sum() == 0:
        return modified

    # Apply feature modifications
    for feature, max_delta in config["feature_mods"].items():
        if feature not in modified.columns:
            continue

        delta = max_delta * intensity

        if feature in ["solar_radiation"]:
            # Fractional modification
            modified.loc[mask, feature] *= (1 + delta)
        elif feature in ["dist_to_water"]:
            # Absolute modification (reduce distance)
            modified.loc[mask, feature] = np.clip(
                modified.loc[mask, feature] + delta, 50, 10000
            )
        else:
            # Additive modification, clamp to [0, 1] for fractions
            modified.loc[mask, feature] = np.clip(
                modified.loc[mask, feature] + delta, 0, 1
            )

    return modified


def simulate_scenario(city_id: str, interventions: dict[str, float],
                      target_cells: list[str] = None) -> dict:
    """
    Simulate a complete cooling scenario for one city, with one or more
    interventions. Reuses cached model, scaler, and baseline data.

    Args:
        city_id: which city's feature data to simulate on
        interventions: dict of {intervention_name: intensity}
        target_cells: optional list of grid_ids

    Returns:
        Scenario results dict with summary and per-cell details
    """
    model, scaler, feature_names = get_shared_resources()
    city_data = get_city_simulation_data(city_id)

    features_df = city_data["features_df"]
    grid_ids = city_data["grid_ids"]
    lst_original = city_data["lst_original"]
    mean_lst_orig = city_data["mean_lst_orig"]
    std_lst_orig = city_data["std_lst_orig"]
    tiers_before = city_data["tiers_before"]

    # Resolve target cells
    if target_cells:
        resolved_targets = list(target_cells)
    else:
        resolved_targets = city_data["default_targets"]

    target_mask = np.isin(grid_ids, resolved_targets)
    n_target = int(target_mask.sum())

    # Apply all interventions on a fresh copy of the cached features
    modified_df = features_df.copy()
    for intervention, intensity in interventions.items():
        modified_df = apply_intervention(modified_df, intervention, intensity, resolved_targets)

    # Re-predict on the modified features
    X_modified = modified_df[feature_names].fillna(0)
    X_mod_scaled = scaler.transform(X_modified)
    lst_modified = model.predict(X_mod_scaled)

    delta_t = lst_modified - lst_original
    tiers_after = [classify_lst(l, mean_lst_orig, std_lst_orig) for l in lst_modified]

    hotspots_before = sum(1 for t in tiers_before if t in ["critical", "high"])
    hotspots_after = sum(1 for t in tiers_after if t in ["critical", "high"])

    # Cost estimate, based on the area actually targeted
    area_km2 = n_target * 0.25  # each cell is 0.25 km²
    total_cost = sum(
        INTERVENTIONS[k]["cost_per_km2_million"] * v * area_km2
        for k, v in interventions.items()
        if k in INTERVENTIONS
    )

    delta_t_targeted = delta_t[target_mask] if n_target > 0 else delta_t

    # Build cell results (vectorized)
    cell_results = [
        {
            "grid_id": gid,
            "lst_before": round(float(lb), 2),
            "lst_after": round(float(la), 2),
            "delta_t": round(float(dt), 2),
            "tier_before": tb,
            "tier_after": ta,
        }
        for gid, lb, la, dt, tb, ta in zip(
            grid_ids, lst_original, lst_modified, delta_t, tiers_before, tiers_after
        )
    ]

    return {
        "summary": {
            "cells_modified": n_target,
            "mean_cooling_c": round(float(delta_t_targeted.mean()), 2),
            "max_cooling_c": round(float(delta_t_targeted.min()), 2),
            "hotspots_before": hotspots_before,
            "hotspots_after": hotspots_after,
            "hotspot_reduction_pct": round(
                (hotspots_before - hotspots_after) / max(hotspots_before, 1) * 100, 1
            ),
            "cost_estimate_m": round(total_cost, 1),
            "cost_efficiency_c_per_m": round(
                abs(float(delta_t_targeted.mean())) / max(total_cost, 0.1), 3
            ) if total_cost > 0 else 0,
        },
        "cell_results": cell_results,
    }


def load_preset_scenarios(city_id: str, force_reload: bool = False):
    """Load pre-computed scenario results for one city, cached in memory."""
    if not force_reload and city_id in _presets_cache:
        return _presets_cache[city_id]

    presets_file = city_presets_file(city_id)
    if not presets_file.exists():
        return []
    with open(presets_file, "r") as f:
        data = json.load(f)
    _presets_cache[city_id] = data
    return data
