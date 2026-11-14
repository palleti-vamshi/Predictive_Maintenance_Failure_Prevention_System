import mongoose from 'mongoose';

const supportingSignalSchema = new mongoose.Schema(
  {
    signal: { type: String, required: true },
    peakValue: { type: Number, required: true },
    baselineMean: { type: Number, default: 0 },
    deviationRatio: { type: Number, default: 1 },
    unit: { type: String, default: 'mm/s' }
  },
  { _id: false }
);

const topFeatureSchema = new mongoose.Schema(
  {
    feature: { type: String, required: true },
    value: { type: Number, default: 0 },
    attribution: { type: Number, default: 0 },
    interpretation: { type: String, default: '' }
  },
  { _id: false }
);

const issueGroupSchema = new mongoose.Schema(
  {
    groupId: { type: String, required: true },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true
    },
    machineCode: { type: String, required: true },
    machineName: { type: String, required: true },
    faultType: { type: String, required: true },
    faultLabel: { type: String, required: true },
    category: {
      type: String,
      enum: ['new_issue', 'recurring_issue', 'unresolved_item', 'already_linked'],
      required: true
    },
    alertIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Alert'
      }
    ],
    frequency: { type: Number, required: true, default: 1 },
    firstOccurrenceAt: { type: Date, required: true },
    lastOccurrenceAt: { type: Date, required: true },
    severity: {
      type: String,
      enum: ['CRITICAL', 'WARNING', 'INFO', 'critical', 'warning', 'info'],
      default: 'WARNING'
    },
    requiresImmediateAttention: { type: Boolean, default: false },
    supportingReadings: {
      peakScore: { type: Number, default: 0 },
      calibratedThreshold: { type: Number, default: 0 },
      peakVibrationRms: { type: Number, default: null },
      peakTemperatureC: { type: Number, default: null },
      peakSpeedRpm: { type: Number, default: null },
      contributingSignals: [supportingSignalSchema],
      topFeatures: [topFeatureSchema]
    },
    analysisRunIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AnalysisRun'
      }
    ],
    linkedWorkOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceWorkOrder',
      default: null
    },
    linkedWorkOrderNumber: { type: String, default: null },
    managerDecision: {
      decision: {
        type: String,
        enum: ['pending', 'work_order_created', 'dismissed', 'deferred'],
        default: 'pending'
      },
      decisionNote: { type: String, trim: true, default: null },
      decidedAt: { type: Date, default: null },
      decidedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      decidedByName: { type: String, default: null }
    }
  },
  { _id: true }
);

const reviewAuditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    performedByName: { type: String, required: true },
    performedByRole: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    details: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: true }
);

const dailyMaintenanceReviewSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    reviewDate: {
      type: String, // 'YYYY-MM-DD'
      required: true,
      index: true
    },
    reportNumber: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['in_review', 'completed', 'archived'],
      default: 'in_review'
    },
    generatedAt: {
      type: Date,
      default: Date.now
    },
    generatedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    generatedByName: {
      type: String,
      required: true
    },
    summary: {
      totalAlertsEvaluated: { type: Number, default: 0 },
      totalIssueGroups: { type: Number, default: 0 },
      newIssuesCount: { type: Number, default: 0 },
      recurringIssuesCount: { type: Number, default: 0 },
      unresolvedCount: { type: Number, default: 0 },
      alreadyLinkedCount: { type: Number, default: 0 },
      criticalUrgentCount: { type: Number, default: 0 },
      warningCount: { type: Number, default: 0 },
      workOrdersCreatedCount: { type: Number, default: 0 }
    },
    issueGroups: [issueGroupSchema],
    managerNotes: {
      type: String,
      trim: true,
      default: ''
    },
    completedAt: {
      type: Date,
      default: null
    },
    completedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    auditLog: [reviewAuditSchema]
  },
  {
    timestamps: true
  }
);

dailyMaintenanceReviewSchema.index({ factoryId: 1, reviewDate: 1 }, { unique: true });

export const DailyMaintenanceReview = mongoose.model(
  'DailyMaintenanceReview',
  dailyMaintenanceReviewSchema
);
