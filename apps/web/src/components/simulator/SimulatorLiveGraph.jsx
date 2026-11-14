import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';

/**
 * SimulatorLiveGraph
 * Real-time multi-signal time-series canvas graph with ISO 10816-3 threshold overlays,
 * time window controls, and fault event annotations.
 */
export default function SimulatorLiveGraph({
  liveSnapshot,
  simRunning,
  activeFault,
  onToggleRunning,
  machineId,
  connectionStatus = 'waiting'
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Time window: 10s, 30s, or 60s
  const [timeWindowSec, setTimeWindowSec] = useState(30);

  // Visible signal channels
  const [activeChannels, setActiveChannels] = useState({
    vibRms: true,
    rpm: true,
    inRpm: false,
    torque: true,
    coolant: false,
    gearboxTemp: false
  });

  // Rolling buffer: array of { timestamp, vibRms, rpm, torque, coolant, fault }
  const bufferRef = useRef([]);
  const [lastFrameTime, setLastFrameTime] = useState(Date.now());
  const [isPaused, setIsPaused] = useState(false);
  const faultEventsRef = useRef([]); // { timestamp, faultType }

  // Record fault changes as event markers
  const prevFaultRef = useRef(activeFault);
  useEffect(() => {
    if (activeFault !== prevFaultRef.current) {
      if (activeFault && activeFault !== 'none') {
        faultEventsRef.current.push({
          timestamp: Date.now(),
          faultType: activeFault
        });
        // Keep last 15 fault events
        if (faultEventsRef.current.length > 15) {
          faultEventsRef.current.shift();
        }
      }
      prevFaultRef.current = activeFault;
    }
  }, [activeFault]);

  // Append new data points from liveSnapshot ONLY when receiving real live telemetry
  useEffect(() => {
    if (isPaused) return;
    if (!liveSnapshot || typeof liveSnapshot.vibRms !== 'number' || connectionStatus !== 'connected') {
      return;
    }

    const now = Date.now();
    setLastFrameTime(now);

    const point = {
      timestamp: now,
      vibRms: Number.isFinite(liveSnapshot.vibRms) ? Number(liveSnapshot.vibRms) : null,
      rpm: Number.isFinite(liveSnapshot.rpm) ? Number(liveSnapshot.rpm) : null,
      inRpm: Number.isFinite(liveSnapshot.inRpm) ? Number(liveSnapshot.inRpm) : null,
      torque: Number.isFinite(liveSnapshot.torque) ? Number(liveSnapshot.torque) : null,
      coolant: Number.isFinite(liveSnapshot.coolant) ? Number(liveSnapshot.coolant) : null,
      gearboxTemp: Number.isFinite(liveSnapshot.gearboxTemp) ? Number(liveSnapshot.gearboxTemp) : null,
      fault: activeFault
    };

    bufferRef.current.push(point);

    // Prune points older than 70 seconds to prevent unbounded memory growth
    const cutoff = now - 70000;
    while (bufferRef.current.length > 0 && bufferRef.current[0].timestamp < cutoff) {
      bufferRef.current.shift();
    }
  }, [liveSnapshot, isPaused, activeFault, connectionStatus]);

  // Periodic tick broadcast to server SSE endpoint (throttled to 2 Hz)
  const lastBroadcastRef = useRef(0);
  useEffect(() => {
    if (isPaused || !simRunning || !liveSnapshot || connectionStatus !== 'connected') return;
    const now = Date.now();
    if (now - lastBroadcastRef.current >= 500) {
      lastBroadcastRef.current = now;
      fetch('/api/datasets/simulator-tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          machineId: machineId || undefined,
          rpm: liveSnapshot.rpm,
          inRpm: liveSnapshot.inRpm,
          outRpm: liveSnapshot.outRpm,
          torque: liveSnapshot.torque,
          powerKw: liveSnapshot.powerKw,
          coolant: liveSnapshot.coolant,
          egt: liveSnapshot.egt,
          vibRms: liveSnapshot.vibRms,
          faultType: activeFault !== 'none' ? activeFault : null,
          simTime: liveSnapshot.simTime ?? 0
        })
      }).catch(() => {
        // Non-blocking background tick
      });
    }
  }, [liveSnapshot, activeFault, isPaused, simRunning, machineId, connectionStatus]);

  // Channel configuration & normalization ranges
  const channelMeta = useMemo(() => ({
    vibRms: {
      name: 'Vibration RMS',
      unit: 'mm/s',
      color: activeFault !== 'none' ? '#DC4C4C' : '#0F766E',
      min: 0,
      max: 10,
      decimals: 2
    },
    rpm: {
      name: 'Shaft Speed',
      unit: 'RPM',
      color: '#2563EB',
      min: 0,
      max: 6000,
      decimals: 0
    },
    torque: {
      name: 'Torque',
      unit: 'Nm',
      color: '#D97706',
      min: 0,
      max: 200,
      decimals: 1
    },
    coolant: {
      name: 'Coolant Temp',
      unit: '°C',
      color: '#8B5CF6',
      min: 40,
      max: 120,
      decimals: 1
    },
    inRpm: {
      name: 'Gearbox In Speed',
      unit: 'RPM',
      color: '#0284C7',
      min: 0,
      max: 6000,
      decimals: 0
    },
    gearboxTemp: {
      name: 'Sump Oil Temp',
      unit: '°C',
      color: '#EA580C',
      min: 30,
      max: 130,
      decimals: 1
    }
  }), [activeFault]);

  // Canvas drawing loop
  useEffect(() => {
    let animId;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        animId = requestAnimationFrame(render);
        return;
      }

      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = 240;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Margin
      const padLeft = 60;
      const padRight = 30;
      const padTop = 24;
      const padBottom = 32;
      const plotW = width - padLeft - padRight;
      const plotH = height - padTop - padBottom;

      // Dark industrial grid background
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(padLeft, padTop, plotW, plotH);

      // Grid lines
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;

      // Horizontal grid lines (4 divisions)
      for (let i = 0; i <= 4; i++) {
        const y = padTop + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(padLeft + plotW, y);
        ctx.stroke();
      }

      // Time axis grid & labels
      const now = Date.now();
      const windowMs = timeWindowSec * 1000;
      const startTime = now - windowMs;
      const timeSteps = timeWindowSec === 10 ? 5 : timeWindowSec === 30 ? 6 : 6;
      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';

      for (let i = 0; i <= timeSteps; i++) {
        const x = padLeft + (plotW / timeSteps) * i;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        const secAgo = Math.round(timeWindowSec - (timeWindowSec / timeSteps) * i);
        const label = secAgo === 0 ? 'Now' : `-${secAgo}s`;
        ctx.fillText(label, x, padTop + plotH + 18);
      }

      // --- ISO 10816-3 Overlays (Group 1 Rigid: 1.2-2.2 normal, 4.5 alert, 7.1 danger) ---
      if (activeChannels.vibRms) {
        const vibMeta = channelMeta.vibRms;
        const getY = (val) => padTop + plotH - ((val - vibMeta.min) / (vibMeta.max - vibMeta.min)) * plotH;

        // Baseline Nominal Band (1.2 to 2.2 mm/s)
        const yNominalTop = getY(2.2);
        const yNominalBottom = getY(1.2);
        ctx.fillStyle = 'rgba(15, 118, 110, 0.16)';
        ctx.fillRect(padLeft, yNominalTop, plotW, yNominalBottom - yNominalTop);

        // Warning Threshold (4.5 mm/s) - Dashed Amber
        const yWarn = getY(4.5);
        ctx.save();
        ctx.strokeStyle = '#D97706';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yWarn);
        ctx.lineTo(padLeft + plotW, yWarn);
        ctx.stroke();
        ctx.restore();

        // Critical Threshold (7.1 mm/s) - Dashed Red
        const yCrit = getY(7.1);
        ctx.save();
        ctx.strokeStyle = '#DC4C4C';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, yCrit);
        ctx.lineTo(padLeft + plotW, yCrit);
        ctx.stroke();
        ctx.restore();

        // Overlay labels on right margin
        ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';

        ctx.fillStyle = '#DC4C4C';
        ctx.fillText('Crit: 7.1', padLeft + plotW + 4, yCrit + 3);

        ctx.fillStyle = '#D97706';
        ctx.fillText('Warn: 4.5', padLeft + plotW + 4, yWarn + 3);

        ctx.fillStyle = '#2DD4BF';
        ctx.fillText('Nominal', padLeft + plotW + 4, yNominalBottom - 3);
      }

      // --- Draw Event Markers (Fault Injections) ---
      faultEventsRef.current.forEach((evt) => {
        if (evt.timestamp >= startTime && evt.timestamp <= now) {
          const x = padLeft + ((evt.timestamp - startTime) / windowMs) * plotW;

          ctx.save();
          ctx.strokeStyle = '#F43F5E';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x, padTop);
          ctx.lineTo(x, padTop + plotH);
          ctx.stroke();

          // Marker chip
          ctx.fillStyle = '#F43F5E';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`⚡ ${evt.faultType}`, x, padTop - 6);
          ctx.restore();
        }
      });

      // Filter buffer points in view window
      const points = bufferRef.current.filter((p) => p.timestamp >= startTime && p.timestamp <= now);

      // Empty / Waiting state overlay on canvas
      if (points.length < 2) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        if (connectionStatus === 'waiting') {
          ctx.fillStyle = '#64748B';
          ctx.fillText('◌ Initializing 100 Hz simulation solver... Awaiting telemetry frames', padLeft + plotW / 2, padTop + plotH / 2);
        } else if (connectionStatus === 'disconnected') {
          ctx.fillStyle = '#DC4C4C';
          ctx.fillText('⚠ Telemetry feed paused or disconnected. Ensure the simulation engine is running.', padLeft + plotW / 2, padTop + plotH / 2);
        } else {
          ctx.fillStyle = '#0F766E';
          ctx.fillText('● Buffer warming up... Collecting live telemetry samples', padLeft + plotW / 2, padTop + plotH / 2);
        }
        ctx.restore();
      }

      // --- Draw Channels ---
      Object.keys(activeChannels).forEach((channelKey) => {
        if (!activeChannels[channelKey] || points.length < 2) return;

        const meta = channelMeta[channelKey];
        const getY = (val) => padTop + plotH - Math.max(0, Math.min(1, (val - meta.min) / (meta.max - meta.min))) * plotH;

        ctx.strokeStyle = meta.color;
        ctx.lineWidth = channelKey === 'vibRms' ? 2.2 : 1.5;
        ctx.beginPath();

        let isDrawing = false;
        points.forEach((p) => {
          const val = p[channelKey];
          if (val === null || val === undefined || !Number.isFinite(val)) {
            // Data gap / unavailable frame: lift pen so we do not draw a false plunge to 0
            isDrawing = false;
            return;
          }
          const x = padLeft + ((p.timestamp - startTime) / windowMs) * plotW;
          const y = getY(val);

          if (!isDrawing) {
            ctx.moveTo(x, y);
            isDrawing = true;
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        // Draw glowing point at newest value if valid
        const validPoints = points.filter((p) => Number.isFinite(p[channelKey]));
        if (validPoints.length > 0) {
          const lastP = validPoints[validPoints.length - 1];
          const lastX = padLeft + ((lastP.timestamp - startTime) / windowMs) * plotW;
          const lastY = getY(lastP[channelKey]);

          ctx.fillStyle = meta.color;
          ctx.beginPath();
          ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Left axis scale ticks (based on primary channel: Vibration RMS)
      if (activeChannels.vibRms) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
          const val = (channelMeta.vibRms.max / 4) * (4 - i);
          const y = padTop + (plotH / 4) * i;
          ctx.fillText(`${val.toFixed(1)}`, padLeft - 8, y + 3);
        }
        ctx.save();
        ctx.translate(14, padTop + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#64748B';
        ctx.fillText('Vibration RMS (mm/s)', 0, 0);
        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [timeWindowSec, activeChannels, channelMeta, connectionStatus]);

  // Toggle channel
  const toggleChannel = (key) => {
    setActiveChannels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const elapsedSeconds = lastFrameTime ? Math.max(0, ((Date.now() - lastFrameTime) / 1000).toFixed(1)) : '—';

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '8px',
        border: '1px solid #E2E8F0',
        padding: '1rem',
        marginBottom: '1.25rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}
    >
      {/* Top Header & Connection Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '0.85rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.25rem 0.6rem',
              borderRadius: '20px',
              fontSize: '0.72rem',
              fontWeight: 700,
              background:
                connectionStatus === 'connected'
                  ? (isPaused ? 'rgba(100, 116, 139, 0.12)' : 'rgba(16, 185, 129, 0.12)')
                  : connectionStatus === 'disconnected'
                  ? 'rgba(220, 76, 76, 0.12)'
                  : 'rgba(59, 130, 246, 0.12)',
              color:
                connectionStatus === 'connected'
                  ? (isPaused ? '#64748B' : '#059669')
                  : connectionStatus === 'disconnected'
                  ? '#DC4C4C'
                  : '#2563EB',
              border:
                connectionStatus === 'connected'
                  ? (isPaused ? '1px solid #CBD5E1' : '1px solid rgba(16, 185, 129, 0.3)')
                  : connectionStatus === 'disconnected'
                  ? '1px solid rgba(220, 76, 76, 0.3)'
                  : '1px solid rgba(59, 130, 246, 0.3)'
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background:
                  connectionStatus === 'connected'
                    ? (isPaused ? '#64748B' : '#10B981')
                    : connectionStatus === 'disconnected'
                    ? '#DC4C4C'
                    : '#3B82F6',
                boxShadow:
                  connectionStatus === 'connected' && !isPaused
                    ? '0 0 6px #10B981'
                    : connectionStatus === 'disconnected'
                    ? '0 0 6px #DC4C4C'
                    : 'none'
              }}
            />
            {connectionStatus === 'connected'
              ? (isPaused ? 'STREAM PAUSED' : `LIVE STREAM · ${liveSnapshot?.operatingState || 'RUNNING'}`)
              : connectionStatus === 'disconnected'
              ? 'DISCONNECTED'
              : 'WAITING FOR SIMULATOR'}
          </span>

          <span style={{ fontSize: '0.72rem', color: '#64748B' }}>
            {connectionStatus === 'connected'
              ? (isPaused ? 'Paused' : `Frame: ${elapsedSeconds}s ago`)
              : connectionStatus === 'disconnected'
              ? 'No frames > 2s'
              : 'Awaiting first frame'}
          </span>

          <span
            className="badge"
            style={{
              backgroundColor: 'rgba(217, 119, 6, 0.12)',
              color: '#D97706',
              border: '1px solid rgba(217, 119, 6, 0.25)',
              fontSize: '0.68rem',
              fontWeight: 700
            }}
          >
            [SIMULATED DATASET]
          </span>
        </div>

        {/* Time Window & Pause Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => setIsPaused(!isPaused)}
            style={{
              padding: '0.25rem 0.65rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              borderRadius: '5px',
              border: '1px solid #CBD5E1',
              background: isPaused ? '#0F766E' : '#F8FAFC',
              color: isPaused ? '#FFFFFF' : '#334155',
              cursor: 'pointer'
            }}
          >
            {isPaused ? '▶ Resume Graph' : '❚❚ Pause Graph'}
          </button>

          <div style={{ display: 'flex', background: '#F1F5F9', borderRadius: '5px', padding: '2px' }}>
            {[10, 30, 60].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setTimeWindowSec(sec)}
                style={{
                  padding: '0.2rem 0.55rem',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: '4px',
                  background: timeWindowSec === sec ? '#FFFFFF' : 'transparent',
                  color: timeWindowSec === sec ? '#0F766E' : '#64748B',
                  boxShadow: timeWindowSec === sec ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer'
                }}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Canvas Graph */}
      <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '240px',
            display: 'block',
            borderRadius: '6px'
          }}
        />
      </div>

      {/* Channel Selectors & Real-Time Legend */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginTop: '0.75rem',
          paddingTop: '0.65rem',
          borderTop: '1px solid #F1F5F9'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Vibration RMS */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.vibRms ? channelMeta.vibRms.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.vibRms}
              onChange={() => toggleChannel('vibRms')}
              style={{ accentColor: channelMeta.vibRms.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.vibRms.color
              }}
            />
            Vibration RMS:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {(liveSnapshot?.vibRms ?? 1.15).toFixed(2)} mm/s
            </strong>
          </label>

          {/* RPM */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.rpm ? channelMeta.rpm.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.rpm}
              onChange={() => toggleChannel('rpm')}
              style={{ accentColor: channelMeta.rpm.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.rpm.color
              }}
            />
            Speed:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {Math.round(liveSnapshot?.rpm ?? 1000)} RPM
            </strong>
          </label>

          {/* Torque */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.torque ? channelMeta.torque.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.torque}
              onChange={() => toggleChannel('torque')}
              style={{ accentColor: channelMeta.torque.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.torque.color
              }}
            />
            Torque:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {(liveSnapshot?.torque ?? 13.5).toFixed(1)} Nm
            </strong>
          </label>

          {/* Coolant */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.coolant ? channelMeta.coolant.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.coolant}
              onChange={() => toggleChannel('coolant')}
              style={{ accentColor: channelMeta.coolant.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.coolant.color
              }}
            />
            Coolant:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {(liveSnapshot?.coolant ?? 81.5).toFixed(1)} °C
            </strong>
          </label>

          {/* In RPM Channel Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.inRpm ? channelMeta.inRpm.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.inRpm}
              onChange={() => toggleChannel('inRpm')}
              style={{ accentColor: channelMeta.inRpm.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.inRpm.color
              }}
            />
            Gearbox In:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {Math.round(liveSnapshot?.inRpm ?? 1000)} RPM
            </strong>
          </label>

          {/* Sump Oil Temp Channel Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: activeChannels.gearboxTemp ? channelMeta.gearboxTemp.color : '#94A3B8',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={activeChannels.gearboxTemp}
              onChange={() => toggleChannel('gearboxTemp')}
              style={{ accentColor: channelMeta.gearboxTemp.color }}
            />
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '2px',
                background: channelMeta.gearboxTemp.color
              }}
            />
            Sump Temp:{' '}
            <strong style={{ fontFamily: 'monospace' }}>
              {(liveSnapshot?.gearboxTemp ?? 52.0).toFixed(1)} °C
            </strong>
          </label>
        </div>

        {/* ISO 10816 Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.7rem', color: '#64748B' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: '10px', height: '6px', background: 'rgba(15, 118, 110, 0.4)', borderRadius: '1px' }} />
            ISO Baseline (1.2–2.2 mm/s)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: '10px', height: '2px', background: '#D97706', borderTop: '1px dashed #D97706' }} />
            Zone C Warn (4.5 mm/s)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: '10px', height: '2px', background: '#DC4C4C', borderTop: '1px dashed #DC4C4C' }} />
            Zone D Crit (7.1 mm/s)
          </span>
        </div>
      </div>
    </div>
  );
}

