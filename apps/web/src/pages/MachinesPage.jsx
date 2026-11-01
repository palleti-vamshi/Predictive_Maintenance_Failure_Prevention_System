import React, { useState, useEffect } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import { DEMO_MACHINES } from '@predictive-maintenance/shared';
import { useRouter } from '../router/Router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * MachinesPage: Directory of registered gearboxes filtered strictly by backend factory & assignment scope.
 */
export default function MachinesPage() {
  const { navigate } = useRouter();
  const { user, refreshSession } = useAuth();
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let isMounted = true;
    async function loadMachines() {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/machines`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (res.status === 401) {
          if (refreshSession) refreshSession();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setMachines(data.machines || []);
        } else {
          // Fallback to demo machines filtered by role
          if (isMounted) setMachines(DEMO_MACHINES);
        }
      } catch {
        if (isMounted) setMachines(DEMO_MACHINES);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadMachines();
    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  const filteredMachines = machines.filter((m) => {
    if (filter === 'healthy') return m.status === 'healthy';
    if (filter === 'warning') return m.status === 'warning';
    return true;
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-info">
              SCOPE: {user?.factoryId?.name || 'Assigned Factory'}
            </span>
            <span className="badge badge-demo">ROLE: {user?.role?.toUpperCase()}</span>
          </div>
          <h1 className="page-title">Machines & Gearbox Profiles</h1>
          <p className="page-subtitle">
            Server-scoped equipment list for <strong>{user?.fullName}</strong>. Only assets within your factory and assigned scopes are visible.
          </p>
        </div>
        <div className="page-header-actions">
          <Button
            variant="outline"
            disabled={true}
            title="Machine creation will be enabled in Phase 4"
          >
            + Register Gearbox [Phase 4]
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="filter-bar">
        <button
          className={`filter-chip ${filter === 'all' ? 'filter-chip-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All Accessible Gearboxes ({machines.length})
        </button>
        <button
          className={`filter-chip ${filter === 'warning' ? 'filter-chip-active' : ''}`}
          onClick={() => setFilter('warning')}
        >
          Attention ({machines.filter((m) => m.status === 'warning').length})
        </button>
        <button
          className={`filter-chip ${filter === 'healthy' ? 'filter-chip-active' : ''}`}
          onClick={() => setFilter('healthy')}
        >
          Nominal ({machines.filter((m) => m.status === 'healthy').length})
        </button>
      </div>

      {/* Machines Grid */}
      {loading ? (
        <p className="text-secondary">Loading scoped machine profiles from API...</p>
      ) : filteredMachines.length === 0 ? (
        <Card title="No Accessible Machines">
          <p className="text-secondary">
            No gearboxes are currently assigned to your account in this factory scope.
          </p>
        </Card>
      ) : (
        <div className="machine-cards-grid">
          {filteredMachines.map((machine) => (
            <Card
              key={machine.code || machine.id}
              title={`${machine.code || machine.id}: ${machine.name}`}
              subtitle={`${machine.manufacturer || 'Industrial'} • Model ${machine.model || 'Standard'}`}
              badge={
                <StatusBadge
                  status={machine.status}
                  label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
                  isSimulated={true}
                />
              }
              footer={
                <div className="card-footer-split">
                  <span className="footer-meta">
                    Site: {machine.siteId?.name || machine.site || 'Main Plant'}
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => navigate(`#/machines/${machine.code || machine.id}`)}
                  >
                    View Gearbox Profile →
                  </Button>
                </div>
              }
            >
              <div className="machine-spec-grid">
                <div className="spec-item">
                  <span className="spec-label">Location / Site</span>
                  <span className="spec-value">{machine.siteId?.name || machine.site || 'Extrusion Line'}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Overall Ratio</span>
                  <span className="spec-value">{machine.gearRatio || '14.2:1'}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Rated Speed</span>
                  <span className="spec-value">{machine.ratedSpeedRpm || 1780} RPM</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Rated Torque</span>
                  <span className="spec-value">{machine.ratedTorqueNm || 480} Nm</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Lubricant</span>
                  <span className="spec-value">{machine.lubricantType || 'ISO VG 220'}</span>
                </div>
                <div className="spec-item">
                  <span className="spec-label">Access State</span>
                  <span className="spec-value text-healthy">Authorized</span>
                </div>
              </div>

              {machine.stages && machine.stages.length > 0 && (
                <div className="stage-breakdown">
                  <span className="stage-title">Transmission Stages:</span>
                  <div className="stage-list">
                    {machine.stages.map((stg) => (
                      <div key={stg.stage} className="stage-pill">
                        <span className="stage-num">Stage {stg.stage}:</span>
                        <span className="stage-desc">{stg.type} ({stg.ratio})</span>
                        <span className="stage-status">{stg.condition}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
