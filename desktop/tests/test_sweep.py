import unittest
from dataclasses import replace

from bike_workbench.analysis import Settings
from bike_workbench.sweep import run_sweep
from test_analysis import synthetic_ride


class SweepTests(unittest.TestCase):
    def test_support_is_not_a_probability_and_keeps_source_settings(self):
        report = run_sweep(synthetic_ride(), configurations=[Settings(), replace(Settings(), core_g=.5)])
        self.assertEqual(report["configuration_count"], 2)
        for profile in report["profiles"]:
            self.assertEqual(profile["candidate_count"], 1)
            self.assertEqual(profile["unique_impact_crossings"], 1)
            self.assertEqual(profile["events"][0]["neighborhood_support"], 1)
            self.assertFalse(profile["events"][0]["shares_impact_with_other_candidate"])
        self.assertIn("not measured accuracy", report["interpretation"])
