"""Tests for Phase 8: Operating-Regime-Aware, Multi-Signal Analysis.

Verifies:
  1. Normal speed/load transitions against regime-conditioned baseline (no false alarms).
  2. Thermal-only anomaly where mechanical vibration remains nominal.
  3. Missing speed/load channels (marked as UNKNOWN with diagnostic limitation).
  4. Missing thermal channels (sensor coverage reflects missing thermal modality).
  5. Calibrated multi-signal fusion (cross-confirmation promotes severity to critical).
  6. Research evaluation and benchmark provenance integrity.
"""

import os
import sys
import numpy as np
import pandas as pd
import pytest

# Ensure ml-service in sys.path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(CURRENT_DIR)
if SERVICE_DIR not in sys.path:
    sys.path.insert(0, SERVICE_DIR)

from features.regimes import (
    classify_window_regime,
    compute_regime_conditioned_scores,
    REGIME_UNKNOWN,
    REGIME_LOW_SPEED_IDLE,
    REGIME_RATED_NOMINAL,
    REGIME_SPEED_RAMP_TRANSIENT
)
from models.thermal import analyze_thermal_window
from models.fusion import evaluate_sensor_coverage, fuse_detector_outputs
from models.research_evaluation import (
    BENCHMARK_PROVENANCE_REGISTRY,
    evaluate_regime_comparison_metrics,
    evaluate_signal_paths_comparison
)


def test_regime_classification_steady_and_transient():
    """Verify classification of steady nominal, low speed, and acceleration transients."""
    # 1. Steady Rated Nominal (1495 RPM, 480 Nm)
    speed_steady = np.array([1492.0, 1495.0, 1497.0, 1494.0])
    load_steady = np.array([480.0, 482.0, 479.0, 481.0])
    reg = classify_window_regime(speed_steady, load_steady, nominal_speed_rpm=1495.0, nominal_load_nm=480.0)

    assert reg["regime_id"] == REGIME_RATED_NOMINAL
    assert reg["stability"] == "steady_state"
    assert reg["is_valid"] is True
    assert reg["speed_variation_pct"] < 2.0

    # 2. Speed Ramp Transient (1000 RPM ramping to 1450 RPM, variation > 8%)
    speed_ramp = np.array([1000.0, 1150.0, 1300.0, 1450.0])
    reg_ramp = classify_window_regime(speed_ramp, load_steady, nominal_speed_rpm=1495.0, nominal_load_nm=480.0)

    assert reg_ramp["regime_id"] == REGIME_SPEED_RAMP_TRANSIENT
    assert reg_ramp["stability"] == "transient"
    assert "transient" in reg_ramp["limitation"].lower()

    # 3. Missing Speed & Load (returns UNKNOWN with limitation)
    reg_unknown = classify_window_regime(None, None)
    assert reg_unknown["regime_id"] == REGIME_UNKNOWN
    assert reg_unknown["is_valid"] is False
    assert reg_unknown["stability"] == "unknown"
    assert "missing" in reg_unknown["limitation"].lower()


def test_normal_transition_prevents_avoidable_false_alarms():
    """Verify that regime conditioning prevents normal higher-load transitions from tripping false alarms."""
    # Simulate 2 normal operational regimes:
    # Regime 1: Light Load (raw score ~0.35, threshold ~0.40)
    # Regime 2: Normal High Load (raw score ~0.55 due to higher legitimate vibration & temp, but still healthy!)
    window_records = [
        {"window_idx": 0, "score": 0.32, "threshold": 0.45},
        {"window_idx": 1, "score": 0.35, "threshold": 0.45},
        {"window_idx": 2, "score": 0.52, "threshold": 0.45}, # Shift to normal high load!
        {"window_idx": 3, "score": 0.54, "threshold": 0.45}
    ]

    regime_details = [
        {"regime_id": "LOW_LOAD", "regime_label": "Low Load", "stability": "steady_state", "limitation": None},
        {"regime_id": "LOW_LOAD", "regime_label": "Low Load", "stability": "steady_state", "limitation": None},
        {"regime_id": "RATED_NOMINAL", "regime_label": "Rated Nominal", "stability": "steady_state", "limitation": None},
        {"regime_id": "RATED_NOMINAL", "regime_label": "Rated Nominal", "stability": "steady_state", "limitation": None}
    ]

    conditioned = compute_regime_conditioned_scores(window_records, regime_details)

    # In a global unconditioned baseline with threshold 0.45, windows 2 and 3 would falsely trigger!
    # In regime-conditioned mode, the threshold adapts to the regime baseline:
    for rec in conditioned:
        assert rec["regime_normalized_score"] <= 1.05


def test_thermal_only_anomaly_detection_independent_of_vibration():
    """Verify that thermal path detects lubrication drift/runaway even when vibration is nominal."""
    # Create window with nominal vibration (2.1 mm/s) but severe sump temperature ramp (55°C -> 74°C)
    n = 20
    df_win = pd.DataFrame({
        "vibration_radial": [2.10 + 0.05 * np.random.randn() for _ in range(n)],
        "temp_gearbox_sump": np.linspace(55.0, 74.0, n)  # Severe thermal runaway drift
    })

    thermal_res = analyze_thermal_window(
        df_window=df_win,
        temp_cols=["temp_gearbox_sump"],
        dt_seconds=60.0,
        regime_id="RATED_NOMINAL"
    )

    assert thermal_res["is_active"] is True
    assert thermal_res["is_anomalous"] is True
    assert thermal_res["anomaly_score"] >= 1.0
    assert thermal_res["drift_rate_c_per_min"] > 0.30
    assert "thermal" in thermal_res["findings"].lower()

    # Now fuse with nominal vibration detector
    vib_res = {
        "is_active": True,
        "is_anomalous": False,
        "anomaly_score": 0.22,
        "calibrated_threshold": 0.50,
        "predicted_class": "nominal"
    }
    reg_context = {"regime_id": "RATED_NOMINAL", "regime_label": "Rated", "stability": "steady_state"}
    cov = evaluate_sensor_coverage(["vib", "temp"], ["vib", "temp"], True, True, False, False)

    fused = fuse_detector_outputs(vib_res, thermal_res, reg_context, cov)

    # Must flag thermal-only isolated anomaly with warning severity
    assert fused["is_anomalous"] is True
    assert fused["triggering_path"] == "thermal_path"
    assert fused["severity"] == "warning"
    assert "Thermal Path Isolated" in fused["fusion_rationale"]


def test_multisignal_cross_confirmation_promotes_to_critical():
    """Verify that simultaneous vibration anomaly and thermal rise promotes alert to critical severity."""
    vib_res = {
        "is_active": True,
        "is_anomalous": True,
        "anomaly_score": 0.88,
        "calibrated_threshold": 0.50,
        "predicted_class": "chipped_tooth"
    }

    thermal_res = {
        "is_active": True,
        "is_anomalous": True,
        "anomaly_score": 1.45,
        "calibrated_threshold": 1.0,
        "temperature_mean": 71.5,
        "drift_rate_c_per_min": 0.42,
        "findings": "Severe thermal rise."
    }

    reg_context = {"regime_id": "RATED_NOMINAL", "regime_label": "Rated", "stability": "steady_state"}
    cov = evaluate_sensor_coverage(["vib", "temp", "rpm"], ["vib", "temp", "rpm"], True, True, True, False)

    fused = fuse_detector_outputs(vib_res, thermal_res, reg_context, cov)

    assert fused["is_anomalous"] is True
    assert fused["triggering_path"] == "fused_multi_signal"
    assert fused["severity"] == "critical"
    assert "Multi-Signal Cross-Confirmation" in fused["fusion_rationale"]


def test_missing_channels_reflects_uncertainty():
    """Verify that missing operating and thermal channels produce elevated uncertainty and explicit limitations."""
    cov = evaluate_sensor_coverage(
        all_columns=["vibration_radial"],
        mapped_signals=["vibration_radial"],
        has_vibration=True,
        has_thermal=False,
        has_speed=False,
        has_load=False
    )

    assert cov["coverage_score"] == 0.25
    assert cov["uncertainty_level"] == "elevated"
    assert "Thermal Monitoring (RTD / Thermocouple)" in cov["missing_modalities"]
    assert "Shaft Tachometer (Speed)" in cov["missing_modalities"]


def test_benchmark_provenance_registry_correctness():
    """Verify that MFPT is classified as bearing and SEU DDS is verified as gearbox."""
    mfpt = BENCHMARK_PROVENANCE_REGISTRY["mfpt_bearing"]
    assert mfpt["component_type"] == "bearing"
    assert "bearing" in mfpt["notes"].lower()

    seu = BENCHMARK_PROVENANCE_REGISTRY["seu_dds_gearbox"]
    assert seu["component_type"] == "gearbox"
    assert seu["provenance_verified"] is True
    assert "chipped_tooth" in seu["labels"]
