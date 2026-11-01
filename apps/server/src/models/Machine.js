import mongoose from 'mongoose';
import { OPERATIONAL_STATUS } from '@predictive-maintenance/shared';

const noteSchema = new mongoose.Schema(
  {
    author: {
      type: String,
      required: true
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    category: {
      type: String,
      default: 'Field Observation'
    },
    content: {
      type: String,
      required: true,
      trim: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const stageSchema = new mongoose.Schema(
  {
    stage: {
      type: Number,
      required: true
    },
    type: {
      type: String,
      required: true,
      trim: true
    },
    ratio: {
      type: String,
      required: true,
      trim: true
    },
    teethPinion: {
      type: Number
    },
    teethGear: {
      type: Number
    },
    conditionNotes: {
      type: String,
      trim: true
    }
  },
  { _id: true }
);

const bearingSchema = new mongoose.Schema(
  {
    position: {
      type: String,
      required: true,
      trim: true
    },
    bearingType: {
      type: String,
      trim: true
    },
    bearingModel: {
      type: String,
      trim: true
    }
  },
  { _id: true }
);

const machineSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Site',
      required: true,
      index: true
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      default: 'gearbox'
    },
    manufacturer: {
      type: String,
      trim: true
    },
    model: {
      type: String,
      trim: true
    },
    serialNumber: {
      type: String,
      trim: true
    },
    operationalStatus: {
      type: String,
      enum: Object.values(OPERATIONAL_STATUS),
      default: OPERATIONAL_STATUS.OPERATIONAL,
      index: true
    },
    status: {
      type: String,
      enum: ['healthy', 'warning', 'critical'],
      default: 'healthy'
    },
    isDecommissioned: {
      type: Boolean,
      default: false,
      index: true
    },
    decommissionedAt: {
      type: Date
    },
    decommissionReason: {
      type: String,
      trim: true
    },
    // Kinematic and Stage Parameters
    arrangement: {
      type: String,
      trim: true,
      default: 'Helical-Planetary'
    },
    stageCount: {
      type: Number,
      default: 1
    },
    gearRatio: {
      type: String,
      trim: true
    },
    ratedSpeedRpm: {
      type: Number
    },
    ratedTorqueNm: {
      type: Number
    },
    stages: [stageSchema],
    bearingPositions: [bearingSchema],
    // Lubrication Specifications
    lubrication: {
      oilType: {
        type: String,
        trim: true
      },
      isoVgGrade: {
        type: String,
        trim: true
      },
      capacityLiters: {
        type: Number
      },
      serviceIntervalHours: {
        type: Number
      },
      lastServiceDate: {
        type: Date
      }
    },
    lubricantType: {
      type: String,
      trim: true
    },
    monitoredSignals: [
      {
        key: String,
        label: String,
        unit: String,
        category: String
      }
    ],
    assignedTechnicians: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    notes: [noteSchema]
  },
  { timestamps: true }
);

machineSchema.index({ factoryId: 1, code: 1 }, { unique: true });

export const Machine = mongoose.model('Machine', machineSchema);
