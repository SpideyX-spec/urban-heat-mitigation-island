"""
Unit and integration tests for scenario simulation performance and caching.
Tests model/scaler preloading, in-memory dataset reuse, prediction consistency,
and graceful failure handling.
"""

import time
import unittest
from unittest.mock import patch
from pathlib import Path

from models.simulate import (
    simulate_scenario,
    preload_resources,
    clear_simulation_cache,
    get_shared_resources,
    get_city_simulation_data,
    load_preset_scenarios,
    _city_cache,
    _model_cache,
)


class TestScenarioSimulationCaching(unittest.TestCase):

    def setUp(self):
        # Reset cache before each test to ensure isolated conditions
        clear_simulation_cache()

    def tearDown(self):
        clear_simulation_cache()

    def test_shared_resources_lazy_loading(self):
        """Test that get_shared_resources loads artifacts once and caches in memory."""
        # Cache should be empty initially
        model1, scaler1, names1 = get_shared_resources()
        self.assertIsNotNone(model1)
        self.assertIsNotNone(scaler1)
        self.assertIsInstance(names1, list)
        self.assertGreater(len(names1), 0)

        # Subsequent call must return identical cached object references
        model2, scaler2, names2 = get_shared_resources()
        self.assertIs(model1, model2)
        self.assertIs(scaler1, scaler2)
        self.assertIs(names1, names2)

    def test_preload_resources(self):
        """Test that preload_resources pre-populates shared model and requested city data."""
        status = preload_resources(cities=["new_delhi"])
        self.assertTrue(status["model_loaded"])
        self.assertTrue(status["scaler_loaded"])
        self.assertIn("new_delhi", status["preloaded_cities"])
        self.assertEqual(len(status["errors"]), 0)

        # Verify city is in in-memory cache
        self.assertIn("new_delhi", _city_cache)
        cached_delhi = _city_cache["new_delhi"]
        self.assertIn("features_df", cached_delhi)
        self.assertIn("lst_original", cached_delhi)
        self.assertIn("default_targets", cached_delhi)

    def test_prediction_consistency(self):
        """Test that cached simulation produces exact same results across repeated calls."""
        interventions = {"tree_cover": 0.5, "cool_roofs": 0.3}

        # Run 1: Cold run
        result_cold = simulate_scenario(city_id="new_delhi", interventions=interventions)

        # Run 2: Warm/cached run
        result_warm = simulate_scenario(city_id="new_delhi", interventions=interventions)

        # Compare summaries
        self.assertEqual(result_cold["summary"]["cells_modified"], result_warm["summary"]["cells_modified"])
        self.assertEqual(result_cold["summary"]["mean_cooling_c"], result_warm["summary"]["mean_cooling_c"])
        self.assertEqual(result_cold["summary"]["max_cooling_c"], result_warm["summary"]["max_cooling_c"])
        self.assertEqual(result_cold["summary"]["hotspots_before"], result_warm["summary"]["hotspots_before"])
        self.assertEqual(result_cold["summary"]["hotspots_after"], result_warm["summary"]["hotspots_after"])
        self.assertEqual(result_cold["summary"]["cost_estimate_m"], result_warm["summary"]["cost_estimate_m"])

        # Compare cell results
        self.assertEqual(len(result_cold["cell_results"]), len(result_warm["cell_results"]))
        for c1, c2 in zip(result_cold["cell_results"][:50], result_warm["cell_results"][:50]):
            self.assertEqual(c1["grid_id"], c2["grid_id"])
            self.assertEqual(c1["lst_before"], c2["lst_before"])
            self.assertEqual(c1["lst_after"], c2["lst_after"])
            self.assertEqual(c1["delta_t"], c2["delta_t"])
            self.assertEqual(c1["tier_before"], c2["tier_before"])
            self.assertEqual(c1["tier_after"], c2["tier_after"])

    def test_custom_target_cells_with_cache(self):
        """Test that supplying custom target cells works properly with cached baseline."""
        city_data = get_city_simulation_data("new_delhi")
        some_targets = city_data["grid_ids"][:5].tolist()

        result = simulate_scenario(
            city_id="new_delhi",
            interventions={"tree_cover": 0.4},
            target_cells=some_targets
        )

        self.assertEqual(result["summary"]["cells_modified"], 5)
        # Verify only targeted cells experienced cooling
        modified_gids = {r["grid_id"] for r in result["cell_results"] if r["delta_t"] != 0}
        self.assertTrue(modified_gids.issubset(set(some_targets)))

    def test_targeting_scopes_hotspots_vs_all(self):
        """Test default hotspots targeting vs entire-city targeting."""
        city_data = get_city_simulation_data("new_delhi")
        total_cells = len(city_data["grid_ids"])
        hotspots_count = len(city_data["default_targets"])

        # Scope 1: Default Hotspots (None)
        res_hotspots = simulate_scenario(
            city_id="new_delhi",
            interventions={"tree_cover": 0.5},
            target_cells=None
        )
        self.assertEqual(res_hotspots["summary"]["cells_modified"], hotspots_count)

        # Scope 2: Entire City (["all"])
        res_all = simulate_scenario(
            city_id="new_delhi",
            interventions={"tree_cover": 0.5},
            target_cells=["all"]
        )
        self.assertEqual(res_all["summary"]["cells_modified"], total_cells)
        self.assertGreater(res_all["summary"]["cost_estimate_m"], res_hotspots["summary"]["cost_estimate_m"])

    def test_performance_speedup(self):
        """Benchmark cold run vs warm cached run to demonstrate latency improvement."""
        interventions = {"tree_cover": 0.3}

        # Cold run (loads model, scaler, parquet, calculates baseline)
        t0 = time.perf_counter()
        simulate_scenario(city_id="new_delhi", interventions=interventions)
        cold_duration = time.perf_counter() - t0

        # Warm runs (reuses cached model, scaler, baseline)
        warm_times = []
        for _ in range(5):
            t1 = time.perf_counter()
            simulate_scenario(city_id="new_delhi", interventions=interventions)
            warm_times.append(time.perf_counter() - t1)

        avg_warm = sum(warm_times) / len(warm_times)

        # Warm runs should be significantly faster than cold run
        print(f"\n[Benchmark] Cold simulation: {cold_duration*1000:.1f}ms | Avg Warm simulation: {avg_warm*1000:.1f}ms (Speedup: {cold_duration/avg_warm:.1f}x)")
        self.assertLess(avg_warm, cold_duration)

    def test_graceful_missing_city_handling(self):
        """Test that invalid city identifiers raise a clean FileNotFoundError."""
        with self.assertRaises(FileNotFoundError) as ctx:
            simulate_scenario(city_id="non_existent_city_xyz", interventions={"tree_cover": 0.2})
        self.assertIn("non_existent_city_xyz", str(ctx.exception))

    def test_graceful_preload_error_handling(self):
        """Test that preload_resources records errors without throwing exceptions."""
        status = preload_resources(cities=["non_existent_city_1", "non_existent_city_2"])
        self.assertTrue(status["model_loaded"])
        self.assertEqual(len(status["preloaded_cities"]), 0)
        self.assertEqual(len(status["errors"]), 2)
        self.assertIn("non_existent_city_1", status["errors"][0])

    def test_presets_caching(self):
        """Test that presets are loaded and cached in memory."""
        presets1 = load_preset_scenarios("new_delhi")
        self.assertIsInstance(presets1, list)
        self.assertGreater(len(presets1), 0)

        # Second call returns the exact cached object
        presets2 = load_preset_scenarios("new_delhi")
        self.assertIs(presets1, presets2)


if __name__ == "__main__":
    unittest.main()
