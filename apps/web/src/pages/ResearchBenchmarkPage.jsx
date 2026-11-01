import React, { useState } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';

/**
 * ResearchBenchmarkPage: Algorithm comparison suite, evaluation metrics, and sensitivity exploration.
 */
export default function ResearchBenchmarkPage() {
  // Interactive Sensitivity Simulator slider: pinion vibration (mm/s)
  const [pinionVib, setPinionVib] = useState(4.2);

  // Compute simulated Isolation Forest anomaly score (0 to 1) based on distance to baseline 2.8 mm/s
  const baseline = 2.8;
  const deviation = Math.max(0, pinionVib - baseline);
  const simulatedScore = Math.min(1.0, (deviation / 2.5) * 0.7 + 0.15).toFixed(3);
  const isAnomaly = simulatedScore > 0.45;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-demo">RESEARCH & EVALUATION BENCHMARK</span>
          </div>
          <h1 className="page-title">Research Method Comparison & Evaluation</h1>
          <p className="page-subtitle">
            Compare transparent engineering thresholds with unsupervised Isolation Forest models on identical gearbox datasets.
          </p>
        </div>
      </div>

      {/* Research Principles Notice */}
      <AlertCallout
        severity="info"
        title="Research Evaluation Protocol"
        description="Algorithms are evaluated across identical operating regimes (speed & load clusters). Supervised classifiers are restricted to verified ground-truth laboratory datasets. Anomaly scores are never equated with physical component failure without verified multi-channel corroboration."
        isSimulated={true}
      />

      {/* Algorithm Comparison Table */}
      <Card
        title="Method Comparison Matrix"
        subtitle="Evaluation criteria applied to identical mechanical gearbox test sequences"
        badge={<StatusBadge status="info" label="Comparative Benchmark" isSimulated={true} />}
      >
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Analysis Method</th>
                <th scope="col">Category</th>
                <th scope="col">Data Requirement</th>
                <th scope="col">Lead Time</th>
                <th scope="col">False Alarm Susceptibility</th>
                <th scope="col">Explainability Mechanism</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="table-primary-text">ISO 10816 Thresholds</td>
                <td>Deterministic Engineering</td>
                <td>Unlabeled (None needed)</td>
                <td>Low (Late stage)</td>
                <td>Low in steady state; high during speed transients</td>
                <td>Direct sensor amplitude vs standard Zone A/B/C bounds</td>
              </tr>
              <tr>
                <td className="table-primary-text">Statistical Rolling Baseline</td>
                <td>Statistical (Z-score, StdDev)</td>
                <td>Historical baseline window</td>
                <td>Medium</td>
                <td>Moderate without regime clustering</td>
                <td>Standard deviations from rolling mean per channel</td>
              </tr>
              <tr>
                <td className="table-primary-text">Isolation Forest</td>
                <td>Unsupervised Anomaly ML</td>
                <td>Unlabeled operational data</td>
                <td>High (Early deviation)</td>
                <td>Low when regime-normalized; sensitive to sensor noise</td>
                <td>Path length attribution / sensor contribution breakdown</td>
              </tr>
              <tr>
                <td className="table-primary-text">Supervised Fault Classifier</td>
                <td>Multi-Class Classification</td>
                <td>Ground-truth labeled run-to-failure</td>
                <td>High (Specific defect)</td>
                <td>Dependent on training distribution match</td>
                <td>SHAP feature importance (only on validated models)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Interactive Model Sensitivity Explorer */}
      <Card
        title="Model Sensitivity Exploration (Simulated What-If)"
        subtitle="Observe how the model anomaly score responds as an influential transducer approaches nominal baseline"
        badge={<span className="badge badge-demo">SENSITIVITY MODEL</span>}
      >
        <div className="sensitivity-container">
          <p className="text-secondary text-sm">
            <strong>Methodology Note:</strong> This exploration displays mathematical model sensitivity. It illustrates how the model score reduces as sensor readings converge toward baseline; it is labeled as model sensitivity, not physical causality or guaranteed repair outcome.
          </p>

          <div className="slider-control-group">
            <div className="slider-label-row">
              <label htmlFor="vib-slider" className="form-label">
                Simulated Pinion Radial Vibration: <strong>{pinionVib} mm/s</strong>
              </label>
              <span className="mono-code text-muted">Nominal Baseline: 2.8 mm/s</span>
            </div>
            <input
              id="vib-slider"
              type="range"
              min="2.0"
              max="6.0"
              step="0.1"
              value={pinionVib}
              onChange={(e) => setPinionVib(parseFloat(e.target.value))}
              className="range-slider"
            />
          </div>

          <div className="metrics-grid" style={{ marginTop: '1rem' }}>
            <MetricSummary
              label="Simulated Anomaly Score"
              value={simulatedScore}
              status={isAnomaly ? 'warning' : 'healthy'}
              sublabel={isAnomaly ? 'Exceeds Anomaly Cutoff (0.450)' : 'Within Nominal Cluster (< 0.450)'}
              isSimulated={true}
            />
            <MetricSummary
              label="Classification"
              value={isAnomaly ? 'Unusual Behavior' : 'Nominal Cluster'}
              status={isAnomaly ? 'warning' : 'healthy'}
              sublabel="Statistical deviation, not verified failure"
              isSimulated={true}
            />
            <MetricSummary
              label="Sensitivity Derivative (∂S/∂v)"
              value="0.280"
              unit="score / (mm/s)"
              status="info"
              sublabel="Local model gradient at current point"
              isSimulated={true}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

