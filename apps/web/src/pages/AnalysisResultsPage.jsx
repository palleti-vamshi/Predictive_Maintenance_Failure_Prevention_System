import React from 'react';
import Card from '../components/common/Card.jsx';
import MetricSummary from '../components/common/MetricSummary.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import { DEMO_MACHINES } from '@predictive-maintenance/shared';

/**
 * AnalysisResultsPage: Multi-channel condition monitoring, decoupled vibration & thermal analysis.
 */
export default function AnalysisResultsPage() {
  const machine = DEMO_MACHINES[0]; // GB-104

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="mono-code">{machine.id}</span>
            <span className="badge badge-demo">SIMULATED BENCHMARK ANALYSIS</span>
          </div>
          <h1 className="page-title">Analysis Results & Sensor Trends</h1>
          <p className="page-subtitle">
            Decoupled multi-channel condition assessment for <strong>{machine.name}</strong>.
          </p>
        </div>
      </div>

      {/* Methodology Explainer Callout */}
      <AlertCallout
        severity="info"
        title="Decoupled Multi-Channel Architecture"
        description="Vibration and thermal signals are evaluated through separate pipelines. A thermal anomaly (loss of lubrication friction) is detectable even if dynamic vibration remains quiescent. Transients caused by routine speed or torque shifts are normalized via operating-regime clustering to prevent spurious alerts."
        isSimulated={true}
      />

      {/* Engineering Baseline Metrics */}
      <div className="metrics-grid">
        <MetricSummary
          label="Input Pinion Radial Vibration"
          value="4.2"
          unit="mm/s RMS"
          status="warning"
          sublabel="Baseline: 2.8 mm/s (ISO 10816-3 Zone B)"
          delta="+50%"
          isSimulated={true}
        />
        <MetricSummary
          label="Gearbox Sump Oil Temp"
          value="54.2"
          unit="°C"
          status="healthy"
          sublabel="Threshold: 75.0 °C (Nominal: 52.0 °C)"
          delta="+4.2%"
          isSimulated={true}
        />
        <MetricSummary
          label="Drive Shaft Speed"
          value="1,782"
          unit="RPM"
          status="info"
          sublabel="Operating Regime: High Speed / Continuous"
          isSimulated={true}
        />
        <MetricSummary
          label="Applied Mechanical Torque"
          value="476"
          unit="Nm"
          status="info"
          sublabel="Rated Load: 480 Nm (99.1% load)"
          isSimulated={true}
        />
      </div>

      {/* Decoupled Diagnostic Channels Breakdown */}
      <div className="grid-two-col">
        {/* Channel 1: Vibration Dynamics */}
        <Card
          title="Channel A: Mechanical Dynamic Vibration"
          subtitle="Monitors unbalance, gear mesh impacts, and bearing ring distress"
          badge={<StatusBadge status="warning" label="ATTENTION" isSimulated={true} />}
        >
          <div className="channel-box">
            <div className="channel-spec-row">
              <span className="spec-label">Primary Sensor:</span>
              <span className="mono-code">vibration_input_radial (High-Speed Pinion)</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Current RMS Velocity:</span>
              <span className="mono-code text-warning">4.2 mm/s [SIMULATED]</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Engineering Baseline:</span>
              <span className="mono-code">2.8 mm/s (ISO 10816-3 Zone A/B Boundary)</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Algorithm Assessment:</span>
              <span>Elevated radial energy in high-speed mesh pass window. Consistent with tooth contact roughness or slight misalignment.</span>
            </div>
          </div>
          <div className="trend-placeholder-box">
            <div className="trend-placeholder-text">
              📊 Simulated Vibration Time-Series Trend
              <div className="trend-subtext">24,000 samples @ 100 Hz • Interactive chart will render in Phase 6</div>
            </div>
          </div>
        </Card>

        {/* Channel 2: Thermal & Lubrication */}
        <Card
          title="Channel B: Thermal & Lubrication State"
          subtitle="Monitors lubrication breakdown, friction heat, and localized bearing hotspots"
          badge={<StatusBadge status="healthy" label="NOMINAL" isSimulated={true} />}
        >
          <div className="channel-box">
            <div className="channel-spec-row">
              <span className="spec-label">Primary Sensors:</span>
              <span className="mono-code">temp_gearbox_sump, temp_bearing_input</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Current Oil Temperature:</span>
              <span className="mono-code text-healthy">54.2 °C [SIMULATED]</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Warning Threshold:</span>
              <span className="mono-code">75.0 °C (Synthetic VG 220 limit)</span>
            </div>
            <div className="channel-spec-row">
              <span className="spec-label">Algorithm Assessment:</span>
              <span>Thermal equilibrium maintained. Heat dissipation normal; no indication of lubrication starvation.</span>
            </div>
          </div>
          <div className="trend-placeholder-box">
            <div className="trend-placeholder-text">
              📊 Simulated Thermal Time-Series Trend
              <div className="trend-subtext">Steady-state 52°C - 55°C envelope • Interactive chart will render in Phase 6</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Uncertainty & Sufficiency Explainer Card */}
      <Card
        title="Uncertainty, Data Sufficiency & Honest Scoring"
        subtitle="Rigorous engineering metrics reported separately from anomaly severity"
      >
        <div className="validation-checks-grid">
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Data Sufficiency: 98.5%</div>
              <div className="check-desc">Zero packet drops; 4,800 consecutive timestamps satisfy minimum Nyquist criterion for 100 Hz sampling.</div>
            </div>
          </div>
          <div className="check-item">
            <span className="check-icon">✓</span>
            <div>
              <div className="check-title">Operating Regime Confidence: High</div>
              <div className="check-desc">Machine operated within steady-state regime (1780 ± 15 RPM). Transient acceleration effects excluded.</div>
            </div>
          </div>
          <div className="check-item">
            <span className="check-icon">ℹ️</span>
            <div>
              <div className="check-title">No Uncalibrated "Failure Probabilities"</div>
              <div className="check-desc">System reports physical baseline deviations and Isolation Forest anomaly scores rather than fabricated failure percentages.</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

