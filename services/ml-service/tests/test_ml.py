"""Unit tests for ML feature extraction, models, leakage prevention, and SHAP additivity."""

import os
import sys
import numpy as np
import pandas as pd
import pytest

# Add parent directory to path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_DIR = os.path.dirname(CURRENT_DIR)
if SERVICE_DIR not in sys.path:
    sys.path.insert(0, SERVICE_DIR)

from features.extraction import compute_time_domain_features, compute_frequency_domain_features
from features.windowing import segment_and_extract_features
from models.random_forest import train_and_evaluate_random_forest
from models.isolation_forest import train_and_evaluate_isolation_forest


def test_time_domain_formulas_on_pure_sine_wave():
    """Verify time-domain feature math against analytical sinusoidal wave properties."""
    # A * sin(t) with A = 2.0
    A = 2.0
    t = np.linspace(0, 4 * np.pi, 2000, endpoint=False)
    sine_signal = A * np.sin(t)

    features = compute_time_domain_features(sine_signal)

    # 1. Analytical RMS for sine wave is A / sqrt(2) = 2 / 1.4142 = 1.4142
    expected_rms = A / np.sqrt(2)
    assert abs(features["rms"] - expected_rms) < 0.01

    # 2. Peak-to-Peak is 2 * A = 4.0
    assert abs(features["peak_to_peak"] - 4.0) < 0.02

    # 3. Crest Factor is max(|x|) / RMS = A / (A / sqrt(2)) = sqrt(2) ≈ 1.4142
    assert abs(features["crest_factor"] - np.sqrt(2)) < 0.02

    # 4. Kurtosis for pure sine is -1.5 (Fisher's definition)
    assert abs(features["kurtosis"] - (-1.5)) < 0.05

    # 5. Skewness for symmetric sine is 0.0
    assert abs(features["skewness"]) < 0.01


def test_frequency_domain_gmf_derivation():
    """Verify Gear Mesh Frequency (GMF) calculation when shaft speed and pinion teeth are provided."""
    # 1500 RPM, 20 pinion teeth -> GMF = (1500 / 60) * 20 = 500 Hz
    fs = 5000.0  # 5 kHz sampling rate
    t = np.linspace(0, 0.5, 2500, endpoint=False)
    # Signal with 500 Hz dominant gear mesh vibration
    vib = 1.5 * np.sin(2 * np.pi * 500 * t) + 0.2 * np.random.randn(len(t))

    fd = compute_frequency_domain_features(
        vib,
        sampling_rate_hz=fs,
        shaft_speed_rpm=1500.0,
        pinion_teeth=20
    )

    assert fd["component_frequencies_derived"] is True
    assert fd["gmf_hz"] == 500.0
    assert fd["gmf_band_energy"] > 0.0
    assert abs(fd["spectral_centroid_hz"] - 500.0) < 50.0


def test_windowing_and_leakage_group_partition():
    """Verify that windowing segments preserve run IDs and metadata outside feature matrix."""
    # Create synthetic multi-run DataFrame
    data = []
    for run in [1, 2, 3, 4]:
        for i in range(300):
            data.append({
                "timestamp": f"2026-11-01T{run:02d}:{i:02d}:00Z",
                "vib_radial": 1.0 + run * 0.2 + np.random.randn() * 0.1,
                "run_id": f"RUN_{run}",
                "fault_mode": "healthy" if run <= 2 else "gear_pitting"
            })
    df = pd.DataFrame(data)

    X, y, meta = segment_and_extract_features(
        df=df,
        signal_columns=["vib_radial"],
        timestamp_col="timestamp",
        label_col="fault_mode",
        run_id_col="run_id",
        window_size=128,
        overlap_ratio=0.5
    )

    # 1. Feature matrix must NOT contain run_id, timestamp, or label
    assert "run_id" not in X.columns
    assert "timestamp" not in X.columns
    assert "fault_mode" not in X.columns

    # 2. Metadata must preserve run_id
    assert "run_id" in meta.columns
    assert set(meta["run_id"].unique()) == {"RUN_1", "RUN_2", "RUN_3", "RUN_4"}

    # 3. Label array must match window length
    assert len(y) == len(X)
    assert len(meta) == len(X)


def test_random_forest_training_and_shap_additivity():
    """Train Random Forest on distinct fault classes and verify exact TreeSHAP additivity."""
    np.random.seed(42)
    # Generate 6 independent runs, each with balanced samples of 3 distinct classes
    runs = []
    labels = []
    X_list = []
    for r in range(6):
        for c_idx, c_name in enumerate(["healthy", "inner_race_defect", "broken_tooth"]):
            samples = np.random.randn(15, 8)
            if c_idx == 1:
                samples[:, 0] += 5.0
            elif c_idx == 2:
                samples[:, 1] += 5.0
            X_list.append(samples)
            labels.extend([c_name] * 15)
            runs.extend([f"RUN_{r}"] * 15)

    X = pd.DataFrame(np.vstack(X_list), columns=[f"feat_{i}" for i in range(8)])
    y = np.array(labels)
    meta = pd.DataFrame({"run_id": runs})

    results = train_and_evaluate_random_forest(X, y, meta, random_state=42, n_estimators=50)

    # Evaluation metrics
    assert results["evaluation"]["accuracy"] > 0.85
    assert results["evaluation"]["macro_f1"] > 0.85
    assert len(results["evaluation"]["classes"]) == 3

    # SHAP checks
    shap_info = results["shap_explanation"]
    assert shap_info["additivity_verified"] is True
    assert shap_info["max_additivity_discrepancy"] < 1e-4
    assert len(shap_info["top_contributing_features"]) > 0


def test_isolation_forest_baseline_calibration_and_shap():
    """Train Isolation Forest on baseline healthy telemetry and verify anomaly score calibration."""
    np.random.seed(42)
    # 200 normal samples, 30 anomalous samples
    normal_data = np.random.randn(200, 6)
    anomaly_data = np.random.randn(30, 6) + 4.0  # Large deviation
    all_data = np.vstack([normal_data, anomaly_data])
    labels = np.array(["healthy"] * 200 + ["severe_defect"] * 30)

    X = pd.DataFrame(all_data, columns=[f"signal_stat_{i}" for i in range(6)])
    meta = pd.DataFrame({"run_id": [f"BATCH_{i // 50}" for i in range(len(X))]})

    results = train_and_evaluate_isolation_forest(
        X, y=labels, metadata=meta, contamination=0.08, random_state=42
    )

    eval_res = results["evaluation"]
    assert "calibrated_decision_threshold" in eval_res
    assert "false_positive_rate_healthy" in eval_res
    assert "fault_recall_anomalous" in eval_res
    # Fault recall should be high on distinct outlier distribution
    assert eval_res["fault_recall_anomalous"] > 0.70
    assert eval_res["roc_auc_score"] > 0.85

    # SHAP additivity check for Isolation Forest
    shap_info = results["shap_explanation"]
    assert shap_info["additivity_verified"] is True
    assert shap_info["max_additivity_discrepancy"] < 1e-4


def test_random_forest_rejects_single_class():
    """Verify that Random Forest raises clear ValueError if attempted on single-class data."""
    X = pd.DataFrame(np.random.randn(60, 4), columns=["a", "b", "c", "d"])
    y = np.array(["healthy"] * 60)
    meta = pd.DataFrame({"run_id": [0] * 60})

    with pytest.raises(ValueError, match="at least 2 distinct classes"):
        train_and_evaluate_random_forest(X, y, meta)

