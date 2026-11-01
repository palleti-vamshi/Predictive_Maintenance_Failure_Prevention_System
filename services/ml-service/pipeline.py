"""Top-Level Pipeline Orchestrator for Feature Extraction and Model Training.

Reads dataset CSV, validates task compatibility, executes windowing & feature extraction,
trains Random Forest / Isolation Forest models, and produces structured evaluation and SHAP outputs.
"""

from typing import Dict, Any, List, Optional
import os
import json
import pandas as pd
import numpy as np

from features.windowing import segment_and_extract_features
from models.random_forest import train_and_evaluate_random_forest
from models.isolation_forest import train_and_evaluate_isolation_forest


def run_pipeline(
    csv_path: str,
    model_type: str,
    column_mappings: List[Dict[str, Any]],
    output_dir: str,
    window_size: int = 256,
    overlap_ratio: float = 0.5,
    sampling_rate_hz: Optional[float] = None,
    shaft_speed_rpm: Optional[float] = None,
    pinion_teeth: Optional[int] = None,
    random_state: int = 42
) -> Dict[str, Any]:
    """Execute end-to-end ML pipeline and write artifacts to output_dir."""
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Dataset CSV not found at: {csv_path}")

    os.makedirs(output_dir, exist_ok=True)

    # 1. Parse CSV
    # Try comma first, fallback to autodetect
    try:
        df = pd.read_csv(csv_path, sep=None, engine='python')
    except Exception:
        df = pd.read_csv(csv_path)

    if len(df) == 0:
        raise ValueError("Dataset CSV contains no rows.")

    # 2. Extract mappings
    timestamp_col = None
    label_col = None
    run_id_col = None
    signal_columns: List[str] = []

    for m in column_mappings:
        raw = m.get("rawHeader")
        if not raw or raw not in df.columns:
            continue

        if m.get("isTimestamp"):
            timestamp_col = raw
        elif m.get("isLabel"):
            label_col = raw
        elif m.get("mappedSignal"):
            signal_columns.append(raw)
        elif raw.lower() in ["run_id", "experiment_id", "campaign", "batch"]:
            run_id_col = raw

    # Fallback column detection if not explicitly mapped
    if not signal_columns:
        for col in df.columns:
            if col != timestamp_col and col != label_col and col != run_id_col:
                if pd.api.types.is_numeric_dtype(df[col]):
                    signal_columns.append(col)

    if not signal_columns:
        raise ValueError("No valid numeric sensor signal columns found for feature extraction.")

    # 3. Model Compatibility Checks
    if model_type == "random_forest":
        if not label_col:
            raise ValueError(
                "Random Forest classification requires a ground-truth fault label column mapped in dataset."
            )
        unique_labels = df[label_col].dropna().unique()
        if len(unique_labels) < 2:
            raise ValueError(
                f"Random Forest classification requires at least 2 distinct classes. Found only: {list(unique_labels)}"
            )

    # Adapt window_size if total samples is smaller than requested window_size
    eff_window_size = window_size
    if len(df) < window_size:
        eff_window_size = max(16, len(df) // 2) if len(df) >= 32 else len(df)

    # 4. Windowing and Feature Extraction
    X, y, meta = segment_and_extract_features(
        df=df,
        signal_columns=signal_columns,
        timestamp_col=timestamp_col,
        label_col=label_col,
        run_id_col=run_id_col,
        window_size=eff_window_size,
        overlap_ratio=overlap_ratio,
        sampling_rate_hz=sampling_rate_hz,
        shaft_speed_rpm=shaft_speed_rpm,
        pinion_teeth=pinion_teeth
    )

    # 5. Train Model
    artifact_path = os.path.join(output_dir, "model.joblib")

    if model_type == "random_forest":
        if y is None:
            raise ValueError("Labels are required for Random Forest.")
        results = train_and_evaluate_random_forest(
            X=X,
            y=y,
            metadata=meta,
            random_state=random_state,
            save_path=artifact_path
        )
    elif model_type == "isolation_forest":
        results = train_and_evaluate_isolation_forest(
            X=X,
            y=y,
            metadata=meta,
            random_state=random_state,
            save_path=artifact_path
        )
    else:
        raise ValueError(f"Unsupported model_type: '{model_type}'. Expected 'random_forest' or 'isolation_forest'.")

    # 6. Attach Pipeline Provenance Metadata
    results["dataset_summary"] = {
        "csv_path": os.path.basename(csv_path),
        "total_raw_rows": int(len(df)),
        "mapped_signals": signal_columns,
        "window_size": eff_window_size,
        "overlap_ratio": overlap_ratio,
        "total_extracted_windows": int(len(X)),
        "feature_count": int(len(X.columns)),
        "feature_names": list(X.columns)
    }

    # Write results.json
    results_path = os.path.join(output_dir, "results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    return results

