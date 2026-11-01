"""Thermal Analysis Path for Mechanical Gearbox Condition Monitoring.

Provides dedicated thermal level and drift/rate-of-rise analysis using mapped temperature signals.
Capable of flagging lubrication starvation, cooler failure, and thermal runaway
even when vibration signals remain within ISO 10816 normal limits.
"""

from typing import Dict, Any, List, Optional, Tuple
import numpy as np
import pandas as pd


def find_temperature_columns(
    df: pd.DataFrame,
    column_mappings: Optional[List[Dict[str, Any]]] = None
) -> List[str]:
    """Identify mapped or detected temperature sensor signal columns."""
    temp_cols = []
    if column_mappings:
        for m in column_mappings:
            raw = m.get("rawHeader")
            sig = m.get("mappedSignal") or ""
            unit = m.get("sourceUnit") or ""
            if not raw or raw not in df.columns:
                continue
            if "temp" in sig.lower() or "temperature" in sig.lower() or unit.lower() in ["degc", "c", "°c", "degf"]:
                temp_cols.append(raw)

    if not temp_cols:
        for col in df.columns:
            cl = col.lower()
            if any(k in cl for k in ["temp", "thermal", "sump", "oil_temp", "degc"]) and pd.api.types.is_numeric_dtype(df[col]):
                temp_cols.append(col)

    return temp_cols


def analyze_thermal_window(
    df_window: pd.DataFrame,
    temp_cols: List[str],
    dt_seconds: float = 60.0,
    regime_id: Optional[str] = None
) -> Dict[str, Any]:
    """Analyze temperature levels and drift rates within a window of observations.
    
    Returns thermal anomaly score, calibrated threshold (1.0), and physical attributions.
    """
    if not temp_cols:
        return {
            "is_active": False,
            "is_anomalous": False,
            "anomaly_score": 0.0,
            "calibrated_threshold": 1.0,
            "findings": "Thermal path inactive: No temperature transducer channels mapped in dataset.",
            "contributing_signals": [],
            "limitations": "Dataset lacks thermal instrumentation. Lubrication friction and cooling degradation cannot be evaluated."
        }

    # Aggregate primary temperature channel (e.g. sump or bearing)
    primary_col = temp_cols[0]
    vals = df_window[primary_col].dropna().values
    if len(vals) < 2:
        return {
            "is_active": True,
            "is_anomalous": False,
            "anomaly_score": 0.0,
            "calibrated_threshold": 1.0,
            "findings": "Insufficient temperature observations within window to compute thermal drift.",
            "contributing_signals": [],
            "limitations": "Sparse thermal samples."
        }

    t_mean = float(np.mean(vals))
    t_min = float(np.min(vals))
    t_max = float(np.max(vals))

    # Compute thermal rate-of-change (drift) dT/dt in °C per minute
    # Use linear regression slope across window
    time_points = np.arange(len(vals)) * (dt_seconds / 60.0)  # minutes
    if len(time_points) > 1 and np.var(time_points) > 0:
        drift_slope_c_per_min = float(np.polyfit(time_points, vals, 1)[0])
    else:
        drift_slope_c_per_min = 0.0

    # Regime-conditioned thermal baselines (higher loads expect higher nominal sump temp)
    if regime_id == "HIGH_LOAD_OVERLOAD":
        nominal_temp = 60.0
        max_allowed_temp = 72.0
    elif regime_id == "LOW_LOAD" or regime_id == "LOW_SPEED_IDLE":
        nominal_temp = 48.0
        max_allowed_temp = 62.0
    else:
        # Rated nominal steady-state
        nominal_temp = 54.0
        max_allowed_temp = 68.0

    # Level anomaly component: deviation above nominal
    level_diff = max(0.0, t_mean - nominal_temp)
    level_ratio = level_diff / max(1.0, max_allowed_temp - nominal_temp)

    # Drift anomaly component: positive drift rate exceeding 0.25 °C/min
    drift_ratio = max(0.0, drift_slope_c_per_min - 0.25) / 0.25

    # Combined calibrated thermal anomaly score
    thermal_score = float(round(level_ratio * 0.7 + drift_ratio * 0.5, 4))
    is_anomalous = bool(thermal_score >= 1.0 or t_max > max_allowed_temp or drift_slope_c_per_min > 0.40)

    # Detailed physical findings description
    if is_anomalous:
        if drift_slope_c_per_min > 0.35 and t_mean > max_allowed_temp:
            findings = f"Severe thermal runaway: Sump temperature reached {t_max:.1f} °C with high drift rate (+{drift_slope_c_per_min:.2f} °C/min)."
        elif drift_slope_c_per_min > 0.30:
            findings = f"Abnormal thermal drift (+{drift_slope_c_per_min:.2f} °C/min): Temperature rising steadily under stable operating load."
        else:
            findings = f"Elevated temperature level: Mean temperature ({t_mean:.1f} °C) exceeds regime upper baseline ({max_allowed_temp:.1f} °C)."
    else:
        findings = f"Thermal equilibrium nominal: Sump temperature ({t_mean:.1f} °C) stable within regime bounds."

    contrib_signals = []
    for col in temp_cols:
        col_vals = df_window[col].dropna().values
        if len(col_vals) > 0:
            c_mean = float(np.mean(col_vals))
            delta_val = c_mean - nominal_temp
            delta_pct = (delta_val / nominal_temp) * 100.0
            contrib_signals.append({
                "signal": col,
                "peak_value": round(float(np.max(col_vals)), 2),
                "baseline_mean": round(nominal_temp, 2),
                "deviation_ratio": round(delta_pct / 100.0, 3),
                "value": f"{c_mean:.1f}",
                "baseline": f"{nominal_temp:.1f}",
                "delta": f"{delta_pct:+.1f}%",
                "unit": "°C"
            })

    return {
        "is_active": True,
        "is_anomalous": is_anomalous,
        "anomaly_score": thermal_score,
        "calibrated_threshold": 1.0,
        "temperature_mean": round(t_mean, 2),
        "temperature_max": round(t_max, 2),
        "drift_rate_c_per_min": round(drift_slope_c_per_min, 3),
        "findings": findings,
        "contributing_signals": contrib_signals,
        "limitations": None
    }
