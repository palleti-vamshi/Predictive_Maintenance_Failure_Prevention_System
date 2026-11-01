import mongoose from 'mongoose';
import { WORK_ORDER_STATUS, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(WORK_ORDER_STATUS),
      required: true
    },
    changedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    changedByName: {
      type: String,
      required: true
    },
    changedByRole: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: {
      type: String,
      trim: true
    }
  },
  { _id: true }
);

const maintenanceWorkOrderSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
      index: true
    },
    orderNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    priority: {
      type: String,
      enum: Object.values(WORK_ORDER_PRIORITY),
      default: WORK_ORDER_PRIORITY.MEDIUM,
      index: true
    },
    status: {
      type: String,
      enum: Object.values(WORK_ORDER_STATUS),
      default: WORK_ORDER_STATUS.OPEN,
      index: true
    },
    dueDate: {
      type: Date,
      required: true
    },
    assignedTechnicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    technicianFeedback: {
      findings: {
        type: String,
        trim: true
      },
      workPerformed: {
        type: String,
        trim: true
      },
      followUpNeeded: {
        type: String,
        trim: true
      },
      submittedAt: Date
    },
    completedAt: Date,
    reviewedAt: Date,
    reviewedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewNotes: {
      type: String,
      trim: true
    },
    approvalRequest: {
      requestType: {
        type: String,
        enum: ['parts', 'permission']
      },
      reason: {
        type: String,
        trim: true
      },
      requestedAt: Date,
      requestedById: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      requestedByName: String,
      status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
      },
      decisionNote: {
        type: String,
        trim: true
      },
      decidedAt: Date,
      decidedById: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      decidedByName: String
    },
    statusHistory: [statusHistorySchema],
    sourceAlertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Alert',
      default: null,
      index: true
    },
    sourceAnalysisRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AnalysisRun',
      default: null
    }
  },
  { timestamps: true }
);

maintenanceWorkOrderSchema.index({ factoryId: 1, orderNumber: 1 }, { unique: true });

export const MaintenanceWorkOrder = mongoose.model(
  'MaintenanceWorkOrder',
  maintenanceWorkOrderSchema
);
