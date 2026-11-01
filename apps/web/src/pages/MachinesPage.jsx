import React, { useState, useEffect, useCallback } from 'react';
import Card from '../components/common/Card.jsx';
import StatusBadge from '../components/common/StatusBadge.jsx';
import Button from '../components/common/Button.jsx';
import AlertCallout from '../components/common/AlertCallout.jsx';
import {
  USER_ROLES,
  OPERATIONAL_STATUS,
  GEARBOX_ARRANGEMENTS,
  ISO_VG_GRADES
} from '@predictive-maintenance/shared';
import { useRouter } from '../router/Router.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

export default function MachinesPage() {
  const { navigate } = useRouter();
  const { user, refreshSession } = useAuth();
  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;

  const [machines, setMachines] = useState([]);
  const [sites, setSites] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [operationalFilter, setOperationalFilter] = useState('all');
  const [includeDecommissioned, setIncludeDecommissioned] = useState(true);

  // Modals state
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // New Machine Form State
  const [newMachine, setNewMachine] = useState({
    code: '',
    name: '',
    siteId: '',
    manufacturer: '',
    model: '',
    serialNumber: '',
    arrangement: 'Helical-Planetary',
    gearRatio: '14.2:1',
    ratedSpeedRpm: '1780',
    ratedTorqueNm: '480',
    stages: [
      { stage: 1, type: 'Planetary Reduction Stage', ratio: '3.5:1', conditionNotes: 'Nominal' },
      { stage: 2, type: 'Helical Output Stage', ratio: '4.06:1', conditionNotes: 'Nominal' }
    ],
    lubrication: {
      oilType: 'Synthetic Polyalphaolefin (PAO)',
      isoVgGrade: 'ISO VG 220',
      capacityLiters: '18.5',
      serviceIntervalHours: '4000'
    },
    assignedTechnicians: []
  });

  // New Site Form State
  const [newSite, setNewSite] = useState({
    name: '',
    code: '',
    area: '',
    description: ''
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch scoped machines
      const mUrl = `${API_BASE}/machines?includeDecommissioned=${includeDecommissioned}`;
      const mRes = await fetch(mUrl, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (mRes.status === 401 && refreshSession) {
        refreshSession();
        return;
      }
      if (mRes.ok) {
        const mData = await mRes.json();
        setMachines(mData.machines || []);
      }

      // 2. Fetch factory sites
      const sRes = await fetch(`${API_BASE}/sites`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        setSites(sData.sites || []);
        if (sData.sites?.length > 0 && !newMachine.siteId) {
          setNewMachine((prev) => ({ ...prev, siteId: sData.sites[0]._id }));
        }
      }

      // 3. If manager, fetch factory technicians for assignment
      if (isManager) {
        const uRes = await fetch(`${API_BASE}/admin/factory-users`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (uRes.ok) {
          const uData = await uRes.json();
          const techs = (uData.users || []).filter((u) => u.role === USER_ROLES.TECHNICIAN);
          setTechnicians(techs);
        }
      }
    } catch (err) {
      console.warn('[MachinesPage] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [includeDecommissioned, isManager, newMachine.siteId, refreshSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle stage editor
  const handleAddStage = () => {
    setNewMachine((prev) => ({
      ...prev,
      stages: [
        ...prev.stages,
        {
          stage: prev.stages.length + 1,
          type: 'Helical Stage',
          ratio: '3.0:1',
          conditionNotes: 'Nominal'
        }
      ]
    }));
  };

  const handleRemoveStage = (idx) => {
    setNewMachine((prev) => ({
      ...prev,
      stages: prev.stages.filter((_, i) => i !== idx)
    }));
  };

  const handleStageChange = (idx, field, val) => {
    setNewMachine((prev) => {
      const updated = [...prev.stages];
      updated[idx] = { ...updated[idx], [field]: val };
      return { ...prev, stages: updated };
    });
  };

  // Submit new machine
  const handleCreateMachine = async (e) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);

    try {
      const payload = {
        code: newMachine.code.trim().toUpperCase(),
        name: newMachine.name.trim(),
        siteId: newMachine.siteId,
        manufacturer: newMachine.manufacturer.trim(),
        model: newMachine.model.trim(),
        serialNumber: newMachine.serialNumber.trim(),
        arrangement: newMachine.arrangement,
        gearRatio: newMachine.gearRatio.trim(),
        ratedSpeedRpm: Number(newMachine.ratedSpeedRpm) || undefined,
        ratedTorqueNm: Number(newMachine.ratedTorqueNm) || undefined,
        stages: newMachine.stages,
        lubrication: {
          oilType: newMachine.lubrication.oilType,
          isoVgGrade: newMachine.lubrication.isoVgGrade,
          capacityLiters: Number(newMachine.lubrication.capacityLiters) || undefined,
          serviceIntervalHours: Number(newMachine.lubrication.serviceIntervalHours) || undefined
        },
        assignedTechnicians: newMachine.assignedTechnicians
      };

      const res = await fetch(`${API_BASE}/machines`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || `Creation failed: ${res.status}`);
        return;
      }

      setShowMachineModal(false);
      setNewMachine({
        code: '',
        name: '',
        siteId: sites[0]?._id || '',
        manufacturer: '',
        model: '',
        serialNumber: '',
        arrangement: 'Helical-Planetary',
        gearRatio: '14.2:1',
        ratedSpeedRpm: '1780',
        ratedTorqueNm: '480',
        stages: [
          { stage: 1, type: 'Planetary Reduction Stage', ratio: '3.5:1', conditionNotes: 'Nominal' },
          { stage: 2, type: 'Helical Output Stage', ratio: '4.06:1', conditionNotes: 'Nominal' }
        ],
        lubrication: {
          oilType: 'Synthetic Polyalphaolefin (PAO)',
          isoVgGrade: 'ISO VG 220',
          capacityLiters: '18.5',
          serviceIntervalHours: '4000'
        },
        assignedTechnicians: []
      });
      loadData();
    } catch (err) {
      setFormError(err.message || 'Network error creating machine.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Submit new site
  const handleCreateSite = async (e) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/sites`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(newSite)
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.message || `Site creation failed: ${res.status}`);
        return;
      }

      setShowSiteModal(false);
      setNewSite({ name: '', code: '', area: '', description: '' });
      loadData();
    } catch (err) {
      setFormError(err.message || 'Network error creating site.');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Filtering
  const filteredMachines = machines.filter((m) => {
    if (statusFilter !== 'all' && m.status !== statusFilter) return false;
    if (siteFilter !== 'all' && (m.siteId?._id !== siteFilter && m.siteId !== siteFilter)) return false;
    if (operationalFilter !== 'all' && m.operationalStatus !== operationalFilter) return false;
    return true;
  });

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="specimen-tag-row">
            <span className="badge badge-info">
              FACTORY: {user?.factoryId?.name || 'Assigned Plant'}
            </span>
            <span className="badge badge-demo">ROLE: {user?.role?.toUpperCase()}</span>
          </div>
          <h1 className="page-title">Machines & Gearbox Profiles</h1>
          <p className="page-subtitle">
            Server-enforced equipment registry for <strong>{user?.fullName}</strong>. Physical kinematics, multi-stage ratios, lubrication specifications, and operational statuses.
          </p>
        </div>

        {/* Manager Actions */}
        {isManager && (
          <div className="page-header-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setFormError(null);
                setShowSiteModal(true);
              }}
            >
              + Add Factory Site
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setFormError(null);
                setShowMachineModal(true);
              }}
              icon="⚙️"
            >
              + Register Gearbox Profile
            </Button>
          </div>
        )}
      </div>

      {/* Filter and Control Bar */}
      <Card title="Filter Equipment Scope">
        <div className="filters-row" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <label className="form-label" style={{ marginBottom: 4, display: 'block' }}>Production Site:</label>
            <select
              className="form-select"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              style={{ minWidth: 180 }}
            >
              <option value="all">All Factory Sites ({sites.length})</option>
              {sites.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.code}: {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: 4, display: 'block' }}>Operational Status:</label>
            <select
              className="form-select"
              value={operationalFilter}
              onChange={(e) => setOperationalFilter(e.target.value)}
              style={{ minWidth: 160 }}
            >
              <option value="all">All Operational States</option>
              <option value={OPERATIONAL_STATUS.OPERATIONAL}>Operational</option>
              <option value={OPERATIONAL_STATUS.STANDBY}>Standby</option>
              <option value={OPERATIONAL_STATUS.UNDER_MAINTENANCE}>Under Maintenance</option>
              <option value={OPERATIONAL_STATUS.DECOMMISSIONED}>Decommissioned</option>
            </select>
          </div>

          <div>
            <label className="form-label" style={{ marginBottom: 4, display: 'block' }}>Measured Condition:</label>
            <select
              className="form-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ minWidth: 150 }}
            >
              <option value="all">All Conditions</option>
              <option value="healthy">Nominal</option>
              <option value="warning">Attention</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: 18 }}>
            <label style={{ fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeDecommissioned}
                onChange={(e) => setIncludeDecommissioned(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Include Soft-Decommissioned Gearboxes
            </label>
          </div>
        </div>
      </Card>

      {/* Machines Grid */}
      {loading ? (
        <p className="text-secondary">Loading factory gearbox profiles from API...</p>
      ) : filteredMachines.length === 0 ? (
        <Card title="No Matching Machines Found">
          <p className="text-secondary">
            No gearboxes match the selected filter criteria within your factory scope.
          </p>
        </Card>
      ) : (
        <div className="machine-cards-grid">
          {filteredMachines.map((machine) => {
            const machineId = machine.code || machine.id;
            const isDecomm = machine.isDecommissioned || machine.operationalStatus === OPERATIONAL_STATUS.DECOMMISSIONED;

            return (
              <Card
                key={machine._id || machineId}
                title={`${machineId}: ${machine.name}`}
                subtitle={`${machine.manufacturer || 'Industrial'} • Model ${machine.model || 'Standard'}`}
                badge={
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge ${isDecomm ? 'badge-critical' : 'badge-info'}`}>
                      {machine.operationalStatus?.toUpperCase() || 'OPERATIONAL'}
                    </span>
                    <StatusBadge
                      status={machine.status}
                      label={machine.status === 'healthy' ? 'NOMINAL' : 'ATTENTION'}
                      isSimulated={!machine._id}
                    />
                  </div>
                }
                footer={
                  <div className="card-footer-split">
                    <span className="footer-meta">
                      Site: {machine.siteId?.name || machine.site || 'Factory Floor'}
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => navigate(`#/machines/${machineId}`)}
                    >
                      View Gearbox Profile →
                    </Button>
                  </div>
                }
              >
                {isDecomm && (
                  <div style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginBottom: 12,
                    fontSize: 12,
                    color: '#fca5a5'
                  }}>
                    ⚠️ <strong>Soft-Decommissioned:</strong> Unavailable for new operational analysis runs.
                    {machine.decommissionReason && <div>Reason: {machine.decommissionReason}</div>}
                  </div>
                )}

                <div className="machine-spec-grid">
                  <div className="spec-item">
                    <span className="spec-label">Arrangement</span>
                    <span className="spec-value">{machine.arrangement || 'Helical-Planetary'}</span>
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
                    <span className="spec-label">Lubricant Grade</span>
                    <span className="spec-value">{machine.lubrication?.isoVgGrade || machine.lubricantType || 'ISO VG 220'}</span>
                  </div>
                  <div className="spec-item">
                    <span className="spec-label">Reduction Stages</span>
                    <span className="spec-value">{machine.stages?.length || 2} Stages</span>
                  </div>
                </div>

                {/* Assigned Technicians */}
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e293b' }}>
                  <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Assigned Field Technicians:
                  </span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    {machine.assignedTechnicians && machine.assignedTechnicians.length > 0 ? (
                      machine.assignedTechnicians.map((t) => (
                        <span key={t._id || t} className="badge badge-info" style={{ fontSize: 11 }}>
                          👤 {t.fullName || t.name || 'Technician'}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>None currently assigned (Manager scope only)</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ================= MODAL: Register New Gearbox ================= */}
      {showMachineModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title-gearbox">
          <div className="modal-card" style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <h2 id="modal-title-gearbox" className="modal-title">Register Industrial Gearbox Profile</h2>
              <button
                className="modal-close-btn"
                onClick={() => setShowMachineModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="login-error-alert" role="alert" style={{ marginBottom: 12 }}>
                <span>⚠️ {formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateMachine} className="modal-form">
              {/* Identity Row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-code">Machine Code *</label>
                  <input
                    id="m-code"
                    type="text"
                    className="form-select"
                    placeholder="e.g. GB-301"
                    value={newMachine.code}
                    onChange={(e) => setNewMachine({ ...newMachine, code: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-name">Machine / Drive Name *</label>
                  <input
                    id="m-name"
                    type="text"
                    className="form-select"
                    placeholder="e.g. Extruder Secondary Pinion"
                    value={newMachine.name}
                    onChange={(e) => setNewMachine({ ...newMachine, name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-site">Factory Site *</label>
                  <select
                    id="m-site"
                    className="form-select"
                    value={newMachine.siteId}
                    onChange={(e) => setNewMachine({ ...newMachine, siteId: e.target.value })}
                    required
                  >
                    {sites.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.code}: {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Manufacturer Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-mfg">Manufacturer</label>
                  <input
                    id="m-mfg"
                    type="text"
                    className="form-select"
                    placeholder="e.g. Siemens / Flender"
                    value={newMachine.manufacturer}
                    onChange={(e) => setNewMachine({ ...newMachine, manufacturer: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-model">Model</label>
                  <input
                    id="m-model"
                    type="text"
                    className="form-select"
                    placeholder="e.g. B3SH-10"
                    value={newMachine.model}
                    onChange={(e) => setNewMachine({ ...newMachine, model: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="m-sn">Serial Number</label>
                  <input
                    id="m-sn"
                    type="text"
                    className="form-select"
                    placeholder="e.g. SN-FL-2024-11"
                    value={newMachine.serialNumber}
                    onChange={(e) => setNewMachine({ ...newMachine, serialNumber: e.target.value })}
                  />
                </div>
              </div>

              {/* Kinematics Specifications */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Arrangement</label>
                  <select
                    className="form-select"
                    value={newMachine.arrangement}
                    onChange={(e) => setNewMachine({ ...newMachine, arrangement: e.target.value })}
                  >
                    {GEARBOX_ARRANGEMENTS.map((arr) => (
                      <option key={arr} value={arr}>{arr}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Overall Ratio</label>
                  <input
                    type="text"
                    className="form-select"
                    placeholder="e.g. 14.2:1"
                    value={newMachine.gearRatio}
                    onChange={(e) => setNewMachine({ ...newMachine, gearRatio: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Rated Speed (RPM)</label>
                  <input
                    type="number"
                    className="form-select"
                    placeholder="e.g. 1780"
                    value={newMachine.ratedSpeedRpm}
                    onChange={(e) => setNewMachine({ ...newMachine, ratedSpeedRpm: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Rated Torque (Nm)</label>
                  <input
                    type="number"
                    className="form-select"
                    placeholder="e.g. 480"
                    value={newMachine.ratedTorqueNm}
                    onChange={(e) => setNewMachine({ ...newMachine, ratedTorqueNm: e.target.value })}
                  />
                </div>
              </div>

              {/* Stages List Editor */}
              <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label className="form-label" style={{ fontWeight: 700 }}>
                    Gear Stages Breakdown ({newMachine.stages.length} Stages)
                  </label>
                  <Button type="button" variant="secondary" size="sm" onClick={handleAddStage}>
                    + Add Stage
                  </Button>
                </div>

                {newMachine.stages.map((stg, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '60px 2fr 1fr 2fr 40px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>Stg {idx + 1}</span>
                    <input
                      type="text"
                      className="form-select"
                      placeholder="Stage Type (e.g. Planetary)"
                      value={stg.type}
                      onChange={(e) => handleStageChange(idx, 'type', e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      className="form-select"
                      placeholder="Ratio (3.5:1)"
                      value={stg.ratio}
                      onChange={(e) => handleStageChange(idx, 'ratio', e.target.value)}
                      required
                    />
                    <input
                      type="text"
                      className="form-select"
                      placeholder="Notes (e.g. Nominal tooth mesh)"
                      value={stg.conditionNotes}
                      onChange={(e) => handleStageChange(idx, 'conditionNotes', e.target.value)}
                    />
                    <button
                      type="button"
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}
                      onClick={() => handleRemoveStage(idx)}
                      title="Remove stage"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* Lubrication Specifications */}
              <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Lubricating Oil Type</label>
                  <input
                    type="text"
                    className="form-select"
                    placeholder="e.g. Synthetic Polyalphaolefin"
                    value={newMachine.lubrication.oilType}
                    onChange={(e) => setNewMachine({
                      ...newMachine,
                      lubrication: { ...newMachine.lubrication, oilType: e.target.value }
                    })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">ISO VG Grade</label>
                  <select
                    className="form-select"
                    value={newMachine.lubrication.isoVgGrade}
                    onChange={(e) => setNewMachine({
                      ...newMachine,
                      lubrication: { ...newMachine.lubrication, isoVgGrade: e.target.value }
                    })}
                  >
                    {ISO_VG_GRADES.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Sump Capacity (L)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="form-select"
                    placeholder="18.5"
                    value={newMachine.lubrication.capacityLiters}
                    onChange={(e) => setNewMachine({
                      ...newMachine,
                      lubrication: { ...newMachine.lubrication, capacityLiters: e.target.value }
                    })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Service Window (Hrs)</label>
                  <input
                    type="number"
                    className="form-select"
                    placeholder="4000"
                    value={newMachine.lubrication.serviceIntervalHours}
                    onChange={(e) => setNewMachine({
                      ...newMachine,
                      lubrication: { ...newMachine.lubrication, serviceIntervalHours: e.target.value }
                    })}
                  />
                </div>
              </div>

              {/* Technician Assignment */}
              <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12 }}>
                <label className="form-label" style={{ marginBottom: 4, display: 'block' }}>
                  Assign Authorized Technicians (Detroit Plant #2):
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {technicians.map((t) => {
                    const isSelected = newMachine.assignedTechnicians.includes(t._id);
                    return (
                      <button
                        key={t._id}
                        type="button"
                        className={`filter-chip ${isSelected ? 'filter-chip-active' : ''}`}
                        onClick={() => {
                          setNewMachine((prev) => ({
                            ...prev,
                            assignedTechnicians: isSelected
                              ? prev.assignedTechnicians.filter((id) => id !== t._id)
                              : [...prev.assignedTechnicians, t._id]
                          }));
                        }}
                      >
                        {isSelected ? '✓ ' : '+ '} {t.fullName} ({t.email})
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowMachineModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={formSubmitting}>
                  Register Gearbox Specimen
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: Add Factory Site ================= */}
      {showSiteModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title-site">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2 id="modal-title-site" className="modal-title">Create Factory Site Location</h2>
              <button
                className="modal-close-btn"
                onClick={() => setShowSiteModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="login-error-alert" role="alert" style={{ marginBottom: 12 }}>
                <span>⚠️ {formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateSite} className="modal-form">
              <div className="form-group">
                <label className="form-label" htmlFor="site-code">Site Code *</label>
                <input
                  id="site-code"
                  type="text"
                  className="form-select"
                  placeholder="e.g. ASY_BAY_2"
                  value={newSite.code}
                  onChange={(e) => setNewSite({ ...newSite, code: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="site-name">Site Name *</label>
                <input
                  id="site-name"
                  type="text"
                  className="form-select"
                  placeholder="e.g. Sub-Assembly Line 2"
                  value={newSite.name}
                  onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="site-area">Physical Area</label>
                <input
                  id="site-area"
                  type="text"
                  className="form-select"
                  placeholder="e.g. Building B, Level 1"
                  value={newSite.area}
                  onChange={(e) => setNewSite({ ...newSite, area: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="site-desc">Description</label>
                <textarea
                  id="site-desc"
                  className="form-select"
                  rows={3}
                  placeholder="Production purpose, equipment density, or safety zone"
                  value={newSite.description}
                  onChange={(e) => setNewSite({ ...newSite, description: e.target.value })}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Button type="button" variant="secondary" onClick={() => setShowSiteModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={formSubmitting}>
                  Create Site
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
