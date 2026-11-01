"""Engineering Feature Extraction Pipeline for Mechanical Gearbox Vibration Signals.

Computes time-domain statistical indicators and spectral frequency attributes
on windowed sensor arrays according to ISO and condition monitoring standards.
"""

from typing import Dict, Any, Optional
import numpy as np
from scipy import stats


def compute_time_domain_features(signal: np.ndarray, prefix: str = "") -> Dict[str, float]:
    """Compute standard vibration time-domain indicators on a 1D window.
    
    Formulas:
      - RMS: sqrt(mean(x^2))
      - Peak-to-Peak: max(x) - min(x)
      - Peak / Max Abs: max(|x|)
      - Crest Factor: max(|x|) / RMS
      - Kurtosis: Fisher's excess kurtosis (E[(x - mu)^4] / sigma^4 - 3)
      - Skewness: E[(x - mu)^3] / sigma^3
      - Shape Factor: RMS / mean(|x|)
      - Impulse Factor: max(|x|) / mean(|x|)
    """
    x = np.asarray(signal, dtype=np.float64)
    n = len(x)
    if n == 0:
        return {}

    # Basic metrics
    mean_val = float(np.mean(x))
    std_val = float(np.std(x, ddof=0))
    min_val = float(np.min(x))
    max_val = float(np.max(x))
    peak_to_peak = max_val - min_val
    max_abs = float(np.max(np.abs(x)))
    mean_abs = float(np.mean(np.abs(x)))

    # Root Mean Square (RMS)
    rms = float(np.sqrt(np.mean(x**2)))

    # Dimensionless shape and impulsiveness factors (protected against zero division)
    crest_factor = float(max_abs / rms) if rms > 1e-12 else 0.0
    shape_factor = float(rms / mean_abs) if mean_abs > 1e-12 else 0.0
    impulse_factor = float(max_abs / mean_abs) if mean_abs > 1e-12 else 0.0

    # Moments: Kurtosis (Fisher's definition where Gaussian = 0) and Skewness
    if std_val > 1e-12:
        skewness_val = float(stats.skew(x, bias=True))
        kurtosis_val = float(stats.kurtosis(x, fisher=True, bias=True))
    else:
        skewness_val = 0.0
        kurtosis_val = 0.0

    p = f"{prefix}_" if prefix else ""
    return {
        f"{p}mean": mean_val,
        f"{p}std": std_val,
        f"{p}rms": rms,
        f"{p}peak_to_peak": peak_to_peak,
        f"{p}max_abs": max_abs,
        f"{p}crest_factor": crest_factor,
        f"{p}kurtosis": kurtosis_val,
        f"{p}skewness": skewness_val,
        f"{p}shape_factor": shape_factor,
        f"{p}impulse_factor": impulse_factor,
    }


def compute_frequency_domain_features(
    signal: np.ndarray,
    sampling_rate_hz: Optional[float] = None,
    shaft_speed_rpm: Optional[float] = None,
    pinion_teeth: Optional[int] = None,
    prefix: str = ""
) -> Dict[str, Any]:
    """Compute spectral features using Discrete Fourier Transform (FFT).
    
    If sampling_rate_hz is known, computes spectral centroid and frequency band energies.
    If shaft speed and pinion teeth are known, computes Gear Mesh Frequency (GMF) energy.
    Otherwise, generic spectral moments are computed and flagged.
    """
    x = np.asarray(signal, dtype=np.float64)
    n = len(x)
    if n < 4:
        return {}

    # Remove DC bias
    x_centered = x - np.mean(x)
    
    # Hanning window to reduce spectral leakage
    window = np.hanning(n)
    x_win = x_centered * window

    # Single-sided FFT magnitude spectrum
    fft_vals = np.fft.rfft(x_win)
    magnitudes = np.abs(fft_vals) / n
    power = magnitudes**2
    sum_power = float(np.sum(power))

    p = f"{prefix}_" if prefix else ""
    features = {
        f"{p}spectral_energy": sum_power,
    }

    if sampling_rate_hz is not None and sampling_rate_hz > 0:
        freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate_hz)
        
        # Spectral Centroid: sum(f * P(f)) / sum(P(f))
        if sum_power > 1e-14:
            spectral_centroid = float(np.sum(freqs * power) / sum_power)
            spectral_spread = float(np.sqrt(np.sum(((freqs - spectral_centroid)**2) * power) / sum_power))
        else:
            spectral_centroid = 0.0
            spectral_spread = 0.0

        features[f"{p}spectral_centroid_hz"] = spectral_centroid
        features[f"{p}spectral_spread_hz"] = spectral_spread

        # Band energy distributions (low: < 0.2 fs, mid: 0.2-0.4 fs, high: > 0.4 fs)
        f_max = freqs[-1]
        low_band = (freqs <= 0.2 * f_max)
        mid_band = (freqs > 0.2 * f_max) & (freqs <= 0.4 * f_max)
        high_band = (freqs > 0.4 * f_max)

        features[f"{p}band_energy_low"] = float(np.sum(power[low_band]))
        features[f"{p}band_energy_mid"] = float(np.sum(power[mid_band]))
        features[f"{p}band_energy_high"] = float(np.sum(power[high_band]))

        # Component-specific Gear Mesh Frequency (GMF)
        if shaft_speed_rpm is not None and pinion_teeth is not None and shaft_speed_rpm > 0 and pinion_teeth > 0:
            gmf_hz = (shaft_speed_rpm / 60.0) * pinion_teeth
            # Energy in narrow band around GMF (±5%)
            gmf_mask = (freqs >= gmf_hz * 0.95) & (freqs <= gmf_hz * 1.05)
            features[f"{p}gmf_hz"] = float(gmf_hz)
            features[f"{p}gmf_band_energy"] = float(np.sum(power[gmf_mask])) if np.any(gmf_mask) else 0.0
            features[f"{p}component_frequencies_derived"] = True
        else:
            features[f"{p}component_frequencies_derived"] = False
    else:
        features[f"{p}component_frequencies_derived"] = False

    return features

