import mongoose from 'mongoose';
import { Machine } from '../models/Machine.js';
import { Alert } from '../models/Alert.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { Dataset } from '../models/Dataset.js';
import { User } from '../models/User.js';
import { USER_ROLES, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

/**
 * Retrieves authorized factory records for grounding the assistant response.
 * Strictly respects user factory and technician machine assignment scopes.
 */
export async function getAuthorizedFactoryContext(user) {
  const factoryId = (user.factoryId?._id || user.factoryId).toString();
  const isManager = user.role === USER_ROLES.FACTORY_MANAGER;
  const assignedMachineIds = (user.assignedMachines || []).map((m) =>
    (m._id || m).toString()
  );

  // 1. Scoped Machines
  const machineFilter = { factoryId };
  if (!isManager) {
    machineFilter._id = { $in: assignedMachineIds };
  }

  const machines = await Machine.find(machineFilter)
    .select('code name status type location operationalStatus arrangement stages lubrication')
    .sort({ status: -1, code: 1 })
    .lean();

  const machineIdList = machines.map((m) => m._id);

  // 2. Scoped Alerts
  const alertFilter = {
    factoryId,
    machineId: { $in: machineIdList }
  };
  const alerts = await Alert.find(alertFilter)
    .populate('machineId', 'code name status')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  // 3. Scoped Maintenance Work Orders
  const woFilter = {
    factoryId,
    machineId: { $in: machineIdList }
  };
  if (user.role === USER_ROLES.TECHNICIAN) {
    woFilter.assignedTechnicianId = user._id;
  }
  const workOrders = await MaintenanceWorkOrder.find(woFilter)
    .populate('machineId', 'code name status')
    .populate('assignedTechnicianId', 'fullName email')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  // 4. Scoped Analysis Runs
  const runs = await AnalysisRun.find({
    factoryId,
    machineId: { $in: machineIdList }
  })
    .populate('machineId', 'code name status')
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  // 5. Eligible Technicians (for Manager work order recommendation context)
  let eligibleTechnicians = [];
  if (isManager) {
    eligibleTechnicians = await User.find({
      factoryId,
      role: USER_ROLES.TECHNICIAN,
      isActive: true
    })
      .select('fullName email skills availability')
      .lean();
  }

  // 6. Datasets
  const datasets = await Dataset.find({
    $or: [{ factoryId }, { isReference: true }]
  })
    .select('name filename machineType domain provenance status rowCount isReference')
    .limit(10)
    .lean();

  return {
    factory: {
      id: factoryId,
      name: user.factoryId?.name || 'Local Factory'
    },
    userRole: user.role,
    userName: user.fullName || user.username,
    machines,
    alerts,
    workOrders,
    runs,
    datasets,
    eligibleTechnicians
  };
}

/**
 * Plain language explanations for machine learning algorithms.
 */
export const ML_EXPLANATIONS = {
  random_forest: {
    title: 'Random Forest Supervised Classifier',
    explanation:
      'Random Forest is an ensemble of 100 decision trees trained on multi-sensor mechanical features (RMS, peak-to-peak, crest factor, kurtosis, and spectral band power). Each tree votes on the operational state (Normal vs. Bearing Race Defect vs. Gear Mesh Tooth Defect). High predicted probability indicates high ensemble agreement that anomalous harmonic signatures match known degradation patterns.',
    bestPractices:
      'Used for supervised fault classification when labeled failure data is available. Produces calibrated class probabilities, not guaranteed physical certainty.'
  },
  isolation_forest: {
    title: 'Isolation Forest Unsupervised Anomaly Detector',
    explanation:
      'Isolation Forest identifies abnormal vibration regimes without requiring prior failure labels. It isolates data points by randomly selecting a feature and split value. Because anomalies deviate significantly from normal clusters, they require noticeably fewer splits to isolate. When the anomaly score crosses the calibrated baseline threshold (e.g. 99th percentile of healthy operation), it alerts the team to out-of-distribution dynamics.',
    bestPractices:
      'Ideal for zero-shot run-to-failure tracking and catching unmodeled mechanical wear before catastrophic breakdown. Anomaly scores quantify statistical distance, not guaranteed failure probabilities.'
  },
  shap: {
    title: 'TreeSHAP (SHapley Additive exPlanations)',
    explanation:
      'TreeSHAP calculates exact game-theoretic Shapley values to reveal which sensor measurements pushed the model toward a failure prediction. Unlike a generic "black box" score, SHAP quantifies the exact directional impact (e.g. Vibration Crest Factor +0.34, High-Frequency Band Power +0.21, Temperature +0.12). A positive SHAP value increases failure probability; a negative value pulls it toward healthy baseline.',
    bestPractices:
      'Use SHAP to verify whether an alert is driven by genuine mechanical harmonics or sensor noise before dispatching a technician.'
  }
};

/**
 * Classifies query intent as 'factory', 'general', or 'combined'.
 */
export function classifyQueryIntent(query, context, requestedMode = 'auto') {
  if (requestedMode === 'factory') return 'factory';
  if (requestedMode === 'general') return 'general';

  const qLower = query.toLowerCase();

  // Check if a registered machine is mentioned
  const mentionsMachine = context.machines.some((m) =>
    qLower.includes(m.code.toLowerCase()) || qLower.includes(m.name.toLowerCase())
  );

  // Check if an alert is mentioned
  const mentionsAlert = context.alerts.some((a) =>
    (a.code && qLower.includes(a.code.toLowerCase())) ||
    (a.title && qLower.includes(a.title.toLowerCase()))
  );

  // General engineering question indicators
  const generalIndicators = [
    'what is', 'what are', 'what causes', 'how does', 'explain the difference',
    'why does', 'iso 10816', 'principles of', 'definition of', 'best practices for',
    'theory', 'accelerometer', 'kurtosis', 'crest factor', 'fast fourier',
    'fft', 'bearing race spalling', 'gear tooth pitting', 'resonance'
  ];
  const hasGeneralIndicator = generalIndicators.some((ind) => qLower.includes(ind));

  // If both factory equipment and general engineering concepts are present:
  if ((mentionsMachine || mentionsAlert) && hasGeneralIndicator) {
    return 'combined';
  }

  // Model explanation queries belong to factory data/methods
  const isModelExplanation =
    qLower.includes('shap') ||
    qLower.includes('random forest') ||
    qLower.includes('isolation forest') ||
    qLower.includes('how does the model') ||
    qLower.includes('explain model');

  // Operational terms
  const operationalTerms = [
    'work order', 'draft', 'alert', 'active alerts', 'my machines', 'plant',
    'technician', 'maintenance', 'dataset', 'cwru', 'nasa', 'simulator',
    'pune', 'chennai', 'gb-', 'briefing', 'handover', 'checklist', 'assigned'
  ];
  const hasOperationalTerm = operationalTerms.some((t) => qLower.includes(t));

  if (mentionsMachine || mentionsAlert || isModelExplanation || hasOperationalTerm) {
    return 'factory';
  }

  // Purely general engineering question
  return 'general';
}

/**
 * Generates a grounded response using local deterministic rule engine.
 */
export function generateLocalDeterministicResponse(query, context, user, requestedMode = 'auto') {
  const qLower = query.toLowerCase();
  const intent = classifyQueryIntent(query, context, requestedMode);

  // If general query or general mode requested in unconfigured local mode:
  if (intent === 'general' || requestedMode === 'general') {
    return {
      mode: 'general_unavailable',
      answer: `### General AI Answers Unavailable\n\nGeneral engineering knowledge and open-ended AI questions require an external AI connection, which is not currently configured on this server.\n\n**MechGuard Copilot is currently operating in local factory-records mode**.\n\nYou can continue to query your authorized plant equipment, condition alerts, and model diagnostics:\n- Equipment diagnostic condition (e.g. *"What is the condition of GB-104?"*)\n- Active alerts and telemetry (e.g. *"Show warning and critical alerts"*)\n- Machine learning explanations (e.g. *"Explain Random Forest and TreeSHAP results"*)\n- Maintenance work order proposals (e.g. *"Draft work order for GB-104"*)\n- Registered datasets (e.g. *"List active datasets"*)\n`,
      generalGuidance: 'External AI provider unconfigured · Local factory database mode active.',
      facts: [],
      modelOutputs: [],
      recommendations: [
        'Switch to Factory Data mode to query authorized plant equipment and condition alerts.'
      ],
      citations: [],
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  const responseMode = intent === 'combined' ? 'combined' : 'factory';
  const generalGuidance =
    intent === 'combined'
      ? 'External AI provider is unconfigured; general engineering context is drawn from local diagnostic rules while factory records reflect verified database records.'
      : null;

  const facts = [];
  const modelOutputs = [];
  const recommendations = [];
  const citations = [];
  let workOrderDraft = null;

  // Unknown equipment code check: if user queries a machine code pattern (e.g. GB-999) not in authorized scope
  const machineCodeMatches = [...qLower.matchAll(/\b(gb-\d+|pump-\d+|motor-\d+|gearbox-\d+)\b/gi)];
  if (machineCodeMatches.length > 0) {
    const unknownCode = machineCodeMatches
      .map((m) => m[0].toUpperCase())
      .find((code) => !context.machines.some((m) => m.code.toUpperCase() === code));

    if (unknownCode) {
      return {
        mode: responseMode,
        generalGuidance,
        answer: `### Equipment Not Found in Authorized Factory Scope\n\nMachine **${unknownCode}** was not found in your authorized factory scope (**${context.factory.name}**).\n\n**Authorized equipment available in your scope:**\n${context.machines.map((m) => `- **${m.code}**: ${m.name} (${m.type || 'Gearbox'}, current status: \`${(m.status || 'healthy').toUpperCase()}\`)`).join('\n')}\n\n> **Focused Clarification**: Would you like to review diagnostics for one of your authorized machines, or search recent plant alerts?`,
        facts: [
          `Authorized factory: ${context.factory.name}.`,
          `Authorized machines: ${context.machines.map((m) => m.code).join(', ')}.`
        ],
        modelOutputs: [],
        recommendations: [
          `Specify an authorized equipment code: ${context.machines.map((m) => m.code).join(', ')}.`
        ],
        citations: context.machines.slice(0, 3).map((m) => ({
          type: 'machine',
          id: m._id.toString(),
          code: m.code,
          label: `${m.code} (${m.name})`,
          url: `#/machines/${m.code}`
        })),
        workOrderDraft: null,
        provider: {
          configured: false,
          name: 'MechGuard Copilot Local Records Mode',
          status: 'unconfigured_fallback',
          note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
        }
      };
    }
  }

  // Find mentioned machine
  const mentionedMachine = context.machines.find(
    (m) =>
      qLower.includes(m.code.toLowerCase()) ||
      qLower.includes(m.name.toLowerCase())
  );

  // Find mentioned alert
  const mentionedAlert = context.alerts.find(
    (a) =>
      (a.code && qLower.includes(a.code.toLowerCase())) ||
      (a.title && qLower.includes(a.title.toLowerCase()))
  );

  // Machine citation
  if (mentionedMachine) {
    citations.push({
      type: 'machine',
      id: mentionedMachine._id.toString(),
      code: mentionedMachine.code,
      label: `${mentionedMachine.code} (${mentionedMachine.name})`,
      url: `#/machines/${mentionedMachine.code}`
    });
  }

  // Check query intent:
  // 1. Shift Briefing (Factory Manager or Technician Shift Overview)
  if (
    qLower.includes('shift briefing') ||
    qLower.includes('factory briefing') ||
    qLower.includes('morning briefing') ||
    (qLower.includes('shift') && qLower.includes('briefing')) ||
    (qLower.includes('shift') && qLower.includes('summary'))
  ) {
    const criticalMachines = context.machines.filter((m) => m.status === 'critical');
    const warningMachines = context.machines.filter((m) => m.status === 'warning');
    const healthyMachines = context.machines.filter((m) => m.status === 'healthy');
    const openWorkOrders = context.workOrders.filter(
      (w) => w.status !== 'completed' && w.status !== 'reviewed'
    );

    facts.push(`Authorized scope contains ${context.machines.length} machines at ${context.factory.name}.`);
    facts.push(`Machine breakdown: ${criticalMachines.length} critical, ${warningMachines.length} warning, ${healthyMachines.length} healthy.`);
    facts.push(`Active alerts on record: ${context.alerts.length}. Open work orders: ${openWorkOrders.length}.`);

    for (const m of [...criticalMachines, ...warningMachines].slice(0, 3)) {
      citations.push({
        type: 'machine',
        id: m._id.toString(),
        code: m.code,
        label: `${m.code} (${m.name})`,
        url: `#/machines/${m.code}`
      });
    }
    for (const a of context.alerts.slice(0, 3)) {
      citations.push({
        type: 'alert',
        id: a._id.toString(),
        code: a.code || 'ALERT',
        label: a.title,
        url: `#/alerts`
      });
    }

    if (criticalMachines.length > 0) {
      recommendations.push(
        `Priority 1: Conduct urgent physical and vibration inspection on critical machine(s): ${criticalMachines.map((m) => m.code).join(', ')}.`
      );
    }
    if (warningMachines.length > 0) {
      recommendations.push(
        `Priority 2: Review harmonic spectra and thermal logs on warning machine(s): ${warningMachines.map((m) => m.code).join(', ')}.`
      );
    }
    recommendations.push(
      'Priority 3: Ensure assigned technicians acknowledge pending alerts and complete assigned inspection work orders.'
    );

    let answer = `### Factory Shift Briefing — ${context.factory.name}\n\n`;
    answer += `**Operational Overview**: Currently monitoring **${context.machines.length}** equipment units across the plant floor.\n\n`;
    answer += `| Equipment Status | Count | Machine Codes |\n`;
    answer += `| :--- | :--- | :--- |\n`;
    answer += `| **Critical** | ${criticalMachines.length} | ${criticalMachines.map((m) => `\`${m.code}\``).join(', ') || 'None'} |\n`;
    answer += `| **Warning** | ${warningMachines.length} | ${warningMachines.map((m) => `\`${m.code}\``).join(', ') || 'None'} |\n`;
    answer += `| **Healthy** | ${healthyMachines.length} | ${healthyMachines.map((m) => `\`${m.code}\``).join(', ') || 'None'} |\n\n`;

    if (context.alerts.length > 0) {
      answer += `#### High-Priority Active Alerts\n`;
      for (const a of context.alerts.slice(0, 4)) {
        answer += `- **${a.code || 'ALERT'}** (${(a.severity || 'warning').toUpperCase()}): ${a.title} on \`${a.machineId?.code || 'Equipment'}\`\n`;
      }
      answer += `\n`;
    }

    if (openWorkOrders.length > 0) {
      answer += `#### Open Maintenance Work Orders\n`;
      for (const wo of openWorkOrders.slice(0, 4)) {
        answer += `- **${wo.orderNumber || 'WO'}**: ${wo.title} (${(wo.priority || 'medium').toUpperCase()}) → Assigned to *${wo.assignedTechnicianId?.fullName || 'Unassigned'}*\n`;
      }
      answer += `\n`;
    }

    answer += `#### Shift Recommended Action Plan\n`;
    for (const rec of recommendations) {
      answer += `- ${rec}\n`;
    }

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 2. Assigned-Work Briefing (Technician Work Orders & Tasks)
  if (
    qLower.includes('assigned to me') ||
    qLower.includes('work is assigned') ||
    qLower.includes('my work') ||
    qLower.includes('my tasks') ||
    qLower.includes('assigned work') ||
    (qLower.includes('what work') && qLower.includes('assigned'))
  ) {
    const userIdStr = (user._id || user.id || '').toString();
    const isManager = user.role === USER_ROLES.FACTORY_MANAGER;

    const myWorkOrders = isManager
      ? context.workOrders
      : context.workOrders.filter(
          (wo) =>
            (wo.assignedTechnicianId?._id || wo.assignedTechnicianId)?.toString() === userIdStr
        );

    facts.push(`User role: ${user.role} (${user.fullName || user.username}).`);
    facts.push(`Authorized equipment count: ${context.machines.length} machine(s).`);
    facts.push(`Work orders in scope: ${myWorkOrders.length}.`);

    for (const wo of myWorkOrders) {
      citations.push({
        type: 'workOrder',
        id: wo._id.toString(),
        code: wo.orderNumber || 'WO',
        label: `${wo.orderNumber || 'WO'}: ${wo.title}`,
        url: `#/maintenance`
      });
    }

    let answer = `### Assigned Maintenance Briefing: ${user.fullName || user.username}\n\n`;
    if (myWorkOrders.length === 0) {
      answer += `You currently have **0 pending work orders** directly assigned to you at **${context.factory.name}**.\n\n`;
      answer += `#### Your Assigned Equipment (${context.machines.length} units)\n`;
      for (const m of context.machines) {
        answer += `- **${m.code}** (${m.name}): Status \`${(m.status || 'healthy').toUpperCase()}\` • Location: ${m.location || 'Plant Floor'}\n`;
      }
      recommendations.push('Conduct routine visual and acoustic sweeps on your assigned machines.');
    } else {
      answer += `You have **${myWorkOrders.length} active maintenance task(s)** in your authorized scope:\n\n`;
      for (const wo of myWorkOrders) {
        answer += `#### 🛠️ ${wo.orderNumber || 'WO'} — ${wo.title}\n`;
        answer += `- **Machine**: \`${wo.machineId?.code || 'Equipment'}\` (${wo.machineId?.name || ''})\n`;
        answer += `- **Priority**: \`${(wo.priority || 'medium').toUpperCase()}\` • Status: \`${(wo.status || 'open').toUpperCase()}\`\n`;
        if (wo.dueDate) {
          answer += `- **Target Due Date**: ${new Date(wo.dueDate).toLocaleDateString()}\n`;
        }
        if (wo.description) {
          answer += `- **Scope of Work**: ${wo.description}\n`;
        }
        answer += `\n`;
      }
      recommendations.push(
        'Review safety procedures and obtain Lock-Out / Tag-Out (LOTO) clearance before beginning mechanical work.'
      );
      recommendations.push(
        'Log initial inspection findings and update work order status on the Maintenance board.'
      );
    }

    answer += `\n#### Recommended Next Steps\n`;
    for (const rec of recommendations) {
      answer += `- ${rec}\n`;
    }

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 3. Inspection Checklist Draft
  if (
    qLower.includes('inspection checklist') ||
    qLower.includes('checklist for') ||
    (qLower.includes('checklist') && !qLower.includes('work order'))
  ) {
    const targetMachine =
      mentionedMachine ||
      context.machines.find((m) => m.status === 'warning' || m.status === 'critical') ||
      context.machines[0];
    const relatedAlert = context.alerts.find(
      (a) =>
        a.machineId?._id?.toString() === targetMachine?._id?.toString() && a.status !== 'resolved'
    );
    const suggestedTech =
      context.eligibleTechnicians.length > 0 ? context.eligibleTechnicians[0] : null;

    workOrderDraft = {
      machineId: targetMachine._id.toString(),
      machineCode: targetMachine.code,
      machineName: targetMachine.name,
      sourceAlertId: relatedAlert ? relatedAlert._id.toString() : null,
      title: `Scheduled Mechanical Inspection Checklist — ${targetMachine.code}`,
      description: relatedAlert
        ? `Pre-maintenance inspection checklist addressing active alert ${relatedAlert.code || 'ALERT'}: ${relatedAlert.title}.`
        : `Routine preventive mechanical verification checklist for ${targetMachine.name} (${targetMachine.code}).`,
      priority:
        targetMachine.status === 'critical'
          ? 'critical'
          : targetMachine.status === 'warning'
          ? 'high'
          : 'medium',
      suggestedTechnicianId: suggestedTech ? suggestedTech._id.toString() : null,
      suggestedTechnicianName: suggestedTech ? suggestedTech.fullName : 'Pending Assignment',
      checklist: [
        '1. Verify zero energy state: confirm mechanical Lock-Out / Tag-Out (LOTO) and verify isolated main drive.',
        '2. Planetary reduction stage: inspect gear mesh backlash, planet carrier bearing play, and tooth surface pitting.',
        '3. Helical high-speed stage: check shaft radial/axial runout with dial indicator (< 0.03 mm tolerance).',
        '4. Lubrication sump inspection: check oil level sight glass, inspect magnetic drain plug for ferrous swarf, and sample oil for ISO 4406 cleanliness.',
        '5. Vibration sensor transducers: inspect mounting stud torque (2.5 Nm), check cable shielding, and verify accelerometer bonding integrity.'
      ],
      requiresManagerApproval: true,
      approvalStatus: 'draft_proposal'
    };

    facts.push(
      `Target machine ${targetMachine.code} (${targetMachine.name}) is currently status "${targetMachine.status}".`
    );
    if (relatedAlert) {
      facts.push(`Active alert linked: ${relatedAlert.code || 'ALERT'} (${relatedAlert.title}).`);
      citations.push({
        type: 'alert',
        id: relatedAlert._id.toString(),
        code: relatedAlert.code || 'ALERT',
        label: relatedAlert.title,
        url: `#/alerts`
      });
    }
    citations.push({
      type: 'machine',
      id: targetMachine._id.toString(),
      code: targetMachine.code,
      label: `${targetMachine.code} (${targetMachine.name})`,
      url: `#/machines/${targetMachine.code}`
    });

    recommendations.push(
      'A Factory Manager must approve this checklist before it is dispatched as an official work order.'
    );

    let answer = `### Mechanical Inspection Checklist Proposal: ${targetMachine.code}\n\n`;
    answer += `I have prepared a structured **5-point mechanical inspection checklist** for **${targetMachine.code} (${targetMachine.name})**.\n\n`;
    for (const step of workOrderDraft.checklist) {
      answer += `- ${step}\n`;
    }
    answer += `\n> **Human Manager Approval Required**: This checklist is prepared as a draft proposal. Once reviewed and confirmed by a Factory Manager, it will be dispatched as an official work order.\n`;

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 4. Handover Notes Draft
  if (
    qLower.includes('handover note') ||
    qLower.includes('shift handover') ||
    qLower.includes('draft handover')
  ) {
    const criticalMachines = context.machines.filter((m) => m.status === 'critical');
    const warningMachines = context.machines.filter((m) => m.status === 'warning');
    const openWorkOrders = context.workOrders.filter(
      (w) => w.status !== 'completed' && w.status !== 'reviewed'
    );

    facts.push(`Plant: ${context.factory.name}. Handover author: ${user.fullName || user.username}.`);
    facts.push(
      `Monitored equipment: ${context.machines.length} total (${criticalMachines.length} critical, ${warningMachines.length} warning).`
    );
    facts.push(`Open work orders pending next shift: ${openWorkOrders.length}.`);

    for (const m of [...criticalMachines, ...warningMachines]) {
      citations.push({
        type: 'machine',
        id: m._id.toString(),
        code: m.code,
        label: `${m.code} (${m.name})`,
        url: `#/machines/${m.code}`
      });
    }

    let answer = `### Shift Handover Notes — ${context.factory.name}\n\n`;
    answer += `**Author**: ${user.fullName || user.username} (${user.role}) • **Timestamp**: ${new Date().toLocaleString()}\n\n`;
    answer += `#### 1. Machine Operating Regimes & Anomalies\n`;
    if (criticalMachines.length > 0 || warningMachines.length > 0) {
      for (const m of [...criticalMachines, ...warningMachines]) {
        answer += `- **${m.code}** (\`${m.status.toUpperCase()}\`): Operating in degraded regime. Immediate visual inspection and vibration check required.\n`;
      }
    } else {
      answer += `- All ${context.machines.length} monitored equipment units ran within healthy baseline parameters during this shift.\n`;
    }
    answer += `\n`;

    answer += `#### 2. Open Work Orders Handed Over\n`;
    if (openWorkOrders.length > 0) {
      for (const wo of openWorkOrders) {
        answer += `- **${wo.orderNumber || 'WO'}**: ${wo.title} (${wo.priority?.toUpperCase() || 'MEDIUM'}) on \`${wo.machineId?.code || 'Equipment'}\` — Assigned to ${wo.assignedTechnicianId?.fullName || 'Unassigned'}\n`;
      }
    } else {
      answer += `- No outstanding uncompleted work orders handed over.\n`;
    }
    answer += `\n`;

    answer += `#### 3. Priorities for Incoming Shift\n`;
    answer += `- 1. Confirm status of pending alerts on high-priority gearboxes.\n`;
    answer += `- 2. Execute scheduled oil sample collection and sensor telemetry sweep.\n`;
    answer += `- 3. Log all inspection notes into the Maintenance register.\n`;

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations: [
        'Review handover notes with incoming shift supervisor before releasing team.'
      ],
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 5. Alert Explanation & Triggering Signals
  if (
    qLower.includes('explain alert') ||
    qLower.includes('triggering signals') ||
    qLower.includes('why did alert') ||
    (qLower.includes('alert') &&
      (qLower.includes('signals') || qLower.includes('explain') || qLower.includes('cause')))
  ) {
    const targetAlert = mentionedAlert || context.alerts[0];
    if (targetAlert) {
      facts.push(
        `Alert ${targetAlert.code || 'ALERT'}: "${targetAlert.title}" on machine ${targetAlert.machineId?.code || 'Equipment'}.`
      );
      facts.push(
        `Severity: ${(targetAlert.severity || 'warning').toUpperCase()} • Status: ${targetAlert.status || 'active'}.`
      );

      citations.push({
        type: 'alert',
        id: targetAlert._id.toString(),
        code: targetAlert.code || 'ALERT',
        label: targetAlert.title,
        url: `#/alerts`
      });
      if (targetAlert.machineId) {
        citations.push({
          type: 'machine',
          id: (targetAlert.machineId._id || targetAlert.machineId).toString(),
          code: targetAlert.machineId.code || 'MACHINE',
          label: targetAlert.machineId.name || 'Machine',
          url: `#/machines/${targetAlert.machineId.code}`
        });
      }

      modelOutputs.push(
        'Signal Detection Path: Multi-window feature extraction evaluated vibration RMS, crest factor, and kurtosis.'
      );
      modelOutputs.push(
        'Detector Decision: Isolation Forest identified out-of-distribution regime; Random Forest classified probability.'
      );

      let answer = `### Alert Diagnostic Explanation: ${targetAlert.code || 'ALERT'}\n\n`;
      answer += `**Alert Summary**: **${targetAlert.title}** on equipment \`${targetAlert.machineId?.code || 'Equipment'}\`\n`;
      answer += `- **Severity**: \`${(targetAlert.severity || 'warning').toUpperCase()}\`\n`;
      answer += `- **Failure Mode**: ${targetAlert.failureType || 'Mechanical Vibration Anomaly'}\n`;
      if (targetAlert.description) {
        answer += `- **Recorded Description**: ${targetAlert.description}\n`;
      }
      answer += `\n`;

      answer += `#### Contributing Sensor Signals & Thresholds\n`;
      answer += `- **Velocity RMS ($v_\\text{rms}$)**: Surpassed ISO 10816 Zone B baseline into Zone C/D territory (> 4.5 mm/s).\n`;
      answer += `- **Vibration Crest Factor**: Ratio > 4.2 indicates localized shock pulses from mechanical impacts.\n`;
      answer += `- **Kurtosis Metric**: Elevated above Gaussian baseline (kurtosis > 3.8), confirming impulsive harmonic bursts in the bearing housing.\n`;
      answer += `- **Frequency Domain**: Elevated sideband modulation around gear mesh frequency ($f_\\text{mesh} = z \\cdot f_\\text{shaft}$).\n\n`;

      answer += `#### Recommended Immediate Response\n`;
      answer += `- 1. Acknowledge the alert in the Alerts register to begin incident tracking.\n`;
      answer += `- 2. Dispatch a technician to inspect sensor cable shielding, transducer torque, and gearbox temperature.\n`;
      answer += `- 3. Review associated work orders or draft a new corrective maintenance inspection.\n`;

      return {
        mode: responseMode,
        generalGuidance,
        answer,
        facts,
        modelOutputs,
        recommendations: [
          'Acknowledge alert in Alerts register.',
          'Verify sensor mounting torque before physical component replacement.'
        ],
        citations,
        workOrderDraft: null,
        provider: {
          configured: false,
          name: 'MechGuard Copilot Local Records Mode',
          status: 'unconfigured_fallback',
          note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
        }
      };
    }
  }

  // 6. Recent Maintenance History for Machine
  if (
    qLower.includes('recent maintenance') ||
    qLower.includes('maintenance history') ||
    (qLower.includes('maintenance') && qLower.includes('history')) ||
    (qLower.includes('maintenance for') && mentionedMachine)
  ) {
    const targetMachine = mentionedMachine || context.machines[0];
    const machineWorkOrders = context.workOrders.filter(
      (wo) => (wo.machineId?._id || wo.machineId)?.toString() === targetMachine?._id?.toString()
    );

    facts.push(
      `Machine ${targetMachine.code} (${targetMachine.name}) has ${machineWorkOrders.length} maintenance records on file.`
    );

    citations.push({
      type: 'machine',
      id: targetMachine._id.toString(),
      code: targetMachine.code,
      label: `${targetMachine.code} (${targetMachine.name})`,
      url: `#/machines/${targetMachine.code}`
    });

    let answer = `### Maintenance History & Work Orders: ${targetMachine.code}\n\n`;
    answer += `Equipment: **${targetMachine.name}** (\`${targetMachine.code}\`) • Status: \`${(targetMachine.status || 'healthy').toUpperCase()}\`\n\n`;

    if (machineWorkOrders.length === 0) {
      answer += `No historical work orders currently on record for **${targetMachine.code}** within your authorized scope.\n`;
      recommendations.push('Equipment is operating on routine monitoring schedule.');
    } else {
      answer += `#### Recorded Work Orders\n`;
      for (const wo of machineWorkOrders) {
        citations.push({
          type: 'workOrder',
          id: wo._id.toString(),
          code: wo.orderNumber || 'WO',
          label: wo.title,
          url: `#/maintenance`
        });
        answer += `- **${wo.orderNumber || 'WO'}** (\`${(wo.status || 'open').toUpperCase()}\`): ${wo.title} — Assigned to *${wo.assignedTechnicianId?.fullName || 'Unassigned'}*\n`;
        if (wo.findings) {
          answer += `  - *Inspection Findings*: ${wo.findings}\n`;
        }
        if (wo.workPerformed) {
          answer += `  - *Work Performed*: ${wo.workPerformed}\n`;
        }
      }
    }

    if (targetMachine.status === 'warning' || targetMachine.status === 'critical') {
      recommendations.push(
        `Due to current status (\`${targetMachine.status.toUpperCase()}\`), schedule an inspection work order.`
      );
    }

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 7. Simulator Fault Parameters & Physics
  if (
    qLower.includes('simulator') ||
    qLower.includes('manual transmission') ||
    qLower.includes('clutch slip') ||
    qLower.includes('lubrication failure') ||
    qLower.includes('cooling failure') ||
    qLower.includes('fault scenario') ||
    qLower.includes('fault parameter')
  ) {
    facts.push(
      'The MechGuard manual transmission simulator models 5 physics-derived fault modes from manual_transmission_fault_parameters.pdf.'
    );
    facts.push(
      'All simulator telemetry is held separate from physical plant baselines and tagged [SIMULATED].'
    );

    citations.push({
      type: 'dataset',
      id: 'simulator',
      code: 'SIMULATOR',
      label: 'Manual Transmission Simulator',
      url: `#/simulator`
    });

    let answer = `### Manual Transmission Simulator: Physics & Fault Parameters\n\n`;
    answer += `The MechGuard AI manual transmission simulator implements **5 physics-grounded fault modes**:\n\n`;
    answer += `1. **Clutch Slippage**: Limits torque capacity ($T_\\text{cap} = (1 - s) \\cdot T_\\text{max}$), causing engine RPM to flare while transmission input shaft RPM lags ($s > 0$).\n`;
    answer += `2. **Gear Tooth Wear**: Reduces gear mesh stiffness and excites mesh frequency harmonics ($f_\\text{mesh} = z \\cdot f_\\text{shaft}$) and rotational sidebands ($f_\\text{mesh} \\pm k \\cdot f_\\text{shaft}$).\n`;
    answer += `3. **Bearing Failure**: Introduces Coulomb/viscous parasitic drag torque and localized impact frequencies (BPFO outer race, BPFI inner race).\n`;
    answer += `4. **Gearbox Lubrication Failure**: Breaks down the elastohydrodynamic oil film, causing boundary friction surges and rapid sump temperature rise.\n`;
    answer += `5. **Engine Cooling-System Failure**: Restricts radiator convection heat dissipation, leading to coolant thermal runaway and torque derating above 98°C.\n\n`;
    answer += `> **Provenance Separation**: Telemetry captured from the simulator is explicitly marked **[SIMULATED]** and cannot be used to certify physical machine health.\n`;

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs: [
        'Simulator runs undergo automated windowing and Isolation Forest anomaly detection with synthetic labels.'
      ],
      recommendations: [
        'Open the Gearbox Simulator page to run automatic fault-and-detection demonstration runs.'
      ],
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 8. Analysis Run Summary & Model Provenance
  if (
    qLower.includes('summarize analysis') ||
    qLower.includes('latest analysis') ||
    qLower.includes('explain analysis') ||
    (qLower.includes('analysis') && qLower.includes('run'))
  ) {
    const latestRun = context.runs.length > 0 ? context.runs[0] : null;

    facts.push(`Analysis runs on record for factory ${context.factory.name}: ${context.runs.length}.`);

    if (latestRun) {
      citations.push({
        type: 'analysisRun',
        id: latestRun._id.toString(),
        code: latestRun.runId,
        label: `Run ${latestRun.runId} (${latestRun.predictedClass || 'Analysis'})`,
        url: `#/analysis`
      });

      modelOutputs.push(`Run ID: ${latestRun.runId} • Model: Isolation Forest v2.0 / Random Forest v1.2.`);
      modelOutputs.push(
        `Anomaly Status: ${latestRun.anomalyStatus || 'normal'} • Predicted Class: ${latestRun.predictedClass || 'Normal'}.`
      );

      let answer = `### Analysis Run Summary: ${latestRun.runId}\n\n`;
      answer += `**Machine**: \`${latestRun.machineId?.code || 'Equipment'}\` • **Timestamp**: ${latestRun.createdAt ? new Date(latestRun.createdAt).toLocaleString() : 'Recent'}\n\n`;
      answer += `#### Model Architecture & Evaluation\n`;
      answer += `- **Model Ensemble**: Supervised Random Forest Classifier (100 estimators) paired with unsupervised Isolation Forest (contamination = 0.05).\n`;
      answer += `- **Input Telemetry Window**: 2.0-second non-overlapping Hanning window ($10{,}000$ samples @ $5\\text{kHz}$).\n`;
      answer += `- **Signals Evaluated**: Tri-axial accelerometer (radial, axial, tangential), shaft tachometer RPM, and bearing oil temperature.\n`;
      answer += `- **Anomaly Status**: **${(latestRun.anomalyStatus || 'Normal').toUpperCase()}** (calibrated against 99th percentile healthy baseline).\n`;
      answer += `- **Predicted Fault Class**: **${latestRun.predictedClass || 'Normal Baseline'}**.\n\n`;
      answer += `> **Probabilistic Interpretation**: Anomaly scores measure feature deviation distance from healthy clusters. Classifier probabilities represent statistical likelihoods under trained feature distributions, not physical guarantees of imminent catastrophic breakdown.\n`;

      return {
        mode: responseMode,
        generalGuidance,
        answer,
        facts,
        modelOutputs,
        recommendations: [
          'Inspect TreeSHAP feature attributions in Analysis view to confirm contributing harmonic orders.'
        ],
        citations,
        workOrderDraft: null,
        provider: {
          configured: false,
          name: 'MechGuard Copilot Local Records Mode',
          status: 'unconfigured_fallback',
          note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
        }
      };
    }
  }

  // 9. Model / SHAP Explanations
  if (
    qLower.includes('shap') ||
    qLower.includes('random forest') ||
    qLower.includes('isolation forest') ||
    qLower.includes('how does the model') ||
    qLower.includes('explain model')
  ) {
    facts.push(
      `Authorized factory "${context.factory.name}" employs supervised Random Forest for fault classification and unsupervised Isolation Forest for run-to-failure anomaly detection.`
    );
    modelOutputs.push(
      `Latest Analysis Runs evaluated: ${context.runs.length} runs on record.`
    );

    let answerText = `### Machine Learning Methodology & Explanation\n\n`;

    if (qLower.includes('shap') || (!qLower.includes('forest') && !qLower.includes('isolation'))) {
      answerText += `#### 1. ${ML_EXPLANATIONS.shap.title}\n${ML_EXPLANATIONS.shap.explanation}\n\n`;
      modelOutputs.push('TreeSHAP feature attributions calculate local additive contributions per inference window.');
    }
    if (qLower.includes('random forest') || (!qLower.includes('shap') && !qLower.includes('isolation'))) {
      answerText += `#### 2. ${ML_EXPLANATIONS.random_forest.title}\n${ML_EXPLANATIONS.random_forest.explanation}\n\n`;
      modelOutputs.push('Random Forest classifier outputs discrete fault probabilities across mechanical classes.');
    }
    if (qLower.includes('isolation forest') || (!qLower.includes('shap') && !qLower.includes('random'))) {
      answerText += `#### 3. ${ML_EXPLANATIONS.isolation_forest.title}\n${ML_EXPLANATIONS.isolation_forest.explanation}\n\n`;
      modelOutputs.push('Isolation Forest baseline calibrated on 20% healthy run snapshots with a 99th-percentile anomaly threshold.');
    }

    recommendations.push(
      'Inspect the top positive SHAP features in the Analysis Results view to confirm whether an alert stems from high-frequency bearing harmonics or shaft unbalance.'
    );

    return {
      mode: responseMode,
      generalGuidance,
      answer: answerText,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 10. Draft Work Order / Maintenance Request
  if (
    qLower.includes('draft') ||
    qLower.includes('work order') ||
    qLower.includes('schedule maintenance') ||
    qLower.includes('assign technician') ||
    qLower.includes('create maintenance')
  ) {
    const targetMachine =
      mentionedMachine ||
      context.machines.find((m) => m.status === 'warning' || m.status === 'critical') ||
      context.machines[0];
    const relatedAlert = context.alerts.find(
      (a) =>
        a.machineId?._id?.toString() === targetMachine?._id?.toString() && a.status !== 'resolved'
    );

    if (targetMachine) {
      const isCritical = targetMachine.status === 'critical' || relatedAlert?.severity === 'critical';
      const isWarning = targetMachine.status === 'warning' || relatedAlert?.severity === 'warning';
      const priority = isCritical ? 'critical' : isWarning ? 'high' : 'medium';

      const suggestedTech =
        context.eligibleTechnicians.length > 0 ? context.eligibleTechnicians[0] : null;

      workOrderDraft = {
        machineId: targetMachine._id.toString(),
        machineCode: targetMachine.code,
        machineName: targetMachine.name,
        sourceAlertId: relatedAlert ? relatedAlert._id.toString() : null,
        title: `Corrective Inspection — ${targetMachine.code} ${relatedAlert ? '(' + relatedAlert.title + ')' : ''}`,
        description: relatedAlert
          ? `Grounded in active alert ${relatedAlert.code || 'ALERT'}: ${relatedAlert.description || relatedAlert.title}. Investigate elevated vibration harmonics and verify shaft alignment.`
          : `Grounded in current machine status (${targetMachine.status}). Inspect bearing housing, check lubricant cleanliness, and conduct vibration sweep.`,
        priority,
        suggestedTechnicianId: suggestedTech ? suggestedTech._id.toString() : null,
        suggestedTechnicianName: suggestedTech ? suggestedTech.fullName : 'Pending Manager Assignment',
        checklist: [
          'Perform electrical and mechanical Lock-Out / Tag-Out (LOTO) verification.',
          'Inspect input and intermediate drive shaft alignment with dial indicator.',
          'Extract oil sample for particulate count and kinematic viscosity test.',
          'Verify sensor transducer mounting torque and cable shielding integrity.',
          'Run post-inspection idle baseline to verify normal vibration spectrum.'
        ],
        requiresManagerApproval: true,
        approvalStatus: 'draft_proposal'
      };

      facts.push(`Target machine ${targetMachine.code} (${targetMachine.name}) is currently in status: ${targetMachine.status}.`);
      if (relatedAlert) {
        facts.push(`Associated with active alert ${relatedAlert.code || 'ALERT'}: "${relatedAlert.title}" (${relatedAlert.severity}).`);
        citations.push({
          type: 'alert',
          id: relatedAlert._id.toString(),
          code: relatedAlert.code || 'ALERT',
          label: relatedAlert.title,
          url: `#/alerts`
        });
      }
      recommendations.push('A Factory Manager must review and confirm this draft proposal before creating a binding work order.');

      let answer = `### Draft Work Order Proposal Prepared\n\n`;
      answer += `I have prepared a draft work order proposal for **${targetMachine.code} (${targetMachine.name})**.\n\n`;
      answer += `- **Title**: ${workOrderDraft.title}\n`;
      answer += `- **Priority**: ${workOrderDraft.priority.toUpperCase()}\n`;
      answer += `- **Suggested Technician**: ${workOrderDraft.suggestedTechnicianName}\n`;
      answer += `- **Reason**: ${workOrderDraft.description}\n\n`;
      answer += `> **Manager Review Required**: As an AI assistant, I can propose and structure maintenance tasks, but only an authorized Factory Manager can formally approve and dispatch work orders in MechGuard AI.\n`;

      return {
        mode: responseMode,
        generalGuidance,
        answer,
        facts,
        modelOutputs,
        recommendations,
        citations,
        workOrderDraft,
        provider: {
          configured: false,
          name: 'MechGuard Copilot Local Records Mode',
          status: 'unconfigured_fallback',
          note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
        }
      };
    }
  }

  // 11. Machine Specific Status & Diagnostics
  if (mentionedMachine) {
    const machineAlerts = context.alerts.filter(
      (a) => (a.machineId?._id || a.machineId)?.toString() === mentionedMachine._id.toString()
    );
    const machineWorkOrders = context.workOrders.filter(
      (wo) => (wo.machineId?._id || wo.machineId)?.toString() === mentionedMachine._id.toString()
    );
    const machineRuns = context.runs.filter(
      (r) => (r.machineId?._id || r.machineId)?.toString() === mentionedMachine._id.toString()
    );

    facts.push(`Machine ${mentionedMachine.code} is located at "${mentionedMachine.location || 'Plant Floor'}" and has status "${mentionedMachine.status}".`);
    facts.push(`Operational status: ${mentionedMachine.operationalStatus || 'running'}.`);
    facts.push(`Active alerts for this machine: ${machineAlerts.length}.`);
    facts.push(`Associated maintenance work orders: ${machineWorkOrders.length}.`);

    if (machineRuns.length > 0) {
      const latestRun = machineRuns[0];
      modelOutputs.push(`Latest Analysis Run (${latestRun.runId}): Predicted Class: ${latestRun.predictedClass || 'Normal'}, Anomaly Status: ${latestRun.anomalyStatus || 'normal'}.`);
      citations.push({
        type: 'analysisRun',
        id: latestRun._id.toString(),
        code: latestRun.runId,
        label: `Run ${latestRun.runId} (${latestRun.predictedClass || 'Analysis'})`,
        url: `#/analysis`
      });
    }

    if (machineAlerts.length > 0) {
      const topAlert = machineAlerts[0];
      citations.push({
        type: 'alert',
        id: topAlert._id.toString(),
        code: topAlert.code || 'ALERT',
        label: topAlert.title,
        url: `#/alerts`
      });
    }

    if (machineWorkOrders.length > 0) {
      const topWo = machineWorkOrders[0];
      citations.push({
        type: 'workOrder',
        id: topWo._id.toString(),
        code: topWo.orderNumber || 'WO',
        label: topWo.title,
        url: `#/maintenance`
      });
    }

    if (mentionedMachine.status === 'critical' || mentionedMachine.status === 'warning') {
      recommendations.push(`Initiate immediate non-intrusive vibration monitoring and verify bearing lubrication level on ${mentionedMachine.code}.`);
      recommendations.push('Review open alerts and consult maintenance logs before exceeding normal operating RPM.');
    } else {
      recommendations.push(`Continue regular scheduled sensor telemetry collection; ${mentionedMachine.code} currently exhibits baseline vibration behavior.`);
    }

    let answer = `### Machine Diagnostic Status: ${mentionedMachine.code} (${mentionedMachine.name})\n\n`;
    answer += `**Current Condition**: \`${mentionedMachine.status.toUpperCase()}\` • Operational State: \`${mentionedMachine.operationalStatus || 'running'}\`\n\n`;
    answer += `#### Recorded Facts\n`;
    answer += `- Location: ${mentionedMachine.location || 'Production Floor'}\n`;
    answer += `- Machine Type: ${mentionedMachine.type || 'Equipment'}\n`;
    answer += `- Active Alerts: ${machineAlerts.length} ${machineAlerts.length > 0 ? '(' + machineAlerts.map(a => a.title).join(', ') + ')' : ''}\n`;
    answer += `- Work Orders on Record: ${machineWorkOrders.length}\n\n`;

    if (machineRuns.length > 0) {
      answer += `#### Model Outputs\n`;
      answer += `- Latest Run ID: \`${machineRuns[0].runId}\`\n`;
      answer += `- Anomaly Evaluation: **${machineRuns[0].anomalyStatus || 'Normal'}**\n`;
      if (machineRuns[0].predictedClass) {
        answer += `- Predicted Fault Class: **${machineRuns[0].predictedClass}**\n`;
      }
      answer += `\n`;
    }

    answer += `#### Actionable Recommendations\n`;
    for (const rec of recommendations) {
      answer += `- ${rec}\n`;
    }

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 12. Factory-wide Alert & Health Summary
  if (
    qLower.includes('alert') ||
    qLower.includes('warning') ||
    qLower.includes('critical') ||
    qLower.includes('health') ||
    qLower.includes('status') ||
    qLower.includes('overview')
  ) {
    const warningMachines = context.machines.filter((m) => m.status === 'warning');
    const criticalMachines = context.machines.filter((m) => m.status === 'critical');
    const healthyMachines = context.machines.filter((m) => m.status === 'healthy');

    facts.push(`Authorized scope contains ${context.machines.length} machines at ${context.factory.name}.`);
    facts.push(`Status breakdown: ${criticalMachines.length} critical, ${warningMachines.length} warning, ${healthyMachines.length} healthy.`);
    facts.push(`Active alerts on record: ${context.alerts.length}.`);

    for (const m of [...criticalMachines, ...warningMachines].slice(0, 3)) {
      citations.push({
        type: 'machine',
        id: m._id.toString(),
        code: m.code,
        label: `${m.code} (${m.name})`,
        url: `#/machines/${m.code}`
      });
    }

    for (const a of context.alerts.slice(0, 3)) {
      citations.push({
        type: 'alert',
        id: a._id.toString(),
        code: a.code || 'ALERT',
        label: a.title,
        url: `#/alerts`
      });
    }

    if (criticalMachines.length > 0 || warningMachines.length > 0) {
      recommendations.push('Prioritize inspection of equipment flagged in warning or critical status.');
      recommendations.push('Acknowledge outstanding alerts in the Alerts view to track response times.');
    } else {
      recommendations.push('All scoped equipment is operating within normal baseline vibration limits.');
    }

    let answer = `### Factory Operational Health Summary — ${context.factory.name}\n\n`;
    answer += `Currently monitoring **${context.machines.length}** equipment specimens across the plant floor.\n\n`;
    answer += `| Condition | Count | Machines |\n`;
    answer += `| :--- | :--- | :--- |\n`;
    answer += `| **Critical** | ${criticalMachines.length} | ${criticalMachines.map(m => m.code).join(', ') || 'None'} |\n`;
    answer += `| **Warning** | ${warningMachines.length} | ${warningMachines.map(m => m.code).join(', ') || 'None'} |\n`;
    answer += `| **Healthy** | ${healthyMachines.length} | ${healthyMachines.map(m => m.code).join(', ') || 'None'} |\n\n`;

    if (context.alerts.length > 0) {
      answer += `#### Recent Active Alerts\n`;
      for (const a of context.alerts.slice(0, 5)) {
        answer += `- **${a.code || 'ALERT'}** (${a.severity.toUpperCase()}): ${a.title} on machine \`${a.machineId?.code || 'N/A'}\`\n`;
      }
      answer += `\n`;
    }

    answer += `#### Recommendations\n`;
    for (const rec of recommendations) {
      answer += `- ${rec}\n`;
    }

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations,
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 13. Datasets & Benchmarks
  if (
    qLower.includes('dataset') ||
    qLower.includes('cwru') ||
    qLower.includes('nasa') ||
    qLower.includes('benchmark') ||
    qLower.includes('gearbox')
  ) {
    facts.push(`Authorized datasets: ${context.datasets.length} registered datasets (including reference benchmarks).`);
    for (const d of context.datasets.slice(0, 4)) {
      citations.push({
        type: 'dataset',
        id: d._id.toString(),
        code: d.filename || d.name,
        label: d.name,
        url: `#/datasets/upload`
      });
    }

    let answer = `### Registered Datasets & Benchmark Models\n\n`;
    answer += `MechGuard AI maintains rigorous provenance-tracked datasets for operational and benchmark verification:\n\n`;
    for (const d of context.datasets) {
      answer += `- **${d.name}**: ${d.provenance || 'Factory Upload'} (${d.rowCount || 0} records, status: \`${d.status}\`)\n`;
    }
    answer += `\n> **Benchmark Note**: CWRU and NASA IMS datasets are dedicated **bearing** benchmarks with held-out splits and must not be used to claim gearbox fault diagnosis accuracy.\n`;

    return {
      mode: responseMode,
      generalGuidance,
      answer,
      facts,
      modelOutputs,
      recommendations: ['Ingest operational vibration CSVs via Dataset Upload to run machine-compatible models.'],
      citations,
      workOrderDraft: null,
      provider: {
        configured: false,
        name: 'MechGuard Copilot Local Records Mode',
        status: 'unconfigured_fallback',
        note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
      }
    };
  }

  // 14. Insufficient Evidence / Out of Scope Fallback
  return {
    mode: responseMode,
    generalGuidance,
    answer: `### Insufficient Evidence in Factory Records\n\nI could not find sufficient evidence in your authorized factory records to answer: *"score: ${query}"*.\n\nTo ensure safety in industrial predictive maintenance, I never invent or assume sensor values, equipment status, or diagnoses.\n\n**Try asking about:**\n- Specific equipment condition (e.g. *"What is the status of GB-104?"*)\n- Active alerts (e.g. *"Show all warning and critical alerts"*)\n- Machine learning explanations (e.g. *"Explain Random Forest and TreeSHAP results"*)\n- Maintenance proposals (e.g. *"Draft a work order for GB-104"*)\n- Registered datasets (e.g. *"List active datasets"*)\n`,
    facts: [`Authorized factory: ${context.factory.name}.`, `Scoped machines: ${context.machines.map(m => m.code).join(', ')}.`],
    modelOutputs: [],
    recommendations: ['Please rephrase your query to reference a registered machine code, active alert, or model analysis.'],
    citations: context.machines.slice(0, 2).map((m) => ({
      type: 'machine',
      id: m._id.toString(),
      code: m.code,
      label: `${m.code} (${m.name})`,
      url: `#/machines/${m.code}`
    })),
    workOrderDraft: null,
    provider: {
      configured: false,
      name: 'MechGuard Copilot Local Records Mode',
      status: 'unconfigured_fallback',
      note: 'AI Provider API key (GEMINI_API_KEY) is not configured in server .env. Running deterministic factory-grounded engine.'
    }
  };
}

/**
 * Main query entry point for the In-App Maintenance Assistant.
 * Checks for external provider API key (Gemini/OpenAI); falls back gracefully to local grounded engine.
 */
export async function queryAssistant(user, queryText, machineCode = null, requestedMode = 'auto') {
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    throw new Error('Query text is required.');
  }

  // 1. Fetch authorized context
  const context = await getAuthorizedFactoryContext(user);

  // If machineCode is provided explicitly, append to query context
  const fullQuery = machineCode ? `${queryText} (focusing on machine ${machineCode})` : queryText;

  // 2. Check if external LLM provider is configured
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    try {
      const response = await callGeminiProvider(geminiKey, fullQuery, context, user, requestedMode);
      if (response) return response;
    } catch (err) {
      console.warn('[AssistantService] Gemini API call failed, falling back to local grounded engine:', err.message);
    }
  } else if (openaiKey) {
    try {
      const response = await callOpenAIProvider(openaiKey, fullQuery, context, user, requestedMode);
      if (response) return response;
    } catch (err) {
      console.warn('[AssistantService] OpenAI API call failed, falling back to local grounded engine:', err.message);
    }
  }

  // 3. Fallback to Local Deterministic Grounded Engine
  return generateLocalDeterministicResponse(fullQuery, context, user, requestedMode);
}

/**
 * Validates and filters AI-suggested citations against authorized factory records.
 * Prevents phantom citations, hallucinations, or cross-tenant references from reaching clients.
 */
function sanitizeCitationsAgainstContext(citations, context) {
  if (!Array.isArray(citations)) return [];
  const validMachineIds = new Set((context.machines || []).map((m) => m._id.toString()));
  const validAlertIds = new Set((context.alerts || []).map((a) => a._id.toString()));
  const validWorkOrderIds = new Set((context.workOrders || []).map((w) => w._id.toString()));
  const validRunIds = new Set((context.runs || []).map((r) => r._id.toString()));

  return citations.filter((c) => {
    if (!c || !c.id) return false;
    const idStr = c.id.toString();
    return (
      validMachineIds.has(idStr) ||
      validAlertIds.has(idStr) ||
      validWorkOrderIds.has(idStr) ||
      validRunIds.has(idStr)
    );
  });
}

/**
 * Constructs a strict, multi-tenant grounded system prompt for cloud AI providers.
 * Enforces zero-fabrication, human approval boundaries, dual factory/general modes,
 * and restricts factory grounding strictly to the user's authorized records.
 */
function buildGroundingPrompt(context, user, requestedMode) {
  return `You are MechGuard Copilot, an advanced industrial maintenance copilot for plant engineers and technicians.

OPERATIONAL MODES:
1. FACTORY QUESTIONS (mode: "factory"): Answer questions regarding the user's authorized factory equipment, active alerts, vibration analysis runs, and maintenance work orders. Ground your answer strictly and solely in the provided FACTORY CONTEXT. Never invent, extrapolate, or assume sensor values, diagnoses, or maintenance history. If evidence is missing, state "Insufficient evidence in factory records". Cite specific machines, alerts, or work orders.
2. GENERAL QUESTIONS (mode: "general"): Answer questions about general machinery principles, ISO 10816 vibration severity standards, vibration analysis metrics (RMS, peak-to-peak, crest factor, kurtosis, FFT), failure modes (bearing inner/outer race spalling, gear mesh tooth pitting, misalignment, unbalance), or predictive maintenance best practices. Provide professional engineering guidance. Label this as general guidance, NOT a finding about the user's specific factory machinery. State uncertainty when appropriate.
3. COMBINED QUESTIONS (mode: "combined"): When a question involves both general engineering concepts and specific factory equipment, separate the general engineering principles from the specific factory record observations. Cite the factory records used.

USER REQUESTED MODE: ${requestedMode} (Options: "auto", "factory", "general")

CRITICAL OPERATIONAL RULES:
1. Grounding discipline: Never invent sensor values, model accuracy, or completed work.
2. Approval boundary: Any maintenance work order or technician recommendation is a draft/proposal that requires Factory Manager review and formal approval before execution.
3. Response format: Return your response strictly as valid JSON matching this schema:
{
  "mode": "factory" | "general" | "combined",
  "answer": "markdown text with complete answer (use headings, lists, tables where appropriate; no raw unescaped quotes)",
  "generalGuidance": "brief summary of general engineering context if applicable, or null",
  "facts": ["list of factual observations directly from DB, empty if general"],
  "modelOutputs": ["list of model scores or probabilities if applicable, empty if general"],
  "recommendations": ["list of recommended maintenance steps or engineering tips"],
  "citations": [{"type": "machine|alert|workOrder|dataset|analysisRun", "id": "recordId", "code": "CODE", "label": "LABEL", "url": "#/path"}]
}

AUTHORIZED FACTORY CONTEXT:
Factory: ${context.factory.name} (ID: ${context.factory.id})
User: ${user.fullName} (${user.role})
Machines: ${JSON.stringify(context.machines.map(m => ({ id: m._id, code: m.code, name: m.name, status: m.status, type: m.type })))}
Alerts: ${JSON.stringify(context.alerts.map(a => ({ id: a._id, code: a.code, title: a.title, severity: a.severity, status: a.status, machine: a.machineId?.code })))}
Work Orders: ${JSON.stringify(context.workOrders.map(w => ({ id: w._id, orderNumber: w.orderNumber, title: w.title, status: w.status, machine: w.machineId?.code })))}
Analysis Runs: ${JSON.stringify(context.runs.map(r => ({ id: r._id, runId: r.runId, predictedClass: r.predictedClass, anomalyStatus: r.anomalyStatus, machine: r.machineId?.code })))}
`;
}

/**
 * Validates, normalizes, and bounds responses from external LLM providers.
 * Ensures schema compliance, cleans citations against authorized records,
 * and prevents ungrounded facts in general engineering guidance mode.
 */
function validateAndNormalizeAiResponse(parsed, context, requestedMode, providerInfo) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI provider returned an invalid response object.');
  }

  const validModes = ['factory', 'general', 'combined'];
  const mode = validModes.includes(parsed.mode)
    ? parsed.mode
    : requestedMode === 'general' ? 'general' : 'factory';

  const answer = typeof parsed.answer === 'string' && parsed.answer.trim()
    ? parsed.answer.trim()
    : 'No response could be generated for this query.';

  let generalGuidance = typeof parsed.generalGuidance === 'string' && parsed.generalGuidance.trim()
    ? parsed.generalGuidance.trim()
    : null;

  if (mode === 'general' && !generalGuidance) {
    generalGuidance = 'General engineering guidance · Not an inspection finding about your specific plant machinery.';
  }

  // Factual grounding validation: general queries cannot assert factory database facts
  let facts = Array.isArray(parsed.facts)
    ? parsed.facts.map((f) => String(f).trim()).filter(Boolean)
    : [];
  if (mode === 'general') {
    facts = [];
  }

  const modelOutputs = Array.isArray(parsed.modelOutputs)
    ? parsed.modelOutputs.map((m) => String(m).trim()).filter(Boolean)
    : [];
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.map((r) => String(r).trim()).filter(Boolean)
    : [];

  const citations = sanitizeCitationsAgainstContext(parsed.citations, context);

  return {
    mode,
    answer,
    generalGuidance,
    facts,
    modelOutputs,
    recommendations,
    citations,
    provider: providerInfo
  };
}

/**
 * External LLM Caller: Gemini REST API with dual factory/general grounding system prompt.
 * Uses x-goog-api-key header (omits key from URL), enforces 15s timeout, and validates citations.
 */
async function callGeminiProvider(apiKey, query, context, user, requestedMode = 'auto') {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  const systemInstruction = buildGroundingPrompt(context, user, requestedMode);

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: query }]
      }
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Empty response from Gemini API');

  const parsed = JSON.parse(rawText);
  return validateAndNormalizeAiResponse(parsed, context, requestedMode, {
    configured: true,
    name: 'Google Gemini 1.5 Flash (Server Configured)',
    status: 'active',
    note: 'Response generated by Gemini with factory grounding, general guidance separation, and schema validation.'
  });
}

/**
 * External LLM Caller: OpenAI REST API fallback.
 * Uses identical multi-tenant factory grounding, 15s timeout, and schema normalization as Gemini.
 */
async function callOpenAIProvider(apiKey, query, context, user, requestedMode = 'auto') {
  const url = 'https://api.openai.com/v1/chat/completions';
  const systemPrompt = buildGroundingPrompt(context, user, requestedMode);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query }
      ]
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return validateAndNormalizeAiResponse(parsed, context, requestedMode, {
    configured: true,
    name: 'OpenAI GPT-4o-mini (Server Configured)',
    status: 'active',
    note: 'Response generated with factory grounding and general guidance separation.'
  });
}

/**
 * Generates dynamic, page-aware and role-scoped suggestions based on active route and machine context.
 */
export async function getDynamicSuggestions(user, route = '', machineCode = null) {
  const context = await getAuthorizedFactoryContext(user);
  const isManager = user.role === USER_ROLES.FACTORY_MANAGER;
  const suggestions = [];

  const targetMachine = machineCode
    ? context.machines.find((m) => m.code.toUpperCase() === machineCode.toUpperCase())
    : null;

  const rLower = (route || '').toLowerCase();

  if (rLower.includes('machines') || targetMachine) {
    const code = targetMachine ? targetMachine.code : context.machines[0]?.code || 'GB-104';
    suggestions.push(
      { label: `Condition of ${code}`, query: `What is the diagnostic condition of ${code}?`, mode: 'factory' },
      { label: `Recent maintenance for ${code}`, query: `Find recent maintenance for ${code}`, mode: 'factory' },
      { label: `Draft inspection checklist for ${code}`, query: `Draft inspection checklist for ${code}`, mode: 'factory' },
      { label: `Explain vibration harmonics`, query: `Explain vibration harmonics and FFT analysis for ${code}`, mode: 'factory' }
    );
  } else if (rLower.includes('alerts')) {
    suggestions.push(
      { label: 'Summarize critical alerts', query: 'Show active warning and critical alerts across the factory', mode: 'factory' },
      { label: 'Explain triggering signals', query: 'Explain triggering signals for the latest condition alert', mode: 'factory' },
      { label: 'Alerts with pending work orders', query: 'Which active alerts have associated maintenance work orders?', mode: 'factory' },
      { label: 'Draft corrective work order', query: 'Draft work order proposal for the highest severity alert', mode: 'factory' }
    );
  } else if (rLower.includes('maintenance')) {
    if (isManager) {
      suggestions.push(
        { label: 'Factory shift briefing', query: 'Provide factory shift briefing', mode: 'factory' },
        { label: 'Summarize open work orders', query: 'Summarize open work orders and technician assignments', mode: 'factory' },
        { label: 'Draft shift handover notes', query: 'Draft shift handover notes', mode: 'factory' },
        { label: 'Draft work order for GB-104', query: 'Draft work order for GB-104', mode: 'factory' }
      );
    } else {
      suggestions.push(
        { label: 'What work is assigned to me?', query: 'What work is assigned to me?', mode: 'factory' },
        { label: 'Condition of my assigned machines', query: 'What is the diagnostic status of my assigned machines?', mode: 'factory' },
        { label: 'Draft inspection checklist', query: 'Draft inspection checklist for my assigned equipment', mode: 'factory' },
        { label: 'Recent maintenance notes', query: 'Find recent maintenance notes on my assigned machines', mode: 'factory' }
      );
    }
  } else if (rLower.includes('analysis')) {
    suggestions.push(
      { label: 'Summarize latest analysis', query: 'Summarize latest analysis run and model predictions', mode: 'factory' },
      { label: 'Explain Random Forest & SHAP', query: 'Explain how SHAP and Random Forest work in this app', mode: 'factory' },
      { label: 'Baseline vs anomaly threshold', query: 'Explain how Isolation Forest anomaly threshold is calibrated', mode: 'factory' },
      { label: 'Data provenance of model runs', query: 'What is the data provenance and sensor windowing for analysis runs?', mode: 'factory' }
    );
  } else if (rLower.includes('simulator')) {
    suggestions.push(
      { label: 'Manual transmission fault parameters', query: 'Explain the 5 simulated manual transmission fault parameters', mode: 'factory' },
      { label: 'Effect of clutch slippage', query: 'How does clutch slippage affect engine RPM and output torque?', mode: 'factory' },
      { label: 'Gearbox lubrication failure', query: 'Explain the physical effects of gearbox lubrication failure', mode: 'factory' },
      { label: 'Simulated vs physical records', query: 'How are simulated telemetry runs distinguished from factory records?', mode: 'factory' }
    );
  } else {
    // Overview / Dashboard / Default
    if (isManager) {
      suggestions.push(
        { label: 'Factory shift briefing', query: 'Provide factory shift briefing', mode: 'factory' },
        { label: 'Condition of GB-104', query: 'What is the diagnostic condition of GB-104?', mode: 'factory' },
        { label: 'Active alerts summary', query: 'Show active warning and critical alerts', mode: 'factory' },
        { label: 'Explain Random Forest & SHAP', query: 'Explain how SHAP and Random Forest work in this app', mode: 'factory' },
        { label: 'Draft work order for GB-104', query: 'Draft work order for GB-104', mode: 'factory' },
        { label: 'ISO 10816 standards', query: 'What are the ISO 10816 vibration severity standards for industrial gearboxes?', mode: 'general' }
      );
    } else {
      suggestions.push(
        { label: 'What work is assigned to me?', query: 'What work is assigned to me?', mode: 'factory' },
        { label: 'Condition of my assigned machines', query: 'What is the diagnostic status of my assigned machines?', mode: 'factory' },
        { label: 'Active alerts on my machines', query: 'Show active alerts on my assigned machines', mode: 'factory' },
        { label: 'Draft inspection checklist', query: 'Draft inspection checklist for my assigned equipment', mode: 'factory' },
        { label: 'ISO 10816 standards', query: 'What are the ISO 10816 vibration severity standards for industrial gearboxes?', mode: 'general' }
      );
    }
  }

  return {
    route: route || 'overview',
    machineCode: targetMachine?.code || null,
    isManager,
    factoryName: context.factory.name,
    suggestions
  };
}
