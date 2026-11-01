"""Time-Series Windowing and Segmentation Pipeline.

Segments continuous or batched vibration time-series into fixed-length windows,
extracting engineering features while preserving run grouping and alignment metadata.
"""

from typing import List, Dict, Any, Tuple, Optional
import pandas as pd
import numpy as np
from .extraction import compute_time_domain_features, compute_frequency_domain_features


def segment_and_extract_features(
    df: pd.DataFrame,
    signal_columns: List[str],
    timestamp_col: Optional[str] = None,
    label_col: Optional[str] = None,
    run_id_col: Optional[str] = None,
    window_size: int = 256,
    overlap_ratio: float = 0.5,
    sampling_rate_hz: Optional[float] = None,
    shaft_speed_rpm: Optional[float] = None,
    pinion_teeth: Optional[int] = None
) -> Tuple[pd.DataFrame, Optional[np.ndarray], pd.DataFrame]:
    """Segment signal streams into overlapping windows and compute feature matrices.
    
    CRITICAL LEAKAGE-PREVENTION:
    Target labels, machine IDs, run IDs, and timestamps are strictly kept OUTSIDE
    the feature matrix X, stored separately in metadata DataFrame for group splits.

    Returns:
        X (pd.DataFrame): Pure numeric feature vectors.
        y (np.ndarray or None): Ground truth labels aligned with each window.
        metadata (pd.DataFrame): Alignment info (window_idx, start_time, end_time, run_id).
    """
    if window_size < 4:
        raise ValueError("window_size must be at least 4 samples.")
    if not (0.0 <= overlap_ratio < 1.0):
        raise ValueError("overlap_ratio must be in range [0.0, 1.0).")

    step = max(1, int(window_size * (1.0 - overlap_ratio)))
    total_samples = len(df)

    if total_samples < window_size:
        # If dataset has fewer samples than window size, handle single window if possible
        if total_samples >= 16:
            window_size = total_samples
            step = total_samples
        else:
            raise ValueError(
                f"Insufficient samples ({total_samples}) for window_size {window_size}."
            )

    # Determine unique runs to prevent cross-run window overlap
    if run_id_col and run_id_col in df.columns:
        runs = df.groupby(run_id_col, sort=False)
    else:
        runs = [(0, df)]

    feature_records: List[Dict[str, float]] = []
    labels: List[Any] = []
    meta_records: List[Dict[str, Any]] = []

    global_win_idx = 0

    for run_id, run_df in runs:
        run_len = len(run_df)
        eff_win = window_size
        if run_len < eff_win:
            if run_len >= 8:
                eff_win = run_len
            else:
                continue

        run_step = max(1, int(eff_win * (1.0 - overlap_ratio)))

        for start_idx in range(0, run_len - eff_win + 1, run_step):
            end_idx = start_idx + eff_win
            window_df = run_df.iloc[start_idx:end_idx]

            row_features: Dict[str, float] = {}

            # 1. Feature extraction per mapped signal column
            for col in signal_columns:
                if col not in window_df.columns:
                    continue
                vals = pd.to_numeric(window_df[col], errors='coerce').fillna(0.0).values
                
                # Time domain
                td = compute_time_domain_features(vals, prefix=col)
                row_features.update(td)

                # Frequency domain
                fd = compute_frequency_domain_features(
                    vals,
                    sampling_rate_hz=sampling_rate_hz,
                    shaft_speed_rpm=shaft_speed_rpm,
                    pinion_teeth=pinion_teeth,
                    prefix=col
                )
                # Keep only numeric outputs in feature matrix
                for k, v in fd.items():
                    if isinstance(v, (int, float, np.floating, np.integer)):
                        row_features[k] = float(v)

            feature_records.append(row_features)

            # 2. Window label determination
            if label_col and label_col in window_df.columns:
                # Use majority/dominant label in the window
                label_val = window_df[label_col].mode()
                assigned_label = label_val.iloc[0] if len(label_val) > 0 else "unknown"
                labels.append(assigned_label)

            # 3. Window metadata tracking
            meta: Dict[str, Any] = {
                "window_idx": global_win_idx,
                "run_id": run_id,
                "start_idx": start_idx,
                "end_idx": end_idx,
            }
            if timestamp_col and timestamp_col in window_df.columns:
                meta["start_time"] = str(window_df[timestamp_col].iloc[0])
                meta["end_time"] = str(window_df[timestamp_col].iloc[-1])

            meta_records.append(meta)
            global_win_idx += 1

    if not feature_records:
        raise ValueError("No valid windows could be extracted from dataset.")

    X = pd.DataFrame(feature_records)
    y_arr = np.array(labels) if labels else None
    metadata_df = pd.DataFrame(meta_records)

    return X, y_arr, metadata_df

