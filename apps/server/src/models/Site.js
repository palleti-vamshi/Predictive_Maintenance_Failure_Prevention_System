import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    area: {
      type: String,
      trim: true
    },
    isArchived: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

siteSchema.index({ factoryId: 1, code: 1 }, { unique: true });

export const Site = mongoose.model('Site', siteSchema);
