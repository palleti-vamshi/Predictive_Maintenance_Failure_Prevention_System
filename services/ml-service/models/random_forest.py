"""Random Forest Classifier for Mechanical Fault Classification.

Trains an ensemble classifier on compatible labeled gearbox/bearing features,
evaluating precision, recall, macro-F1, confusion matrix, and computing exact
TreeSHAP explanations with additivity verification.
"""

from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, GroupShuffleSplit
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    f1_score,
)
import shap
import joblib


def train_and_evaluate_random_forest(
    X: pd.DataFrame,
    y: np.ndarray,
    metadata: pd.DataFrame,
    random_state: int = 42,
    n_estimators: int = 100,
    max_depth: Optional[int] = 12,
    save_path: Optional[str] = None
) -> Dict[str, Any]:
    """Train Random Forest classifier with leakage-resistant train/test partition."""
    feature_names = list(X.columns)
    unique_classes, class_counts = np.unique(y, return_counts=True)

    if len(unique_classes) < 2:
        raise ValueError(
            f"Supervised fault classification requires at least 2 distinct classes. Found: {list(unique_classes)}"
        )

    # 1. Leakage-Resistant Split: Group by independent run if available
    run_ids = metadata["run_id"].values if "run_id" in metadata.columns else np.zeros(len(X))
    unique_runs = np.unique(run_ids)

    split_method = "StratifiedShuffleSplit"
    min_class_count = int(np.min(class_counts))
    can_stratify = (min_class_count >= 2) and (int(len(X) * 0.25) >= len(unique_classes))

    if len(unique_runs) >= 4:
        # Group-aware split: all windows from a run stay together in one partition
        gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=random_state)
        t_idx, v_idx = next(gss.split(X, y, groups=run_ids))
        if len(np.unique(y[t_idx])) == len(unique_classes) and len(np.unique(y[v_idx])) == len(unique_classes):
            train_idx, test_idx = t_idx, v_idx
            split_method = "GroupShuffleSplit"
        else:
            indices = np.arange(len(X))
            train_idx, test_idx = train_test_split(
                indices,
                test_size=0.25,
                random_state=random_state,
                stratify=y if can_stratify else None
            )
            split_method = "StratifiedShuffleSplit (Group split missed full class representation)" if can_stratify else "ShuffleSplit (Class support too low for stratification)"
    else:
        # Standard stratified split
        indices = np.arange(len(X))
        train_idx, test_idx = train_test_split(
            indices,
            test_size=0.25,
            random_state=random_state,
            stratify=y if can_stratify else None
        )
        if not can_stratify:
            split_method = "ShuffleSplit (Class support too low for stratification)"

    X_train_raw = X.iloc[train_idx].values
    X_test_raw = X.iloc[test_idx].values
    y_train = y[train_idx]
    y_test = y[test_idx]

    # Preprocessing: Fit scaler on training partition ONLY
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train_raw)
    X_test = scaler.transform(X_test_raw)

    # 2. Model Training
    clf = RandomForestClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=random_state,
        n_jobs=-1
    )
    clf.fit(X_train, y_train)

    # 3. Model Evaluation
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

    # Feature Importance
    importances = clf.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]
    feature_ranking = [
        {"feature": feature_names[i], "importance": round(float(importances[i]), 4)}
        for i in sorted_idx[:15]
    ]

    # 4. TreeSHAP Explanations and Additivity Verification
    shap_results = {}
    try:
        # TreeSHAP with exact conditional expectation (tree_path_dependent)
        explainer = shap.TreeExplainer(clf, feature_perturbation="tree_path_dependent")

        # Sample test instances for explanation
        sample_size = min(15, len(X_test))
        X_sample = X_test[:sample_size]
        shap_values_raw = explainer.shap_values(X_sample)

        # Handle different SHAP return formats across library versions
        # Standardize shap_values_raw into list of [ (samples, features) ] for each class
        if isinstance(shap_values_raw, np.ndarray) and shap_values_raw.ndim == 3:
            shap_list = [shap_values_raw[:, :, c] for c in range(shap_values_raw.shape[2])]
        elif isinstance(shap_values_raw, list):
            shap_list = shap_values_raw
        else:
            shap_list = [shap_values_raw]

        expected_values = explainer.expected_value
        max_additivity_diff = 0.0
        for s in range(sample_size):
            pred_class_idx = int(np.argmax(y_prob[s]))
            base_val = (
                expected_values[pred_class_idx]
                if isinstance(expected_values, (list, np.ndarray))
                else expected_values
            )
            sum_shap = float(np.sum(shap_list[pred_class_idx][s]))
            f_x = float(y_prob[s, pred_class_idx])
            diff = abs((base_val + sum_shap) - f_x)
            if diff > max_additivity_diff:
                max_additivity_diff = diff

        # Compute mean absolute SHAP value per feature
        mean_abs_shap = np.mean(
            [np.mean(np.abs(shap_list[c]), axis=0) for c in range(len(clf.classes_))],
            axis=0
        )

        # Sample instance explanation (for first instance)
        first_pred_idx = int(np.argmax(y_prob[0]))
        instance_shap = [
            {
                "feature": feature_names[f],
                "value": round(float(X_sample[0, f]), 4),
                "shap_contribution": round(float(shap_list[first_pred_idx][0, f]), 5)
            }
            for f in range(len(feature_names))
        ]
        instance_shap.sort(key=lambda x: abs(x["shap_contribution"]), reverse=True)

        shap_results = {
            "explainer_type": "TreeExplainer (Exact TreeSHAP)",
            "additivity_verified": bool(max_additivity_diff < 1e-4),
            "max_additivity_discrepancy": round(float(max_additivity_diff), 6),
            "baseline_expected_value": round(
                float(expected_values[first_pred_idx] if hasattr(expected_values, '__len__') else expected_values),
                4
            ),
            "explained_class": str(clf.classes_[first_pred_idx]),
            "predicted_probability": round(float(y_prob[0, first_pred_idx]), 4),
            "top_contributing_features": instance_shap[:10],
            "global_mean_abs_shap": [
                {"feature": feature_names[i], "mean_abs_shap": round(float(mean_abs_shap[i]), 5)}
                for i in np.argsort(mean_abs_shap)[::-1][:15]
            ]
        }
    except Exception as e:
        shap_results = {
            "explainer_type": "TreeExplainer",
            "additivity_verified": False,
            "error": str(e)
        }

    # 5. Persist model artifact
    if save_path:
        bundle = {
            "model": clf,
            "scaler": scaler,
            "feature_names": feature_names,
            "classes": clf.classes_.tolist(),
            "pipeline_version": "1.0.0"
        }
        joblib.dump(bundle, save_path)

    return {
        "model_type": "random_forest",
        "pipeline_version": "1.0.0",
        "parameters": {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "random_state": random_state
        },
        "evaluation": {
            "accuracy": round(acc, 4),
            "macro_f1": round(macro_f1, 4),
            "classes": [str(c) for c in clf.classes_],
            "per_class_metrics": per_class_metrics,
            "confusion_matrix": conf_mat,
            "train_samples": int(len(train_idx)),
            "test_samples": int(len(test_idx)),
            "split_method": split_method
        },
        "feature_importance": feature_ranking,
        "shap_explanation": shap_results
    }

