"""Operating Regime Identification, Validation, and Conditioning Engine.

Analyzes operational condition channels (rotational speed, load torque, and machine modes)
to establish operating regimes from documented profiles. Prevents normal speed/load
transitions from triggering avoidable anomaly alerts through regime-conditioned baselines.
"""

from typing import Dict, Any, List, Optional, Tuple
import numpy as np
import pandas as pd


# Documented canonical operating regimes
REGIME_UNKNOWN = "UNKNOWN"
REGIME_LOW_SPEED_IDLE = "LOW_SPEED_IDLE"
REGIME_LOW_LOAD = "LOW_LOAD"
REGIME_RATED_NOMINAL = "RATED_NOMINAL"
REGIME_HIGH_LOAD_OVERLOAD = "HIGH_LOAD_OVERLOAD"
REGIME_SPEED_RAMP_TRANSIENT = "SPEED_RAMP_TRANSIENT"

REGIME_LABELS = {
    REGIME_UNKNOWN: "Unknown Operating Regime",
    REGIME_LOW_SPEED_IDLE: "Low Speed / Idle (< 1200 RPM)",
    REGIME_LOW_LOAD: "Nominal Speed, Light Load (< 350 Nm)",
    REGIME_RATED_NOMINAL: "Rated Steady-State (1450-1550 RPM, 400-550 Nm)",
    REGIME_HIGH_LOAD_OVERLOAD: "High Load / Heavy Regime (> 550 Nm)",
    REGIME_SPEED_RAMP_TRANSIENT: "Speed / Acceleration Transient"
}


def find_operating_columns(
    df: pd.DataFrame,
    column_mappings: Optional[List[Dict[str, Any]]] = None
) -> Tuple[Optional[str], Optional[str]]:
    """Identify rotational speed and load/torque column names from mappings or column heuristics."""
    speed_col = None
    load_col = None

    if column_mappings:
        for m in column_mappings:
            raw = m.get("rawHeader")
            sig = m.get("mappedSignal")
            if not raw or raw not in df.columns:
                continue
            if sig == "rotational_speed" or (raw.lower() in ["rotational_speed", "speed_rpm", "rpm", "speed"]):
                speed_col = raw
            elif sig == "load_torque" or (raw.lower() in ["load_torque", "torque", "torque_nm", "load"]):
                load_col = raw

    if not speed_col:
        for col in df.columns:
            cl = col.lower()
            if any(k in cl for k in ["rpm", "speed", "tachometer"]) and pd.api.types.is_numeric_dtype(df[col]):
                speed_col = col
                break

    if not load_col:
        for col in df.columns:
            cl = col.lower()
            if any(k in cl for k in ["torque", "load", "tq", "brake"]) and pd.api.types.is_numeric_dtype(df[col]):
                load_col = col
                break

    return speed_col, load_col


def classify_window_regime(
    speed_values: Optional[np.ndarray],
    load_values: Optional[np.ndarray],
    nominal_speed_rpm: float = 1495.0,
    nominal_load_nm: float = 480.0
) -> Dict[str, Any]:
    """Classify the operating regime of a window based on speed and load arrays.
    
    If speed or load are missing, invalid, or NaN, marks regime as UNKNOWN with clear limitation.
    """
    has_speed = speed_values is not None and len(speed_values) > 0 and not np.all(np.isnan(speed_values))
    has_load = load_values is not None and len(load_values) > 0 and not np.all(np.isnan(load_values))

    # 1. Missing or unmapped operating channels
    if not has_speed and not has_load:
        return {
            "regime_id": REGIME_UNKNOWN,
            "regime_label": REGIME_LABELS[REGIME_UNKNOWN],
            "stability": "unknown",
            "is_valid": False,
            "mean_speed_rpm": None,
            "mean_load_nm": None,
            "speed_variation_pct": None,
            "limitation": "Rotational speed and load torque signals were missing or not mapped in dataset. Evaluation running in global baseline mode with elevated uncertainty."
        }

    speed_mean = float(np.nanmean(speed_values)) if has_speed else None
    load_mean = float(np.nanmean(load_values)) if has_load else None

    # Check for transient speed conditions
    if has_speed and len(speed_values) > 2:
        speed_std = float(np.nanstd(speed_values))
        speed_var_pct = (speed_std / (abs(speed_mean) + 1e-6)) * 100.0
        if speed_var_pct > 8.0:
            return {
                "regime_id": REGIME_SPEED_RAMP_TRANSIENT,
                "regime_label": REGIME_LABELS[REGIME_SPEED_RAMP_TRANSIENT],
                "stability": "transient",
                "is_valid": True,
                "mean_speed_rpm": round(speed_mean, 1),
                "mean_load_nm": round(load_mean, 1) if load_mean is not None else None,
                "speed_variation_pct": round(speed_var_pct, 1),
                "limitation": "Transient acceleration / deceleration detected. Vibration impact indicators modulated to prevent false alarms."
            }
    else:
        speed_var_pct = 0.0

    # 2. Speed-based classification
    if speed_mean is not None and speed_mean < 0.75 * nominal_speed_rpm:
        regime_id = REGIME_LOW_SPEED_IDLE
    elif load_mean is not None:
        if load_mean < 0.60 * nominal_load_nm:
            regime_id = REGIME_LOW_LOAD
        elif load_mean > 1.20 * nominal_load_nm:
            regime_id = REGIME_HIGH_LOAD_OVERLOAD
        else:
            regime_id = REGIME_RATED_NOMINAL
    else:
        # Speed available but load absent
        regime_id = REGIME_RATED_NOMINAL

    return {
        "regime_id": regime_id,
        "regime_label": REGIME_LABELS.get(regime_id, regime_id),
        "stability": "steady_state",
        "is_valid": True,
        "mean_speed_rpm": round(speed_mean, 1) if speed_mean is not None else None,
        "mean_load_nm": round(load_mean, 1) if load_mean is not None else None,
        "speed_variation_pct": round(speed_var_pct, 1),
        "limitation": None if (has_speed and has_load) else "Load torque signal unmapped; regime classified from shaft speed only."
    }


def compute_regime_conditioned_scores(
    window_records: List[Dict[str, Any]],
    regime_details: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Adjust or condition baseline anomaly scores against regime-specific expectations.
    
    Prevents legitimate shifts to higher operational loads (which naturally exhibit higher
    nominal vibration and sump temperature) from causing false positive anomaly triggers.
    """
    # Group healthy baseline samples by regime to determine regime-specific means
    regime_stats: Dict[str, Dict[str, float]] = {}
    for win, reg in zip(window_records, regime_details):
        r_id = reg["regime_id"]
        if r_id not in regime_stats:
            regime_stats[r_id] = {"scores": []}
        regime_stats[r_id]["scores"].append(win["score"])

    # Calculate baseline score ceiling for each regime with safety margin
    regime_thresholds: Dict[str, float] = {}
    for r_id, data in regime_stats.items():
        arr = np.array(data["scores"])
        if len(arr) >= 2:
            # Regime threshold set above observed normal distribution ceiling
            regime_thresholds[r_id] = float(np.max(arr)) * 1.05
        else:
            regime_thresholds[r_id] = 0.50

    conditioned_records = []
    for win, reg in zip(window_records, regime_details):
        r_id = reg["regime_id"]
        is_transient = reg.get("stability") == "transient"
        
        reg_thresh = regime_thresholds.get(r_id, win.get("threshold", 0.50))
        raw_score = win["score"]

        # If operating in transient state, attenuate raw score slightly to avoid transient false alarm
        if is_transient:
            adj_score = raw_score * 0.85
        else:
            adj_score = raw_score

        # Normalized ratio against regime threshold
        norm_ratio = round(adj_score / (reg_thresh + 1e-6), 4)
        is_anom = norm_ratio >= 1.0

        rec = dict(win)
        rec["regime_id"] = r_id
        rec["regime_label"] = reg["regime_label"]
        rec["regime_stability"] = reg["stability"]
        rec["regime_threshold"] = round(reg_thresh, 4)
        rec["regime_normalized_score"] = norm_ratio
        rec["is_anomalous"] = is_anom
        rec["limitation"] = reg.get("limitation")
        conditioned_records.append(rec)

    return conditioned_records
