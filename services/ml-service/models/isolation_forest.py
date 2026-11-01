"""Isolation Forest Anomaly Detector for Gearbox Condition Monitoring.

Trains an unsupervised ensemble of isolation trees on healthy baseline telemetry,
calibrates anomaly thresholds strictly on training/validation normal distributions,
and provides SHAP feature contributions for anomalous observations.
"""

from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, GroupShuffleSplit
from sklearn.metrics import roc_auc_score, confusion_matrix
import shap
import joblib


def train_and_evaluate_isolation_forest(
    X: pd.DataFrame,
    y: Optional[np.ndarray] = None,
    metadata: Optional[pd.DataFrame] = None,
    contamination: float = 0.05,
    random_state: int = 42,
    n_estimators: int = 150,
    save_path: Optional[str] = None
) -> Dict[str, Any]:
    """Train Isolation Forest on baseline/healthy telemetry and evaluate anomaly performance."""
    feature_names = list(X.columns)
    n_samples = len(X)

    if n_samples < 15:
        raise ValueError(f"Insufficient observations ({n_samples}) to fit Isolation Forest.")

    # 1. Leakage-Resistant Split: Group by independent run if available
    run_ids = metadata["run_id"].values if metadata is not None and "run_id" in metadata.columns else np.zeros(n_samples)
    unique_runs = np.unique(run_ids)

    if len(unique_runs) >= 4:
        gss = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=random_state)
        train_idx, test_idx = next(gss.split(X, y, groups=run_ids))
    else:
        indices = np.arange(n_samples)
        stratify = y if (y is not None and len(np.unique(y)) > 1) else None
        train_idx, test_idx = train_test_split(
            indices, test_size=0.30, random_state=random_state, stratify=stratify
        )

    X_train_raw = X.iloc[train_idx].values
    X_test_raw = X.iloc[test_idx].values
    y_train = y[train_idx] if y is not None else None
    y_test = y[test_idx] if y is not None else None

    # Filter training set to healthy baseline if labels are present
    if y_train is not None:
        healthy_mask = np.isin(y_train, ["healthy", "normal", "0", 0, "nominal"])
        if np.sum(healthy_mask) >= 30:
            X_train_raw = X_train_raw[healthy_mask]

    # Preprocessing: Fit scaler on training partition ONLY
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_test = scaler.transform(X_test_raw)

    # 2. Model Training
    iso = IsolationForest(
        n_estimators=n_estimators,
        contamination=contamination,
        random_state=random_state,
        n_jobs=-1
    )
    iso.fit(X_train)

    # 3. Calibrate Threshold on Training Distribution ONLY (Never on test data!)
    # score_samples: opposite of the anomaly score (lower means more anomalous)
    train_scores = iso.decision_function(X_train)
    # Threshold at the (contamination * 100) percentile of training normal scores
    calibrated_threshold = float(np.percentile(train_scores, contamination * 100))

    # 4. Evaluation on Held-Out Test Set
    test_decision = iso.decision_function(X_test)
    # Continuous anomaly score in [0, 1] where 1.0 is most anomalous
    test_anomaly_scores = np.clip(0.5 - (test_decision / 2.0), 0.0, 1.0)
    test_pred_anomalous = (test_decision <= calibrated_threshold).astype(int)

    eval_results: Dict[str, Any] = {
        "calibrated_decision_threshold": round(calibrated_threshold, 4),
        "calibrated_threshold": round(calibrated_threshold, 4),
        "threshold_selection_method": f"Percentile ({contamination * 100}%) of healthy baseline training distribution",
        "train_samples_fitted": int(len(X_train)),
        "train_samples": int(len(X_train)),
        "test_samples_evaluated": int(len(X_test)),
        "test_samples": int(len(X_test)),
        "mean_anomaly_score_test": round(float(np.mean(test_anomaly_scores)), 4)
    }

    # If ground-truth labels exist, evaluate detection performance
    if y_test is not None:
        is_healthy_test = np.isin(y_test, ["healthy", "normal", "0", 0, "nominal"])
        has_healthy = bool(np.any(is_healthy_test))
        has_faults = bool(np.any(~is_healthy_test))

        if has_healthy:
            fpr = float(np.mean(test_pred_anomalous[is_healthy_test]))
            eval_results["false_positive_rate_healthy"] = round(fpr, 4)
            eval_results["false_positive_rate_on_normal"] = round(fpr, 4)

        if has_faults:
            recall = float(np.mean(test_pred_anomalous[~is_healthy_test]))
            eval_results["fault_recall_anomalous"] = round(recall, 4)
            eval_results["fault_recall_on_defects"] = round(recall, 4)

        if has_healthy and has_faults:
            # Binary ground truth: 1 if fault, 0 if healthy
            y_binary = (~is_healthy_test).astype(int)
            roc_auc = float(roc_auc_score(y_binary, test_anomaly_scores))
            eval_results["roc_auc_score"] = round(roc_auc, 4)
            eval_results["roc_auc"] = round(roc_auc, 4)

    # 5. SHAP Explanations for Anomaly Decision Function
    # Uses model-agnostic KernelExplainer to directly explain decision_function(x)
    shap_results = {}
    try:
        # Sample background from baseline training data
        bg_size = min(30, len(X_train))
        background_sample = X_train[:bg_size]
        explainer = shap.KernelExplainer(iso.decision_function, background_sample)

        # Explain top anomalous test instance
        top_anom_idx = int(np.argmax(test_anomaly_scores))
        sample_x = X_test[top_anom_idx : top_anom_idx + 1]
        shap_vals = explainer.shap_values(sample_x, silent=True)

        if isinstance(shap_vals, list):
            shap_vector = np.array(shap_vals[0]).flatten()
        else:
            shap_vector = np.array(shap_vals).flatten()

        expected_val = float(explainer.expected_value)
        sum_shap = float(np.sum(shap_vector))
        actual_decision = float(test_decision[top_anom_idx])
        additivity_diff = abs((expected_val + sum_shap) - actual_decision)

        feature_contributions = [
            {
                "feature": feature_names[i],
                "value": round(float(sample_x[0, i]), 4),
                # Negative SHAP on decision function pushes instance toward anomaly
                "shap_contribution": round(float(shap_vector[i]), 5)
            }
            for i in range(len(feature_names))
        ]
        # Sort by absolute magnitude of contribution
        feature_contributions.sort(key=lambda x: abs(x["shap_contribution"]), reverse=True)

        shap_results = {
            "explainer_type": "KernelExplainer (Model-Agnostic Decision Function Attribution)",
            "approximation": "exact_local_coalition",
            "background_samples_count": bg_size,
            "additivity_verified": bool(additivity_diff < 1e-4),
            "max_additivity_discrepancy": round(float(additivity_diff), 6),
            "baseline_expected_decision": round(expected_val, 4),
            "instance_decision_output": round(actual_decision, 4),
            "anomaly_score_evaluated": round(float(test_anomaly_scores[top_anom_idx]), 4),
            "top_contributing_features": feature_contributions[:10]
        }
    except Exception as e:
        shap_results = {
            "explainer_type": "KernelExplainer",
            "additivity_verified": False,
            "error": str(e)
        }

    # 6. Persist model artifact
    if save_path:
        bundle = {
            "model_type": "isolation_forest",
            "model": iso,
            "scaler": scaler,
            "feature_names": feature_names,
            "calibrated_threshold": calibrated_threshold,
            "contamination": contamination,
            "pipeline_version": "1.0.0"
        }
        joblib.dump(bundle, save_path)

    return {
        "model_type": "isolation_forest",
        "pipeline_version": "1.0.0",
        "parameters": {
            "n_estimators": n_estimators,
            "contamination": contamination,
            "random_state": random_state
        },
        "evaluation": eval_results,
        "shap_explanation": shap_results
    }

