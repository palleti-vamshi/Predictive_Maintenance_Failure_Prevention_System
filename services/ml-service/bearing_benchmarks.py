"""Bearing Benchmark Pipelines for CWRU and NASA IMS Datasets.

Executes genuine, reproducible feature extraction, leakage-safe model training,
evaluation, and TreeSHAP attribution for:
  1. CWRU Bearing Data Center (Supervised Random Forest 4-class fault classifier)
     - Held-out evaluation split by motor load (Train on 0, 1, 2 HP; Test on 3 HP)
  2. NASA IMS Bearings (Unsupervised Isolation Forest run-to-failure anomaly detector)
     - Baseline calibration on initial 20% healthy run; lead-time detection tracking
"""

import os
import glob
import json
import datetime
from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd
import scipy.io
from scipy import stats
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    f1_score,
)
import shap
import joblib

from features.extraction import compute_time_domain_features, compute_frequency_domain_features

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW_CWRU_DIR = os.path.join(BASE_DIR, "data", "raw", "cwru")
RAW_NASA_DIR = os.path.join(BASE_DIR, "data", "raw", "nasa_ims")
PROCESSED_NASA_DIR = os.path.join(BASE_DIR, "data", "processed", "nasa_ims", "2nd_test")
ARTIFACTS_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
MODELS_DIR = os.path.join(ARTIFACTS_DIR, "models")
BENCHMARKS_DIR = os.path.join(ARTIFACTS_DIR, "benchmarks")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(BENCHMARKS_DIR, exist_ok=True)


# ==============================================================================
# 1. CWRU BEARING DATA CENTER BENCHMARK PIPELINE
# ==============================================================================

CWRU_FILES_MAP = [
    # Normal Baseline (0, 1, 2, 3 HP)
    {"file": "normal_0hp_97.mat", "fault": "normal", "load_hp": 0, "speed_rpm": 1797},
    {"file": "normal_1hp_98.mat", "fault": "normal", "load_hp": 1, "speed_rpm": 1772},
    {"file": "normal_2hp_99.mat", "fault": "normal", "load_hp": 2, "speed_rpm": 1750},
    {"file": "normal_3hp_100.mat", "fault": "normal", "load_hp": 3, "speed_rpm": 1730},
    # Inner Race 0.007" (0, 1, 2, 3 HP)
    {"file": "inner_race_0hp_105.mat", "fault": "inner_race", "load_hp": 0, "speed_rpm": 1797},
    {"file": "inner_race_1hp_106.mat", "fault": "inner_race", "load_hp": 1, "speed_rpm": 1772},
    {"file": "inner_race_2hp_107.mat", "fault": "inner_race", "load_hp": 2, "speed_rpm": 1750},
    {"file": "inner_race_3hp_108.mat", "fault": "inner_race", "load_hp": 3, "speed_rpm": 1730},
    # Ball Fault 0.007" (0, 1, 2, 3 HP)
    {"file": "ball_0hp_118.mat", "fault": "ball", "load_hp": 0, "speed_rpm": 1797},
    {"file": "ball_1hp_119.mat", "fault": "ball", "load_hp": 1, "speed_rpm": 1772},
    {"file": "ball_2hp_120.mat", "fault": "ball", "load_hp": 2, "speed_rpm": 1750},
    {"file": "ball_3hp_121.mat", "fault": "ball", "load_hp": 3, "speed_rpm": 1730},
    # Outer Race 0.007" Centered (0, 1, 2, 3 HP)
    {"file": "outer_race_0hp_130.mat", "fault": "outer_race", "load_hp": 0, "speed_rpm": 1797},
    {"file": "outer_race_1hp_131.mat", "fault": "outer_race", "load_hp": 1, "speed_rpm": 1772},
    {"file": "outer_race_2hp_132.mat", "fault": "outer_race", "load_hp": 2, "speed_rpm": 1750},
    {"file": "outer_race_3hp_133.mat", "fault": "outer_race", "load_hp": 3, "speed_rpm": 1730},
]


def extract_features_cwru(window: np.ndarray, fs: float = 12000.0) -> Dict[str, float]:
    """Compute 11 standard vibration indicators on a bearing signal window."""
    time_feats = compute_time_domain_features(window, prefix="vib")
    
    # FFT Frequency attributes
    x_centered = window - np.mean(window)
    win = np.hanning(len(window))
    fft_vals = np.fft.rfft(x_centered * win)
    freqs = np.fft.rfftfreq(len(window), d=1.0 / fs)
    mags = np.abs(fft_vals) / len(window)
    power = mags**2
    sum_power = np.sum(power)

    if sum_power > 1e-12:
        spectral_centroid = float(np.sum(freqs * power) / sum_power)
    else:
        spectral_centroid = 0.0

    # Band powers: Low (0-1 kHz), Mid (1-3 kHz), High (3-6 kHz)
    low_mask = (freqs >= 0) & (freqs < 1000)
    mid_mask = (freqs >= 1000) & (freqs < 3000)
    high_mask = (freqs >= 3000) & (freqs <= 6000)

    band_low = float(np.sum(power[low_mask]))
    band_mid = float(np.sum(power[mid_mask]))
    band_high = float(np.sum(power[high_mask]))

    time_feats.update({
        "spectral_centroid": spectral_centroid,
        "band_power_low": band_low,
        "band_power_mid": band_mid,
        "band_power_high": band_high,
    })
    return time_feats


def extract_windows_for_cwru_files(file_items: List[Dict[str, Any]], window_size: int = 2048, stride: int = 1024) -> pd.DataFrame:
    """Segment specific CWRU recording files into standardized feature windows with metadata."""
    rows = []
    
    for item in file_items:
        mat_path = os.path.join(RAW_CWRU_DIR, item["file"])
        if not os.path.exists(mat_path):
            raise FileNotFoundError(f"Missing required CWRU file: {mat_path}")
        
        data = scipy.io.loadmat(mat_path)
        # Find Drive End vibration channel
        de_keys = [k for k in data.keys() if "_DE_time" in k]
        if not de_keys:
            continue
        signal = data[de_keys[0]].flatten()
        
        n_samples = len(signal)
        n_windows = (n_samples - window_size) // stride + 1
        
        for w_idx in range(n_windows):
            start = w_idx * stride
            end = start + window_size
            window = signal[start:end]
            feats = extract_features_cwru(window, fs=12000.0)
            feats.update({
                "fault_class": item["fault"],
                "load_hp": item["load_hp"],
                "speed_rpm": item["speed_rpm"],
                "run_id": f"cwru_{item['fault']}_{item['load_hp']}hp",
                "source_file": item["file"]
            })
            rows.append(feats)

    return pd.DataFrame(rows)


def prepare_cwru_dataset(window_size: int = 2048, stride: int = 1024) -> pd.DataFrame:
    """Convenience helper to extract windows across all mapped CWRU files."""
    return extract_windows_for_cwru_files(CWRU_FILES_MAP, window_size=window_size, stride=stride)


def run_cwru_benchmark():
    """Train Random Forest classifier on CWRU with held-out motor load test partition."""
    print("Preparing CWRU benchmark dataset with strict pre-windowing recording separation...")
    # 1. PHYSICAL RECORDING-LEVEL SEPARATION BEFORE WINDOW CREATION:
    # Separate source recordings into train (0, 1, 2 HP) and test (3 HP) BEFORE window extraction.
    # Because slicing operates on distinct physical .mat files, adjacent/overlapping windows
    # from a recording CANNOT appear in both sets.
    train_file_items = [item for item in CWRU_FILES_MAP if item["load_hp"] in [0, 1, 2]]
    test_file_items = [item for item in CWRU_FILES_MAP if item["load_hp"] == 3]

    print(f"Separated physical source recordings: {len(train_file_items)} train files, {len(test_file_items)} test files.")
    df_train = extract_windows_for_cwru_files(train_file_items, window_size=2048, stride=1024)
    df_test = extract_windows_for_cwru_files(test_file_items, window_size=2048, stride=1024)

    # Verification: Confirm zero overlap of source files or run IDs between train and test
    train_source_files = set(df_train["source_file"].unique())
    test_source_files = set(df_test["source_file"].unique())
    assert train_source_files.isdisjoint(test_source_files), "Window leakage detected between train and test recordings!"

    total_windows = len(df_train) + len(df_test)
    print(f"Total extracted windows: {total_windows}")
    print(f"Training windows (0, 1, 2 HP across {len(train_file_items)} files): {len(df_train)}")
    print(f"Held-out test windows (3 HP across {len(test_file_items)} files): {len(df_test)}")
    print("Train class distribution:\n", df_train["fault_class"].value_counts())
    print("Test class distribution:\n", df_test["fault_class"].value_counts())

    feature_cols = [
        "vib_rms", "vib_peak_to_peak", "vib_crest_factor", "vib_kurtosis",
        "vib_skewness", "vib_shape_factor", "vib_impulse_factor",
        "spectral_centroid", "band_power_low", "band_power_mid", "band_power_high"
    ]

    X_train_raw = df_train[feature_cols].values
    y_train = df_train["fault_class"].values
    X_test_raw = df_test[feature_cols].values
    y_test = df_test["fault_class"].values

    # Preprocessing: Fit scaler on training partition ONLY
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_test = scaler.transform(X_test_raw)

    # Model training
    clf = RandomForestClassifier(
        n_estimators=100,
        max_depth=12,
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train)

    # Evaluation on held-out test split
    y_pred = clf.predict(X_test)
    y_prob = clf.predict_proba(X_test)

    acc = float(accuracy_score(y_test, y_pred))
    macro_f1 = float(f1_score(y_test, y_pred, average="macro"))

    prec, rec, f1, support = precision_recall_fscore_support(
        y_test, y_pred, labels=clf.classes_, zero_division=0
    )

    per_class_metrics = {}
    for i, cls in enumerate(clf.classes_):
        per_class_metrics[str(cls)] = {
            "precision": round(float(prec[i]), 4),
            "recall": round(float(rec[i]), 4),
            "f1_score": round(float(f1[i]), 4),
            "support": int(support[i])
        }

    conf_mat = confusion_matrix(y_test, y_pred, labels=clf.classes_).tolist()

    # False alarm rate on normal class
    normal_idx = list(clf.classes_).index("normal")
    total_normal_test = int(support[normal_idx])
    normal_correct = int(conf_mat[normal_idx][normal_idx])
    false_alarm_count = total_normal_test - normal_correct
    false_alarm_rate = round(float(false_alarm_count / total_normal_test), 4) if total_normal_test > 0 else 0.0

    # Feature Importance
    importances = clf.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]
    feature_importance_ranking = [
        {"feature": feature_cols[i], "importance": round(float(importances[i]), 4)}
        for i in sorted_idx
    ]

    # TreeSHAP Explanations
    print("Computing TreeSHAP explanations...")
    explainer = shap.TreeExplainer(clf, feature_perturbation="tree_path_dependent")
    sample_size = min(50, len(X_test))
    X_sample = X_test[:sample_size]
    shap_vals = explainer.shap_values(X_sample)

    # Format shap values
    if isinstance(shap_vals, np.ndarray) and shap_vals.ndim == 3:
        shap_list = [shap_vals[:, :, c] for c in range(shap_vals.shape[2])]
    elif isinstance(shap_vals, list):
        shap_list = shap_vals
    else:
        shap_list = [shap_vals]

    # Mean absolute SHAP per feature across classes
    mean_abs_shap = np.mean(
        [np.mean(np.abs(shap_list[c]), axis=0) for c in range(len(clf.classes_))],
        axis=0
    )
    shap_feature_importance = [
        {"feature": feature_cols[i], "mean_abs_shap": round(float(mean_abs_shap[i]), 4)}
        for i in np.argsort(mean_abs_shap)[::-1]
    ]

    # Sample explanation (first test window)
    pred_idx = int(np.argmax(y_prob[0]))
    base_val = explainer.expected_value[pred_idx] if isinstance(explainer.expected_value, (list, np.ndarray)) else explainer.expected_value
    sample_explanations = [
        {
            "feature": feature_cols[i],
            "attribution": round(float(shap_list[pred_idx][0][i]), 4),
            "feature_value_scaled": round(float(X_sample[0][i]), 4)
        }
        for i in np.argsort(np.abs(shap_list[pred_idx][0]))[::-1]
    ]

    # Save model artifact
    model_artifact = {
        "model": clf,
        "scaler": scaler,
        "feature_cols": feature_cols,
        "classes": list(clf.classes_),
        "version": "RF-Bearing-Fault v1.2",
        "target_domain": "bearing",
        "trained_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "training_data": "CWRU 12 kHz drive-end, 0–3 HP (train on 0-2 HP, test on 3 HP)"
    }
    model_path = os.path.join(MODELS_DIR, "rf_bearing_fault_v1_2.joblib")
    joblib.dump(model_artifact, model_path)

    # Results report
    results = {
        "model_id": "RF-Bearing-Fault v1.2",
        "model_name": "Random Forest Bearing Fault Classifier",
        "machine_domain": "bearing",
        "dataset_name": "Case Western Reserve University (CWRU) 12k Bearing Fault Benchmark",
        "training_data_version": "train-cwru-2025-03-10",
        "evaluation_version": "eval-cwru-2025-03-12",
        "split_strategy": "Held out by motor load condition: Train on 0, 1, 2 HP (1750-1797 RPM); Test strictly on 3 HP (1730 RPM). Leakage-free across operational loads.",
        "sample_counts": {
            "total_windows": len(df_train) + len(df_test),
            "train_windows": len(df_train),
            "test_windows": len(df_test)
        },
        "classes": list(clf.classes_),
        "metrics": {
            "accuracy": round(acc, 4),
            "macro_f1": round(macro_f1, 4),
            "false_alarm_rate": false_alarm_rate,
            "per_class": per_class_metrics,
            "confusion_matrix": {
                "labels": list(clf.classes_),
                "matrix": conf_mat
            }
        },
        "feature_importances": feature_importance_ranking,
        "shap_summary": {
            "method": "TreeSHAP (TreeExplainer with tree_path_dependent conditional expectations)",
            "base_value_pred": round(float(base_val), 4),
            "sample_prediction": str(clf.classes_[pred_idx]),
            "feature_attributions": shap_feature_importance,
            "sample_instance_breakdown": sample_explanations[:8],
            "methodology_note": "SHAP explains individual model prediction probabilities by quantifying additive feature contributions. It is an explanation method, not an accuracy score."
        },
        "limitations": [
            "Trained and evaluated on CWRU seeded electro-discharge machined (EDM) single-point bearing defects on a single test rig.",
            "Bearing data is domain-specific and MUST NOT be used to claim gearbox fault diagnosis accuracy or field machine health.",
            "Expect lower performance under uncalibrated transducer placements, multi-fault interactions, or variable speed/load transients."
        ]
    }

    report_path = os.path.join(BENCHMARKS_DIR, "cwru_evaluation_report.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)

    print("CWRU Benchmark Complete!")
    print(f"Accuracy: {acc:.4f}, Macro F1: {macro_f1:.4f}, False Alarm Rate: {false_alarm_rate:.4f}")
    return results


# ==============================================================================
# 2. NASA IMS BEARINGS RUN-TO-FAILURE ANOMALY DETECTION PIPELINE
# ==============================================================================

def run_nasa_ims_benchmark():
    """Extract vibration features from NASA IMS Test 2 snapshots and evaluate Isolation Forest anomaly detection."""
    print("Preparing NASA IMS Test 2 dataset...")
    if not os.path.exists(PROCESSED_NASA_DIR):
        raise FileNotFoundError(f"Missing extracted NASA IMS directory: {PROCESSED_NASA_DIR}")

    file_paths = sorted(glob.glob(os.path.join(PROCESSED_NASA_DIR, "*")))
    n_files = len(file_paths)
    print(f"Found {n_files} run-to-failure snapshot files.")

    rows = []
    # Each file is ASCII with 4 columns: Bearing 1 (Ch1), Bearing 2 (Ch2), Bearing 3 (Ch3), Bearing 4 (Ch4)
    # Bearing 1 experienced outer race failure at the conclusion of the test.
    for idx, fpath in enumerate(file_paths):
        fname = os.path.basename(fpath)
        # Parse timestamp: YYYY.MM.DD.HH.MM.SS
        try:
            parts = [int(p) for p in fname.split(".")]
            ts = datetime.datetime(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], tzinfo=datetime.timezone.utc)
        except Exception:
            ts = datetime.datetime(2004, 2, 12, 10, 32, 39, tzinfo=datetime.timezone.utc) + datetime.timedelta(minutes=10 * idx)

        # Read 4 channels (20,480 samples each)
        data = pd.read_csv(fpath, sep="\t", header=None).values
        b1_signal = data[:, 0]  # Bearing 1 (Ch1)

        time_feats = compute_time_domain_features(b1_signal, prefix="b1")
        # Add spectral centroid
        x_centered = b1_signal - np.mean(b1_signal)
        fft_vals = np.fft.rfft(x_centered * np.hanning(len(b1_signal)))
        freqs = np.fft.rfftfreq(len(b1_signal), d=1.0 / 20000.0)
        power = (np.abs(fft_vals) / len(b1_signal))**2
        sum_power = np.sum(power)
        sc = float(np.sum(freqs * power) / sum_power) if sum_power > 1e-12 else 0.0

        time_feats.update({
            "b1_spectral_centroid": sc,
            "timestamp": ts.isoformat(),
            "snapshot_index": idx,
            "filename": fname
        })
        rows.append(time_feats)

    df = pd.DataFrame(rows)
    feature_cols = [
        "b1_rms", "b1_peak_to_peak", "b1_crest_factor", "b1_kurtosis",
        "b1_skewness", "b1_shape_factor", "b1_impulse_factor", "b1_spectral_centroid"
    ]

    # BASELINE PARTITION:
    # First 20% of run (first ~196 snapshots, ~32.6 hours when bearing was freshly installed and healthy)
    n_baseline = int(len(df) * 0.20)
    df_baseline = df.iloc[:n_baseline].copy()

    X_baseline = df_baseline[feature_cols].values
    X_full = df[feature_cols].values

    scaler = StandardScaler()
    X_baseline_scaled = scaler.fit_transform(X_baseline)
    X_full_scaled = scaler.transform(X_full)

    # Train Isolation Forest on baseline healthy operation
    iso = IsolationForest(
        n_estimators=100,
        contamination=0.01,
        random_state=42,
        n_jobs=-1
    )
    iso.fit(X_baseline_scaled)

    # Anomaly scores: convert decision_function (higher=normal) to anomaly score (higher=anomalous, range ~0 to 1)
    baseline_scores_raw = iso.decision_function(X_baseline_scaled)
    # Calibrate threshold at the 1st percentile of healthy training scores
    threshold_raw = float(np.percentile(baseline_scores_raw, 1.0))

    full_scores_raw = iso.decision_function(X_full_scaled)
    # Min-max scale into anomaly index: 1.0 - (score - min) / (max - min)
    score_min = np.min(full_scores_raw)
    score_max = np.max(full_scores_raw)
    anomaly_scores = (score_max - full_scores_raw) / (score_max - score_min + 1e-12)
    threshold_normalized = (score_max - threshold_raw) / (score_max - score_min + 1e-12)

    df["anomaly_score"] = np.round(anomaly_scores, 4)
    df["is_anomalous"] = full_scores_raw < threshold_raw

    # Find first sustained flag: 6 consecutive snapshots (1 hour) exceeding threshold
    sustained_flags = []
    consecutive = 0
    first_sustained_idx = None
    for i, flag in enumerate(df["is_anomalous"].values):
        if flag:
            consecutive += 1
            if consecutive >= 6 and first_sustained_idx is None:
                first_sustained_idx = i - 5
        else:
            consecutive = 0

    end_ts = datetime.datetime.fromisoformat(df["timestamp"].iloc[-1])
    first_flag_ts = datetime.datetime.fromisoformat(df["timestamp"].iloc[first_sustained_idx]) if first_sustained_idx else None
    
    if first_flag_ts:
        lead_time_seconds = (end_ts - first_flag_ts).total_seconds()
        lead_time_days = round(lead_time_seconds / 86400.0, 2)
        lead_time_hours = round(lead_time_seconds / 3600.0, 1)
    else:
        lead_time_days = 0.0
        lead_time_hours = 0.0

    # Save model artifact
    model_artifact = {
        "model": iso,
        "scaler": scaler,
        "feature_cols": feature_cols,
        "version": "IF-Bearing-Anomaly v1.0",
        "target_domain": "bearing",
        "calibrated_threshold_raw": threshold_raw,
        "calibrated_threshold_normalized": round(float(threshold_normalized), 4),
        "trained_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "baseline_data": f"NASA IMS test 2, first 20% of run (first {n_baseline} snapshots, 32.6h)"
    }
    model_path = os.path.join(MODELS_DIR, "if_bearing_anomaly_v1_0.joblib")
    joblib.dump(model_artifact, model_path)

    # Sample trajectory data for UI visualization (e.g. 50 downsampled points)
    step = max(1, len(df) // 50)
    timeline_sample = [
        {
            "timestamp": df["timestamp"].iloc[i],
            "hours_from_start": round(i * 10.0 / 60.0, 1),
            "anomaly_score": float(df["anomaly_score"].iloc[i]),
            "rms_g": round(float(df["b1_rms"].iloc[i]), 4),
            "kurtosis": round(float(df["b1_kurtosis"].iloc[i]), 2),
            "is_flagged": bool(df["is_anomalous"].iloc[i])
        }
        for i in range(0, len(df), step)
    ]

    results = {
        "model_id": "IF-Bearing-Anomaly v1.0",
        "model_name": "Isolation Forest Unsupervised Bearing Anomaly Detector",
        "machine_domain": "bearing",
        "dataset_name": "NASA IMS Bearing Run-to-Failure Benchmark (Test 2)",
        "training_data_version": "train-ims-2025-02-20",
        "evaluation_version": "eval-ims-2025-02-24",
        "baseline_data": f"NASA IMS test 2, first 20% of run ({n_baseline} snapshots, 32.6 hours)",
        "evaluation_strategy": "Evaluated on continuous run-to-failure trajectory leading to natural outer race fatigue failure. Measures detection lead time before catastrophic loss.",
        "sample_counts": {
            "total_snapshots": len(df),
            "baseline_healthy_snapshots": n_baseline,
            "evaluation_snapshots": len(df) - n_baseline
        },
        "threshold": {
            "normalized_threshold": round(float(threshold_normalized), 4),
            "raw_decision_threshold": round(float(threshold_raw), 4),
            "contamination": 0.01
        },
        "lead_time": {
            "first_sustained_flag_timestamp": first_flag_ts.isoformat() if first_flag_ts else None,
            "end_of_run_timestamp": end_ts.isoformat(),
            "lead_time_days": lead_time_days,
            "lead_time_hours": lead_time_hours,
            "lead_time_human": f"~{lead_time_days} days before end of run"
        },
        "accuracy_statement": "Not reported — no ground truth anomaly labels exist for run-to-failure natural progression. Anomaly score represents statistical isolation path length, not classification accuracy.",
        "timeline_sample": timeline_sample,
        "limitations": [
            "Trained and evaluated on constant-speed, constant-load (2000 RPM, 6000 lbs) laboratory endurance test rig.",
            "Bearing data is domain-specific and MUST NOT be used to claim gearbox fault diagnosis accuracy or field machine health.",
            "Sudden operational regime changes (speed/torque shifts) in industrial environments can trigger anomaly flags without mechanical defect."
        ]
    }

    report_path = os.path.join(BENCHMARKS_DIR, "nasa_ims_evaluation_report.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=2)

    print("NASA IMS Benchmark Complete!")
    print(f"Detection lead time: {lead_time_days} days ({lead_time_hours} hours) before terminal failure.")
    return results


if __name__ == "__main__":
    print("=" * 70)
    print("MechGuard AI — Engineering Benchmark Training & Evaluation")
    print("=" * 70)
    cwru_res = run_cwru_benchmark()
    print("-" * 70)
    ims_res = run_nasa_ims_benchmark()
    print("=" * 70)
    print("All bearing benchmark models trained and evaluated successfully!")
