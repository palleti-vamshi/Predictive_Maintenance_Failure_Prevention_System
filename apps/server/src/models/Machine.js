import mongoose from 'mongoose';

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
    status: {
      type: String,
      enum: ['healthy', 'warning', 'critical'],
      default: 'healthy'
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
    lubricantType: {
      type: String,
      trim: true
    },
    stages: [
      {
        stage: Number,
        type: { type: String },
        ratio: String,
        condition: String
      }
    ],
    monitoredSignals: [
      {
        key: String,
        label: String,
        unit: String,
        category: String
      }
    ],
    notes: [noteSchema]
  },
  { timestamps: true }
);

machineSchema.index({ factoryId: 1, code: 1 }, { unique: true });

export const Machine = mongoose.model('Machine', machineSchema);

