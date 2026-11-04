"""Unit tests for bearing benchmark pipelines (CWRU and NASA IMS).

Validates feature extraction, load-based train/test partitioning,
leakage-free holdout evaluation, Isolation Forest lead-time anomaly detection,
and strict machine domain separation between bearing benchmarks and gearbox testing.
"""

import os
import sys
import json
import numpy as np
import pytest
import joblib
import shap

# Add service directory to path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(CURRENT_DIR)
if SERVICE_DIR not in sys.path:
    sys.path.insert(0, SERVICE_DIR)

from bearing_benchmarks import extract_features_cwru, CWRU_FILES_MAP

BENCHMARKS_DIR = os.path.join(SERVICE_DIR, "artifacts", "benchmarks")
MODELS_DIR = os.path.join(SERVICE_DIR, "artifacts", "models")


def test_cwru_feature_extraction_math():
    """Verify that extract_features_cwru computes valid 11 time/frequency features."""
    fs = 12000.0  # 12 kHz CWRU sampling rate
    n = 2048
    t = np.linspace(0, n / fs, n, endpoint=False)
    # Synthetic bearing signal with 2 kHz carrier and small random background
    signal = 1.0 * np.sin(2 * np.pi * 2000.0 * t) + 0.1 * np.random.randn(n)

    feats = extract_features_cwru(signal, fs=fs)

    # 1. Essential vibration indicators present
    expected_keys = [
        "vib_rms", "vib_peak_to_peak", "vib_crest_factor", "vib_kurtosis",
        "vib_skewness", "vib_shape_factor", "vib_impulse_factor",
        "spectral_centroid", "band_power_low", "band_power_mid", "band_power_high"
    ]
    for k in expected_keys:
        assert k in feats, f"Missing feature {k}"
        assert np.isfinite(feats[k]), f"Feature {k} is non-finite: {feats[k]}"

    # 2. RMS of ~1.0 sin wave is ~0.707
    assert 0.65 < feats["vib_rms"] < 0.80

    # 3. Peak to peak is ~2.0
    assert 1.8 < feats["vib_peak_to_peak"] < 2.8

    # 4. Spectral centroid should be concentrated near the 2000 Hz carrier
    assert 1700.0 < feats["spectral_centroid"] < 2300.0

    # 5. Mid band (1-3 kHz) power should dominate low and high band power
    assert feats["band_power_mid"] > feats["band_power_low"]
    assert feats["band_power_mid"] > feats["band_power_high"]


def test_cwru_files_map_load_separation():
    """Verify CWRU files mapping has distinct 0, 1, 2 HP train and 3 HP test conditions."""
    train_loads = {0, 1, 2}
    test_loads = {3}

    train_files = [f for f in CWRU_FILES_MAP if f["load_hp"] in train_loads]
    test_files = [f for f in CWRU_FILES_MAP if f["load_hp"] in test_loads]

    assert len(train_files) == 12  # 4 faults * 3 load levels
    assert len(test_files) == 4    # 4 faults * 1 load level

    # Ensure no file appears in both
    train_names = {f["file"] for f in train_files}
    test_names = {f["file"] for f in test_files}
    assert train_names.isdisjoint(test_names)

    # Verify all 4 fault classes exist in both partitions
    train_faults = {f["fault"] for f in train_files}
    test_faults = {f["fault"] for f in test_files}
    expected_faults = {"normal", "inner_race", "ball", "outer_race"}
    assert train_faults == expected_faults
    assert test_faults == expected_faults


def test_cwru_evaluation_report_schema_and_domain_separation():
    """Verify saved CWRU evaluation report adheres to strict domain separation and truthfulness."""
    report_path = os.path.join(BENCHMARKS_DIR, "cwru_evaluation_report.json")
    assert os.path.exists(report_path), f"Report not found at {report_path}"

    with open(report_path, "r") as f:
        rep = json.load(f)

    # 1. Model identity and domain
    assert rep["model_id"] == "RF-Bearing-Fault v1.2"
    assert rep["machine_domain"] == "bearing"

    # 2. Split strategy must document load-based partition
    assert "Train on 0, 1, 2 HP" in rep["split_strategy"]
    assert "Test strictly on 3 HP" in rep["split_strategy"]

    # 3. Metrics presence and bounds
    metrics = rep["metrics"]
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert 0.0 <= metrics["macro_f1"] <= 1.0
    assert 0.0 <= metrics["false_alarm_rate"] <= 1.0
    assert "confusion_matrix" in metrics
    assert len(metrics["confusion_matrix"]["matrix"]) == 4

    # 4. TreeSHAP explanation metadata
    shap_summary = rep["shap_summary"]
    assert "TreeSHAP" in shap_summary["method"]
    assert len(shap_summary["feature_attributions"]) > 0
    assert "explanation method, not an accuracy score" in shap_summary["methodology_note"]

    # 5. Explicit limitations forbidding gearbox claim
    limitations = " ".join(rep["limitations"])
    assert "gearbox" in limitations.lower()
    assert "domain-specific" in limitations.lower()


def test_nasa_ims_evaluation_report_schema_and_lead_time():
    """Verify NASA IMS evaluation report documents unsupervised framing and lead time."""
    report_path = os.path.join(BENCHMARKS_DIR, "nasa_ims_evaluation_report.json")
    assert os.path.exists(report_path), f"Report not found at {report_path}"

    with open(report_path, "r") as f:
        rep = json.load(f)

    # 1. Model identity and domain
    assert rep["model_id"] == "IF-Bearing-Anomaly v1.0"
    assert rep["machine_domain"] == "bearing"
    assert "Isolation Forest" in rep["model_name"]

    # 2. Strict truthful framing: no fake accuracy percentage
    assert "no ground truth anomaly labels exist" in rep["accuracy_statement"].lower()
    assert "anomaly score represents statistical isolation" in rep["accuracy_statement"].lower()

    # 3. Lead time to failure detection
    detection = rep["lead_time"]
    assert detection["lead_time_hours"] > 24.0  # Detects 60 hours in advance
    assert detection["lead_time_days"] >= 2.0
    assert detection["first_sustained_flag_timestamp"] is not None

    # 4. Degradation trajectory samples
    timeline = rep["timeline_sample"]
    assert len(timeline) >= 20
    assert timeline[0]["is_flagged"] is False  # Baseline healthy
    assert timeline[-1]["is_flagged"] is True  # Final breakdown flagged


def test_bearing_model_artifacts_loadable():
    """Verify saved model joblib artifacts can be loaded and inspected."""
    rf_path = os.path.join(MODELS_DIR, "rf_bearing_fault_v1_2.joblib")
    assert os.path.exists(rf_path), f"RF model not found at {rf_path}"

    rf_artifact = joblib.load(rf_path)
    assert "model" in rf_artifact
    assert "scaler" in rf_artifact
    assert rf_artifact["version"] == "RF-Bearing-Fault v1.2"
    assert rf_artifact["target_domain"] == "bearing"
    assert len(rf_artifact["classes"]) == 4

    if_path = os.path.join(MODELS_DIR, "if_bearing_anomaly_v1_0.joblib")
    assert os.path.exists(if_path), f"IF model not found at {if_path}"

    if_artifact = joblib.load(if_path)
    assert "model" in if_artifact
    assert "scaler" in if_artifact
    assert if_artifact["version"] == "IF-Bearing-Anomaly v1.0"
    assert if_artifact["target_domain"] == "bearing"
    assert if_artifact["calibrated_threshold_normalized"] > 0.0
