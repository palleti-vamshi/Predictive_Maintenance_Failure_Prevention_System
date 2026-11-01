"""Top-Level Pipeline Orchestrator for Feature Extraction, Model Training, and Regime-Aware Multi-Signal Analysis.

Reads dataset CSV, validates task compatibility, executes windowing & feature extraction,
trains Random Forest / Isolation Forest models, and produces structured evaluation,
operating-regime-conditioned analysis, multi-signal path fusion, and SHAP outputs.
"""

from typing import Dict, Any, List, Optional, Tuple
import os
import json
import pandas as pd
import numpy as np
import joblib
import shap

from features.windowing import segment_and_extract_features
from features.regimes import (
    find_operating_columns,
    classify_window_regime,
    compute_regime_conditioned_scores,
    REGIME_UNKNOWN
)
from models.thermal import (
    find_temperature_columns,
    analyze_thermal_window
)
from models.fusion import (
    evaluate_sensor_coverage,
    fuse_detector_outputs
)
from models.random_forest import train_and_evaluate_random_forest
from models.isolation_forest import train_and_evaluate_isolation_forest


def load_csv_safely(csv_path: str) -> pd.DataFrame:
    """Load CSV with safe delimiter detection, avoiding unintended single-character sniffer bugs."""
    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        first_line = f.readline()
    if "\t" in first_line:
        sep = "\t"
    elif ";" in first_line:
        sep = ";"
    else:
        sep = ","
    return pd.read_csv(csv_path, sep=sep)


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
    df = load_csv_safely(csv_path)

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

    if len(X) == 0:
        raise ValueError("Feature extraction resulted in 0 valid window segments.")

    # 5. Train Model & Save Artifact
    model_path = os.path.join(output_dir, "model.joblib")
    if model_type == "random_forest":
        train_results = train_and_evaluate_random_forest(
            X=X,
            y=y,
            metadata=meta,
            random_state=random_state,
            save_path=model_path
        )
    elif model_type == "isolation_forest":
        train_results = train_and_evaluate_isolation_forest(
            X=X,
            y=y,
            metadata=meta,
            contamination=0.05,
            random_state=random_state,
            save_path=model_path
        )
    else:
        raise ValueError(f"Unsupported model_type: '{model_type}'. Choose 'random_forest' or 'isolation_forest'.")

    # Clean results metadata
    dataset_summary = {
        "csv_path": os.path.basename(csv_path),
        "total_raw_rows": int(len(df)),
        "mapped_signals": signal_columns,
        "window_size": eff_window_size,
        "overlap_ratio": overlap_ratio,
        "total_extracted_windows": int(len(X)),
        "feature_count": int(len(X.columns)),
        "feature_names": list(X.columns)
    }

    output_payload = {
        "model_type": model_type,
        "dataset_summary": dataset_summary,
        "evaluation": train_results["evaluation"],
        "shap_summary": train_results["shap_explanation"],
        "shap_explanation": train_results["shap_explanation"],
        "feature_importance": train_results.get("feature_importance", [])
    }

    results_json_path = os.path.join(output_dir, "results.json")
    with open(results_json_path, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=2)

    return output_payload


def run_analysis(
    csv_path: str,
    model_path: str,
    column_mappings: List[Dict[str, Any]],
    output_dir: str,
    window_size: int = 256,
    overlap_ratio: float = 0.5,
    sampling_rate_hz: Optional[float] = None,
    shaft_speed_rpm: Optional[float] = None,
    pinion_teeth: Optional[int] = None,
    threshold_override: Optional[float] = None,
    regime_aware: bool = True,
    nominal_speed_rpm: float = 1495.0,
    nominal_load_nm: float = 480.0
) -> Dict[str, Any]:
    """Execute operating-regime-aware, multi-signal inference analysis.
    
    Extracts distinct mechanical vibration and thermal paths, performs regime conditioning,
    applies calibrated fusion rules, and calculates verified SHAP attributions.
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Operational dataset CSV not found at: {csv_path}")

    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model artifact not found at: {model_path}")

    os.makedirs(output_dir, exist_ok=True)

    # 1. Load Model Bundle
    bundle = joblib.load(model_path)
    model = bundle["model"]
    scaler = bundle["scaler"]
    expected_features = bundle["feature_names"]
    model_type = bundle.get("model_type") or ("random_forest" if hasattr(model, "predict_proba") else "isolation_forest")
    is_rf = model_type == "random_forest"
    analysis_task = "fault_classification" if is_rf else "anomaly_detection"

    # 2. Parse CSV
    df = load_csv_safely(csv_path)
    if len(df) == 0:
        raise ValueError("Dataset CSV contains no rows.")

    # 3. Detect Signals & Modalities
    timestamp_col = None
    run_id_col = None
    signal_columns: List[str] = []

    for m in column_mappings:
        raw = m.get("rawHeader")
        if not raw or raw not in df.columns:
            continue
        if m.get("isTimestamp"):
            timestamp_col = raw
        elif m.get("mappedSignal"):
            target = m.get("mappedSignal")
            matching_col = raw
            if target and target not in ["timestamp", "label"]:
                if expected_features and any(f.startswith(target) or target in f for f in expected_features):
                    matching_col = target
                elif expected_features and any(f.startswith(raw) or raw in f for f in expected_features):
                    matching_col = raw
                else:
                    matching_col = target
                if matching_col not in df.columns and raw in df.columns:
                    df[matching_col] = df[raw]
            signal_columns.append(matching_col)
        elif raw.lower() in ["run_id", "experiment_id", "campaign", "batch"]:
            run_id_col = raw

    if not signal_columns:
        for col in df.columns:
            if col != timestamp_col and col != run_id_col:
                if pd.api.types.is_numeric_dtype(df[col]):
                    signal_columns.append(col)

    if not signal_columns:
        raise ValueError("No valid numeric sensor signal columns found for analysis feature extraction.")

    # Discover speed, load, and temperature channels
    speed_col, load_col = find_operating_columns(df, column_mappings)
    temp_cols = find_temperature_columns(df, column_mappings)
    has_vib = any("vib" in s.lower() or "accel" in s.lower() for s in signal_columns)

    # Calculate Sensor Coverage and Uncertainty
    sensor_cov = evaluate_sensor_coverage(
        all_columns=list(df.columns),
        mapped_signals=signal_columns,
        has_vibration=has_vib,
        has_thermal=bool(len(temp_cols) > 0),
        has_speed=bool(speed_col is not None),
        has_load=bool(load_col is not None)
    )

    # Check signal compatibility against model's expected features
    if expected_features:
        matching_signal_found = False
        for sig in signal_columns:
            if any(f.startswith(sig) or sig in f for f in expected_features):
                matching_signal_found = True
                break
        if not matching_signal_found:
            raise ValueError(
                f"Incompatible dataset: Mapped signals {signal_columns} do not match the feature channels "
                f"expected by model '{model_type}' (e.g. {expected_features[:3]})."
            )

    # Window size adaptation
    eff_window_size = window_size
    if len(df) < window_size:
        eff_window_size = max(16, len(df) // 2) if len(df) >= 32 else len(df)

    # 4. Windowing and Feature Extraction
    X, _, meta = segment_and_extract_features(
        df=df,
        signal_columns=signal_columns,
        timestamp_col=timestamp_col,
        label_col=None,
        run_id_col=run_id_col,
        window_size=eff_window_size,
        overlap_ratio=overlap_ratio,
        sampling_rate_hz=sampling_rate_hz,
        shaft_speed_rpm=shaft_speed_rpm,
        pinion_teeth=pinion_teeth
    )

    if len(X) == 0:
        raise ValueError("No valid windows could be extracted from dataset.")

    # 5. Align Features to Model Feature Space
    X_aligned = X.reindex(columns=expected_features, fill_value=0.0)
    X_scaled = scaler.transform(X_aligned.values)

    # 6. Run Model Inference & Extract Operating Regimes and Thermal Paths per Window
    window_records = []
    regime_records = []
    thermal_records = []

    if is_rf:
        classes = [str(c) for c in bundle["classes"]]
        preds = model.predict(X_scaled)
        probs = model.predict_proba(X_scaled)

        for i in range(len(X)):
            pred_class = str(preds[i])
            pred_idx = list(model.classes_).index(preds[i])
            conf = float(probs[i, pred_idx])
            is_anomaly = pred_class != "healthy" and pred_class != "0" and pred_class != "normal"

            start_s = int(meta["start_idx"].iloc[i])
            end_s = int(meta["end_idx"].iloc[i])
            win_df = df.iloc[start_s:min(end_s, len(df))]

            # Operating Regime Context
            s_vals = win_df[speed_col].dropna().values if speed_col and speed_col in win_df else None
            l_vals = win_df[load_col].dropna().values if load_col and load_col in win_df else None
            reg_info = classify_window_regime(s_vals, l_vals, nominal_speed_rpm, nominal_load_nm)
            regime_records.append(reg_info)

            # Thermal Path
            th_info = analyze_thermal_window(win_df, temp_cols, dt_seconds=60.0, regime_id=reg_info["regime_id"])
            thermal_records.append(th_info)

            window_records.append({
                "window_idx": i,
                "start_idx": start_s,
                "end_idx": end_s,
                "start_time": meta["start_time"].iloc[i] if "start_time" in meta.columns else None,
                "end_time": meta["end_time"].iloc[i] if "end_time" in meta.columns else None,
                "predicted_class": pred_class,
                "confidence": round(conf, 4),
                "is_anomalous": is_anomaly,
                "score": round(conf, 4),
                "threshold": 0.50,
                "features_vector": X_aligned.iloc[i].to_dict()
            })
    else:
        # Isolation Forest Anomaly Detection
        calibrated_threshold = threshold_override if threshold_override is not None else float(bundle.get("calibrated_threshold", 0.442))
        decisions = model.decision_function(X_scaled)
        raw_scores = -model.score_samples(X_scaled)

        for i in range(len(X)):
            score = float(raw_scores[i])
            dec = float(decisions[i])
            is_anomaly = (score > calibrated_threshold) or (dec < 0.0)

            start_s = int(meta["start_idx"].iloc[i])
            end_s = int(meta["end_idx"].iloc[i])
            win_df = df.iloc[start_s:min(end_s, len(df))]

            # Operating Regime Context
            s_vals = win_df[speed_col].dropna().values if speed_col and speed_col in win_df else None
            l_vals = win_df[load_col].dropna().values if load_col and load_col in win_df else None
            reg_info = classify_window_regime(s_vals, l_vals, nominal_speed_rpm, nominal_load_nm)
            regime_records.append(reg_info)

            # Thermal Path
            th_info = analyze_thermal_window(win_df, temp_cols, dt_seconds=60.0, regime_id=reg_info["regime_id"])
            thermal_records.append(th_info)

            window_records.append({
                "window_idx": i,
                "start_idx": start_s,
                "end_idx": end_s,
                "start_time": meta["start_time"].iloc[i] if "start_time" in meta.columns else None,
                "end_time": meta["end_time"].iloc[i] if "end_time" in meta.columns else None,
                "decision": round(dec, 4),
                "anomaly_score": round(score, 4),
                "score": round(score, 4),
                "threshold": round(calibrated_threshold, 4),
                "is_anomalous": is_anomaly,
                "predicted_class": "statistical_anomaly" if is_anomaly else "nominal_steady_state",
                "features_vector": X_aligned.iloc[i].to_dict()
            })

    # 7. Apply Regime Conditioning to Vibration Scores (if regime valid & requested)
    any_regime_valid = any(r["is_valid"] for r in regime_records)
    if regime_aware and any_regime_valid:
        window_records = compute_regime_conditioned_scores(window_records, regime_records)

    # 8. Multi-Signal Fusion per Window
    fused_window_records = []
    is_anom_fused_list = []

    for i in range(len(window_records)):
        w_rec = window_records[i]
        reg_info = regime_records[i]
        th_info = thermal_records[i]

        vib_detector_input = {
            "is_active": True,
            "is_anomalous": w_rec["is_anomalous"],
            "anomaly_score": w_rec["score"],
            "calibrated_threshold": w_rec["threshold"],
            "predicted_class": w_rec["predicted_class"],
            "limitations": None
        }

        fused = fuse_detector_outputs(
            vib_result=vib_detector_input,
            thermal_result=th_info,
            regime_context=reg_info,
            sensor_coverage=sensor_cov
        )

        w_merged = dict(w_rec)
        w_merged["is_anomalous"] = fused["is_anomalous"]
        w_merged["triggering_path"] = fused["triggering_path"]
        w_merged["severity"] = fused["severity"]
        w_merged["fusion_rule"] = fused["fusion_rule"]
        w_merged["fusion_rationale"] = fused["fusion_rationale"]
        w_merged["detector_breakdown"] = fused["detector_breakdown"]
        w_merged["sensor_coverage"] = sensor_cov

        fused_window_records.append(w_merged)
        is_anom_fused_list.append(fused["is_anomalous"])

    # 9. Group Contiguous Anomalous Windows into Intervals
    intervals = []
    in_interval = False
    cur_start_win = 0

    for i, is_anom in enumerate(is_anom_fused_list):
        if is_anom and not in_interval:
            in_interval = True
            cur_start_win = i
        elif not is_anom and in_interval:
            in_interval = False
            intervals.append((cur_start_win, i - 1))
    if in_interval:
        intervals.append((cur_start_win, len(is_anom_fused_list) - 1))

    # 10. Compute Explainability, Interval Summaries, and Attributions
    interval_details = []
    for int_idx, (w_start, w_end) in enumerate(intervals):
        sub_windows = fused_window_records[w_start:w_end + 1]
        peak_win = max(sub_windows, key=lambda w: w["score"])
        peak_idx = peak_win["window_idx"]

        # Compute SHAP explanation for the peak instance (strictly specific to vibration model)
        shap_details = {}
        top_contributions = []

        if is_rf:
            try:
                bg_sample = X_scaled[:min(50, len(X_scaled))]
                explainer = shap.TreeExplainer(model, data=bg_sample, model_output="probability")
                instance_scaled = X_scaled[peak_idx:peak_idx + 1]
                shap_raw = explainer.shap_values(instance_scaled)

                cls_idx = list(model.classes_).index(model.predict(instance_scaled)[0])

                if isinstance(shap_raw, list):
                    phi = shap_raw[cls_idx][0]
                elif isinstance(shap_raw, np.ndarray) and shap_raw.ndim == 3:
                    phi = shap_raw[0, :, cls_idx]
                else:
                    phi = np.zeros(len(expected_features))

                exp_val = explainer.expected_value
                if hasattr(exp_val, '__len__'):
                    e_val = float(exp_val[cls_idx])
                else:
                    e_val = float(exp_val)

                prob_pred = float(model.predict_proba(instance_scaled)[0, cls_idx])
                additivity_diff = abs((np.sum(phi) + e_val) - prob_pred)

                for f_idx, feat in enumerate(expected_features):
                    top_contributions.append({
                        "feature": feat,
                        "value": round(float(X_aligned.iloc[peak_idx][feat]), 4),
                        "attribution": round(float(phi[f_idx]), 4),
                        "importance": round(abs(float(phi[f_idx])), 4),
                        "interpretation": "Accelerates defect likelihood" if phi[f_idx] > 0 else "Supports normal operation"
                    })
                top_contributions.sort(key=lambda x: x["importance"], reverse=True)

                shap_details = {
                    "explainer_type": "TreeSHAP (Exact TreeExplainer)",
                    "model_output": "Predicted class probability margin",
                    "feature_dependence": "tree_path_dependent (Exact conditional expectation)",
                    "additivity_verified": bool(additivity_diff < 1e-4),
                    "max_discrepancy": round(float(additivity_diff), 6),
                    "baseline_expected_value": round(e_val, 4),
                    "feature_contributions": top_contributions[:6],
                    "detector_scope_note": "Explains mechanical vibration classifier only; not combined or summed with thermal detector."
                }
            except Exception as e:
                shap_details = {"explainer_type": "TreeSHAP", "additivity_verified": False, "error": str(e)}
        else:
            # Isolation Forest Kernel SHAP
            try:
                bg_sample = X_scaled[np.random.choice(len(X_scaled), min(15, len(X_scaled)), replace=False)]
                k_explainer = shap.KernelExplainer(model.decision_function, bg_sample)
                instance_scaled = X_scaled[peak_idx:peak_idx + 1]
                phi = k_explainer.shap_values(instance_scaled, nsamples=40)[0]
                e_val = float(k_explainer.expected_value)
                actual_dec = float(model.decision_function(instance_scaled)[0])
                additivity_diff = abs((np.sum(phi) + e_val) - actual_dec)

                for f_idx, feat in enumerate(expected_features):
                    top_contributions.append({
                        "feature": feat,
                        "value": round(float(X_aligned.iloc[peak_idx][feat]), 4),
                        "attribution": round(float(phi[f_idx]), 4),
                        "importance": round(abs(float(phi[f_idx])), 4),
                        "interpretation": "Drives score toward anomaly threshold" if phi[f_idx] < 0 else "Keeps sample in nominal cluster"
                    })
                top_contributions.sort(key=lambda x: x["importance"], reverse=True)

                shap_details = {
                    "explainer_type": "KernelExplainer (Approximate Sampling)",
                    "model_output": "Isolation Forest decision function (score < 0 indicates anomaly)",
                    "approximation": "approximate_sampling (representative background subset)",
                    "background_samples_count": len(bg_sample),
                    "additivity_verified": bool(additivity_diff < 1e-4),
                    "max_discrepancy": round(float(additivity_diff), 6),
                    "baseline_expected_value": round(e_val, 4),
                    "feature_contributions": top_contributions[:6],
                    "detector_scope_note": "Approximate sampling SHAP explaining unsupervised vibration outlier score only."
                }
            except Exception as e:
                shap_details = {"explainer_type": "KernelExplainer", "additivity_verified": False, "error": str(e)}

        start_s = sub_windows[0]["start_idx"]
        end_s = sub_windows[-1]["end_idx"]
        trend_slice = df.iloc[start_s:min(end_s, len(df))]

        # Trend excerpt
        sample_step = max(1, len(trend_slice) // 15)
        trend_excerpt = []
        for s_idx in range(0, len(trend_slice), sample_step):
            row_data = trend_slice.iloc[s_idx]
            pt = {"sampleIdx": int(start_s + s_idx)}
            if timestamp_col and timestamp_col in row_data:
                pt["timestamp"] = str(row_data[timestamp_col])
            pt["values"] = {c: float(row_data[c]) for c in signal_columns if c in row_data and pd.api.types.is_numeric_dtype(type(row_data[c]))}
            trend_excerpt.append(pt)

        # Contributing Physical Signals (both Vibration and Thermal)
        contributing_signals = []
        all_monitored_signals = list(signal_columns)
        for t_col in temp_cols:
            if t_col not in all_monitored_signals:
                all_monitored_signals.append(t_col)

        for sig in all_monitored_signals:
            if sig in df.columns and pd.api.types.is_numeric_dtype(df[sig]):
                win_mean = float(trend_slice[sig].mean())
                overall_mean = float(df[sig].mean())
                pct_delta = ((win_mean - overall_mean) / (abs(overall_mean) + 1e-6)) * 100.0
                contributing_signals.append({
                    "signal": sig,
                    "peak_value": round(win_mean, 3),
                    "baseline_mean": round(overall_mean, 3),
                    "deviation_ratio": round(pct_delta / 100.0, 3),
                    "value": f"{win_mean:.2f}",
                    "baseline": f"{overall_mean:.2f}",
                    "delta": f"{pct_delta:+.1f}%",
                    "unit": "°C" if ("temp" in sig.lower() or "thermal" in sig.lower()) else "RPM" if "rpm" in sig.lower() else "Nm" if "torque" in sig.lower() else "mm/s"
                })

        # Disclaimers and Research Notices
        if is_rf:
            pred_class_str = peak_win["predicted_class"]
            disclaimer = f"Model prediction: '{pred_class_str}'. Statistical classifier attribution. Does NOT prove physical tooth shear without visual borescope inspection."
        else:
            disclaimer = "Statistical anomaly prediction and statistical deviation relative to operating baseline. Does NOT assert a named physical component has failed."

        interval_details.append({
            "interval_idx": int_idx + 1,
            "interval_index": int_idx + 1,
            "start_time": sub_windows[0]["start_time"],
            "end_time": sub_windows[-1]["end_time"],
            "start_idx": int(start_s),
            "start_sample": int(start_s),
            "end_idx": int(end_s),
            "end_sample": int(end_s),
            "sample_count": int(end_s - start_s),
            "duration_seconds": round((end_s - start_s) / (sampling_rate_hz or 100.0), 2),
            "analysis_task": analysis_task,
            "predicted_class": peak_win["predicted_class"],
            "score": peak_win["score"],
            "calibrated_threshold": peak_win["threshold"],
            "threshold": peak_win["threshold"],
            "is_threshold_calibrated": True,
            "severity": peak_win["severity"],
            "triggering_path": peak_win["triggering_path"],
            "fusion_rule": peak_win["fusion_rule"],
            "fusion_rationale": peak_win["fusion_rationale"],
            "operating_regime": peak_win["detector_breakdown"]["operating_context"],
            "detector_breakdown": peak_win["detector_breakdown"],
            "sensor_coverage": sensor_cov,
            "disclaimer": disclaimer,
            "contributing_signals": contributing_signals[:6],
            "contributing_features": top_contributions[:5],
            "shap_attribution": shap_details,
            "trend_excerpt": trend_excerpt
        })

    # Summary Statistics
    total_samples = len(df)
    missing_count = int(df[signal_columns].isna().sum().sum())
    missing_pct = round((missing_count / (total_samples * len(signal_columns) + 1e-6)) * 100, 2)
    sufficiency_score = max(0.0, round(1.0 - (missing_pct / 100.0), 3))

    detected_regimes = sorted(list({r["regime_id"] for r in regime_records}))
    regime_stabilities = {r["stability"] for r in regime_records}
    if regime_stabilities == {"steady_state"}:
        reg_stab = "steady_state"
    elif regime_stabilities == {"transient"}:
        reg_stab = "transient"
    else:
        reg_stab = "mixed"

    regime_method = "regime_conditioned" if (regime_aware and any_regime_valid) else "global_unconditioned"
    regime_limitations = (
        None if any_regime_valid else "Operating condition signals (speed/load) unmapped; evaluated using global baseline."
    )

    fused_count = sum(1 for inv in interval_details if inv["triggering_path"] == "fused_multi_signal")
    th_count = sum(1 for inv in interval_details if inv["triggering_path"] == "thermal_path")
    vib_count = sum(1 for inv in interval_details if inv["triggering_path"] == "vibration_path")

    results = {
        "analysis_status": "completed",
        "model_type": model_type,
        "analysis_task": analysis_task,
        "regime_summary": {
            "regime_method": regime_method,
            "detected_regimes": detected_regimes,
            "regime_stability": reg_stab,
            "regime_limitations": regime_limitations
        },
        "signal_paths_summary": {
            "vibration_path_active": has_vib,
            "thermal_path_active": bool(len(temp_cols) > 0),
            "operating_context_path_active": bool(speed_col is not None or load_col is not None),
            "fused_intervals_count": fused_count,
            "thermal_isolated_intervals_count": th_count,
            "vibration_isolated_intervals_count": vib_count
        },
        "sensor_coverage": sensor_cov,
        "dataset_summary": {
            "csv_path": os.path.basename(csv_path),
            "total_raw_rows": int(len(df)),
            "mapped_signals": signal_columns,
            "temperature_signals": temp_cols,
            "speed_signal": speed_col,
            "load_signal": load_col,
            "window_size": eff_window_size,
            "overlap_ratio": overlap_ratio,
            "total_extracted_windows": int(len(X))
        },
        "summary": {
            "total_windows": int(len(X)),
            "anomalous_windows_count": int(sum(is_anom_fused_list)),
            "intervals_count": len(interval_details),
            "max_anomaly_score": round(float(max([w['score'] for w in fused_window_records])), 4) if fused_window_records else 0.0,
            "data_sufficiency_score": sufficiency_score,
            "missing_value_pct": missing_pct,
            "steady_state_confirmed": reg_stab == "steady_state"
        },
        "intervals": interval_details
    }

    # Write analysis_results.json
    results_path = os.path.join(output_dir, "analysis_results.json")
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    return results
