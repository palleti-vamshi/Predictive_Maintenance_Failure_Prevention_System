# Scientific Machine Learning & Feature Engineering Service

This Python microservice implements the signal processing, feature engineering, statistical model training, evaluation, and game-theoretic SHAP explainability pipelines for the **AI-Based Predictive Maintenance and Failure Prevention System for Mechanical Systems**.

## Architecture & Integration

- **Host Stack:** Express REST API communicating through asynchronous non-blocking child-process CLI execution (`cli.py`).
- **Signal Processing & Feature Extraction:**
  - **Time-Domain Physical Indicators:** Mean, Standard Deviation, Root Mean Square (RMS), Peak-to-Peak, Maximum Absolute Value, Crest Factor, Kurtosis (Fisher's definition), Skewness, Shape Factor, Impulse Factor.
  - **Frequency-Domain Spectral Features:** Single-sided FFT power spectrum, spectral centroid, spectral spread, band energies (low, mid, high).
  - **Component Dynamics:** Gear Mesh Frequency peak energy ($f_{\text{GMF}} = \frac{n \cdot Z_1}{60}$).
- **Target Leakage Prevention:**
  - Run IDs, machine IDs, timestamps, and target fault labels are strictly segregated from the numerical feature matrix $X$ into an isolated `metadata` DataFrame.
  - Group-aware cross-run splitting (`GroupShuffleSplit`) ensures that all window slices from an experimental run remain in either the training or testing partition, preventing optimistic autocorrelation leakage.
  - Scalers (`StandardScaler`) are fitted strictly on the training partition.
- **Model Architectures:**
  1. **Random Forest Multi-Class Classifier (`models/random_forest.py`):**
     - Supervised classifier trained on labeled condition-monitoring datasets.
     - Evaluation metrics: Accuracy, Macro-F1, per-class Precision, Recall, F1, and multi-class Confusion Matrix.
     - Explainability: Exact **TreeSHAP** (`shap.TreeExplainer`) with mathematical additivity verification ($|\sum \phi_i + \phi_0 - f(x)| < 10^{-4}$).
  2. **Isolation Forest Anomaly Detector (`models/isolation_forest.py`):**
     - Unsupervised detector calibrated strictly on nominal/healthy operational telemetry.
     - Decision threshold calibrated from normal training distribution percentile.
     - Evaluation metrics: False positive rate on normal validation data, fault recall on defect runs, and ROC-AUC.
     - Explainability: Model-agnostic **KernelExplainer** on anomaly decision function with verified additivity.

## Running Tests

From the repository root:
```bash
services/ml-service/.venv/bin/pytest services/ml-service/tests
```

## CLI Usage

```bash
python services/ml-service/cli.py train \
  --csv-path /path/to/dataset.csv \
  --model-type random_forest \
  --config '{"window_size": 256, "overlap_ratio": 0.5, "random_state": 42}' \
  --output-dir /path/to/output_dir
```
Outputs structured JSON on stdout and writes `model.joblib` and `results.json` to `--output-dir`.
