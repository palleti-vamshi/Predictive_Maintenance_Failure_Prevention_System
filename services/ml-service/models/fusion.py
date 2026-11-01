"""Calibrated Multi-Signal Fusion Engine and Sensor Coverage Assessor.

Combines distinct mechanical vibration, thermal drift, and operating context detector outputs
using calibrated decision rules rather than arbitrary raw score averaging.
Keeps explanations detector-specific, preserves uncertainty bounds, and isolates signal paths.
"""

from typing import Dict, Any, List, Optional


def evaluate_sensor_coverage(
    all_columns: List[str],
    mapped_signals: List[str],
    has_vibration: bool,
    has_thermal: bool,
    has_speed: bool,
    has_load: bool
) -> Dict[str, Any]:
    """Calculate sensor modality coverage, missing channels, and uncertainty level."""
    available_modalities = []
    missing_modalities = []

    if has_vibration:
        available_modalities.append("Mechanical Vibration (Accelerometers)")
    else:
        missing_modalities.append("Mechanical Vibration (Accelerometers)")

    if has_thermal:
        available_modalities.append("Thermal Monitoring (RTD / Thermocouple)")
    else:
        missing_modalities.append("Thermal Monitoring (RTD / Thermocouple)")

    if has_speed:
        available_modalities.append("Shaft Tachometer (Speed)")
    else:
        missing_modalities.append("Shaft Tachometer (Speed)")

    if has_load:
        available_modalities.append("Load / Torque Transducer")
    else:
        missing_modalities.append("Load / Torque Transducer")

    coverage_score = round(len(available_modalities) / 4.0, 2)

    if coverage_score >= 0.75:
        uncertainty = "low"
        uncertainty_note = "High sensor coverage across vibration, thermal, and operating condition regimes."
    elif coverage_score >= 0.50:
        uncertainty = "moderate"
        uncertainty_note = "Partial sensor coverage. Operating regime or thermal context is limited."
    else:
        uncertainty = "elevated"
        uncertainty_note = "Single-modality coverage. High diagnostic uncertainty due to unmapped operating or thermal channels."

    return {
        "coverage_score": coverage_score,
        "available_modalities": available_modalities,
        "missing_modalities": missing_modalities,
        "uncertainty_level": uncertainty,
        "uncertainty_note": uncertainty_note
    }


def fuse_detector_outputs(
    vib_result: Dict[str, Any],
    thermal_result: Dict[str, Any],
    regime_context: Dict[str, Any],
    sensor_coverage: Dict[str, Any]
) -> Dict[str, Any]:
    """Apply calibrated multi-signal fusion rules to determine final alert state.
    
    Rules:
      1. Both Vibration & Thermal anomalous -> Promoted to CRITICAL with Cross-Confirmation.
      2. Vibration anomalous only -> WARNING / CRITICAL with Vibration Isolated rationale.
      3. Thermal anomalous only -> WARNING with Thermal Path Isolated rationale (vibration nominal).
      4. Neither anomalous -> HEALTHY nominal.
    """
    vib_active = vib_result.get("is_active", False)
    vib_anom = vib_result.get("is_anomalous", False)
    vib_score = vib_result.get("anomaly_score", 0.0)
    vib_thresh = vib_result.get("calibrated_threshold", 0.50)

    thermal_active = thermal_result.get("is_active", False)
    thermal_anom = thermal_result.get("is_anomalous", False)
    thermal_score = thermal_result.get("anomaly_score", 0.0)
    thermal_thresh = thermal_result.get("calibrated_threshold", 1.0)

    regime_id = regime_context.get("regime_id", "UNKNOWN")
    regime_label = regime_context.get("regime_label", "Unknown Operating Regime")
    regime_stability = regime_context.get("stability", "unknown")

    # Normalized score ratios (Score / Threshold)
    vib_ratio = round(vib_score / max(1e-6, vib_thresh), 3) if vib_active else 0.0
    thermal_ratio = round(thermal_score / max(1e-6, thermal_thresh), 3) if thermal_active else 0.0

    # Decision Fusion
    if vib_anom and thermal_anom:
        is_anomalous = True
        triggering_path = "fused_multi_signal"
        severity = "critical"
        fusion_rule = "calibrated_cross_confirmation"
        fusion_rationale = (
            "Multi-Signal Cross-Confirmation: High-frequency mechanical vibration deviation coincided "
            "with abnormal thermal rise, confirming compound mechanical breakdown and excessive frictional heating."
        )
    elif vib_anom and not thermal_anom:
        is_anomalous = True
        triggering_path = "vibration_path"
        # If severe broken tooth is predicted by classification, critical; otherwise warning
        pred_class = vib_result.get("predicted_class", "")
        if "broken" in pred_class.lower() or "severe" in pred_class.lower() or vib_ratio > 1.6:
            severity = "critical"
        else:
            severity = "warning"
        fusion_rule = "vibration_isolated"
        fusion_rationale = (
            "Mechanical Vibration Isolated: Transient vibration elevation or gear meshing impact detected "
            "while sump thermal equilibrium remained normal."
        )
    elif thermal_anom and not vib_anom:
        is_anomalous = True
        triggering_path = "thermal_path"
        severity = "warning"
        fusion_rule = "thermal_isolated"
        fusion_rationale = (
            "Thermal Path Isolated: Abnormal lubrication sump temperature or thermal drift rate detected "
            "while mechanical vibration signature remained within ISO 10816 normal limits."
        )
    else:
        is_anomalous = False
        triggering_path = "none"
        severity = "healthy"
        fusion_rule = "all_paths_nominal"
        fusion_rationale = "All monitored transducer channels remain within healthy calibrated operating limits."

    # Limitations summary
    path_limitations = []
    if not vib_active:
        path_limitations.append("Vibration path inactive.")
    if not thermal_active:
        path_limitations.append("Thermal path inactive: No temperature sensors mapped.")
    if regime_context.get("limitation"):
        path_limitations.append(regime_context["limitation"])

    return {
        "is_anomalous": is_anomalous,
        "triggering_path": triggering_path,
        "severity": severity,
        "fusion_rule": fusion_rule,
        "fusion_rationale": fusion_rationale,
        "detector_breakdown": {
            "vibration": {
                "is_active": vib_active,
                "is_anomalous": vib_anom,
                "score": round(vib_score, 4),
                "threshold": round(vib_thresh, 4),
                "normalized_ratio": vib_ratio,
                "predicted_class": vib_result.get("predicted_class", "nominal"),
                "limitations": vib_result.get("limitations")
            },
            "thermal": {
                "is_active": thermal_active,
                "is_anomalous": thermal_anom,
                "score": round(thermal_score, 4),
                "threshold": round(thermal_thresh, 4),
                "normalized_ratio": thermal_ratio,
                "temperature_mean": thermal_result.get("temperature_mean"),
                "drift_rate_c_per_min": thermal_result.get("drift_rate_c_per_min"),
                "findings": thermal_result.get("findings"),
                "limitations": thermal_result.get("limitations")
            },
            "operating_context": {
                "regime_id": regime_id,
                "regime_label": regime_label,
                "stability": regime_stability,
                "speed_rpm": regime_context.get("mean_speed_rpm"),
                "load_nm": regime_context.get("mean_load_nm")
            }
        },
        "sensor_coverage": sensor_coverage,
        "path_limitations": path_limitations
    }
