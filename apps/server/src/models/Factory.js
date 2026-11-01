import mongoose from 'mongoose';

const factorySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
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
    location: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

factorySchema.index({ organizationId: 1, code: 1 }, { unique: true });

export const Factory = mongoose.model('Factory', factorySchema);

