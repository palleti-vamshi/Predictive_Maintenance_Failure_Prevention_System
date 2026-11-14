import React from 'react';
import Icon from '../common/Icon.jsx';

/**
 * SimulatorTimeline
 *
 * Visual timeline distinguishing:
 * 1. Healthy Baseline period
 * 2. Injected Scenario Ground Truth (clearly marked as [GROUND TRUTH: SIMULATED])
 * 3. Model Predictions (clearly marked as [MODEL INFERENCE: TELEMETRY ONLY])
 * 4. Alert Intervals (flags where persistence rules triggered an alert)
 *
 * Keeps ground truth visibly separate from operator-facing model predictions.
 */
export default function SimulatorTimeline({
  schedule,
  currentTime = 0,
  totalDuration = 60,
  modelPredictions = [],
  alerts = []
}) {
  const segments = schedule?.segments || [];
  const duration = Math.max(1, totalDuration);
  const playheadPercent = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  // Helper to calculate segment style
  const getSegmentStyle = (seg) => {
    const left = (seg.startTime / duration) * 100;
    const width = ((seg.endTime - seg.startTime) / duration) * 100;
    return {
      left: `${left}%`,
      width: `${Math.max(0.5, width)}%`
    };
  };

  return (
    <div
      data-testid="simulator-timeline"
      style={{
        background: '#ffffff',
        border: '1px solid var(--border-subtle, #e2e8f0)',
        borderRadius: '10px',
        padding: '1.1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
      }}
    >
      {/* Header with Title and Current Simulation Time */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
          <Icon name="activity" size={16} color="var(--primary, #0f766e)" />
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
            Demonstration Scenario & Detection Timeline
          </span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '0.15rem 0.45rem',
              borderRadius: '4px',
              background: '#f1f5f9',
              color: '#475569',
              letterSpacing: '0.04em'
            }}
          >
            SEED #{schedule?.seed ?? 42} • [SIMULATED]
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.78rem' }}>
          <div style={{ color: 'var(--text-muted, #64748b)' }}>
            Progress:{' '}
            <strong style={{ color: 'var(--text-primary, #0f172a)', fontFamily: 'var(--font-mono)' }}>
              {currentTime.toFixed(1)}s / {duration.toFixed(0)}s
            </strong>
          </div>
        </div>
      </div>

      {/* Main Multi-Track Timeline Container */}
      <div
        style={{
          position: 'relative',
          paddingTop: '0.25rem',
          paddingBottom: '0.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem'
        }}
      >
        {/* Playhead Indicator (Vertical Needle Across All Tracks) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${playheadPercent}%`,
            width: '2px',
            background: '#0f766e',
            zIndex: 10,
            pointerEvents: 'none',
            boxShadow: '0 0 4px rgba(15, 118, 110, 0.5)'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-6px',
              left: '-4px',
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              background: '#0f766e',
              border: '2px solid #ffffff'
            }}
          />
        </div>

        {/* TRACK 1: Ground Truth Scenario (Injected Physical Events) */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              marginBottom: '0.25rem'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#e0f2fe', border: '1px solid #0284c7' }} />
              TRACK 1: INJECTED SCENARIO GROUND TRUTH
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
              (Physical Fault Schedule · Un-Leaked from Model)
            </span>
          </div>

          <div
            style={{
              position: 'relative',
              height: '28px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              overflow: 'hidden'
            }}
          >
            {segments.map((seg) => {
              const isHealthy = seg.isHealthy;
              const isPast = currentTime >= seg.endTime;
              const isActive = currentTime >= seg.startTime && currentTime < seg.endTime;

              let bg = '#dcfce7'; // mint green for healthy
              let borderColor = '#86efac';
              let textColor = '#166534';

              if (!isHealthy) {
                bg = isActive ? '#fee2e2' : '#fef3c7'; // red if active, amber if scheduled
                borderColor = isActive ? '#f87171' : '#fcd34d';
                textColor = isActive ? '#991b1b' : '#92400e';
              }

              return (
                <div
                  key={seg.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    ...getSegmentStyle(seg),
                    background: bg,
                    borderRight: '1px solid #cbd5e1',
                    borderLeft: `2px solid ${borderColor}`,
                    padding: '0 0.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: textColor,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    boxSizing: 'border-box'
                  }}
                  title={`${seg.faultName} (${seg.startTime.toFixed(1)}s - ${seg.endTime.toFixed(1)}s)${!seg.isHealthy ? ` • Severity: ${Math.round(seg.severity * 100)}%` : ''}`}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {seg.isHealthy ? seg.faultName : `${seg.faultName} (${Math.round(seg.severity * 100)}%)`}
                  </span>
                  <span style={{ fontSize: '0.62rem', opacity: 0.75 }}>
                    {(seg.endTime - seg.startTime).toFixed(0)}s
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* TRACK 2: Operator-Facing Model Inference (Rolling Windows) */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              marginBottom: '0.25rem'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#ede9fe', border: '1px solid #7c3aed' }} />
              TRACK 2: MODEL INFERENCES & ANOMALY DETECTION
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
              (Isolation Forest Deviation + Random Forest Gear Classifier)
            </span>
          </div>

          <div
            style={{
              position: 'relative',
              height: '28px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              overflow: 'hidden'
            }}
          >
            {modelPredictions.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '0.6rem',
                  fontSize: '0.7rem',
                  color: '#94a3b8',
                  fontStyle: 'italic'
                }}
              >
                Awaiting rolling telemetry window (accumulating samples)...
              </div>
            ) : (
              modelPredictions.map((pred, i) => {
                const left = (pred.windowStartTime / duration) * 100;
                const width = ((pred.windowEndTime - pred.windowStartTime) / duration) * 100;

                const isAnomaly = pred.isolationForest?.isAnomaly;
                const rf = pred.randomForest;

                let bg = '#ecfdf5';
                let textColor = '#065f46';
                let label = 'Nominal';

                if (isAnomaly) {
                  if (rf?.isSupportedDomain && rf?.predictedClass === 'gear_tooth_wear') {
                    bg = '#f3e8ff'; // purple for verified gear classifier
                    textColor = '#6b21a8';
                    label = 'Gear Tooth Wear';
                  } else {
                    bg = '#ffedd5'; // orange for anomaly / unsupported by RF
                    textColor = '#9a3412';
                    label = 'Anomaly (Out of Domain)';
                  }
                }

                return (
                  <div
                    key={`pred_${i}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${left}%`,
                      width: `${Math.max(0.6, width)}%`,
                      background: bg,
                      borderRight: '1px solid rgba(0,0,0,0.06)',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 0.25rem',
                      fontSize: '0.64rem',
                      fontWeight: 600,
                      color: textColor,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={`Window ${pred.windowStartTime.toFixed(1)}s - ${pred.windowEndTime.toFixed(1)}s\nAnomaly Score: ${pred.isolationForest?.anomalyScore}\nRandom Forest: ${rf?.label || 'Healthy'}`}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {width > 4 ? label : ''}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* TRACK 3: Alert Trigger Markers & Cooldown Intervals */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              marginBottom: '0.25rem'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#dc2626' }} />
              TRACK 3: PERSISTENT ALERT TRIGGERS (DEDUPLICATED)
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
              (K=2 Consecutive Window Persistence Rule Satisfied)
            </span>
          </div>

          <div
            style={{
              position: 'relative',
              height: '24px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              borderRadius: '6px'
            }}
          >
            {alerts.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '0.6rem',
                  fontSize: '0.68rem',
                  color: '#94a3b8'
                }}
              >
                No condition alerts triggered yet.
              </div>
            ) : (
              alerts.map((alert) => {
                const left = (alert.simTime / duration) * 100;
                const isCritical = alert.severity === 'critical';

                return (
                  <div
                    key={alert.id}
                    style={{
                      position: 'absolute',
                      left: `${left}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      background: isCritical ? '#dc2626' : '#d97706',
                      color: '#ffffff',
                      borderRadius: '10px',
                      padding: '0.1rem 0.45rem',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.2rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
                      whiteSpace: 'nowrap',
                      zIndex: 5
                    }}
                    title={`${alert.title}\nTime: ${alert.simTime}s\nScore: ${alert.anomalyScore}\nEvidence: ${alert.evidence?.join('; ')}`}
                  >
                    <span>⚠️</span>
                    <span>{alert.severity.toUpperCase()} @ {alert.simTime.toFixed(0)}s</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Time Axis Markings */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.68rem',
            color: '#64748b',
            fontFamily: 'var(--font-mono)',
            padding: '0 2px'
          }}
        >
          <span>0s</span>
          <span>{(duration * 0.25).toFixed(0)}s</span>
          <span>{(duration * 0.5).toFixed(0)}s</span>
          <span>{(duration * 0.75).toFixed(0)}s</span>
          <span>{duration.toFixed(0)}s</span>
        </div>
      </div>

      {/* Legend & Truthfulness Boundary Notice */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingTop: '0.4rem',
          borderTop: '1px solid #f1f5f9',
          fontSize: '0.72rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '10px', height: '10px', background: '#dcfce7', border: '1px solid #86efac', borderRadius: '2px' }} />
            Healthy Baseline
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '10px', height: '10px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '2px' }} />
            Injected Fault (Ground Truth)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '10px', height: '10px', background: '#f3e8ff', border: '1px solid #c084fc', borderRadius: '2px' }} />
            RF Classified Fault
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span style={{ width: '10px', height: '10px', background: '#ffedd5', border: '1px solid #fdba74', borderRadius: '2px' }} />
            Anomaly (Out of RF Domain)
          </span>
        </div>

        <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.7rem' }}>
          Ground truth metadata is kept strictly isolated from model inference inputs to prevent data leakage.
        </div>
      </div>
    </div>
  );
}
