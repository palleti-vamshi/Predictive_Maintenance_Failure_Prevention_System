import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { USER_ROLES } from '@predictive-maintenance/shared';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false // Never returned in default queries
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    assignedSites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site'
      }
    ],
    assignedMachines: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Machine'
      }
    ],
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      }
    }
  }
);

/**
 * Verify plaintext password against stored hash.
 */
userSchema.methods.verifyPassword = async function (plainText) {
  if (!this.passwordHash) {
    throw new Error('Password hash not loaded for user');
  }
  return bcrypt.compare(plainText, this.passwordHash);
};

/**
 * Hash plaintext password using bcrypt with standard salt rounds.
 */
userSchema.statics.hashPassword = async function (plainText) {
  return bcrypt.hash(plainText, 10);
};

export const User = mongoose.model('User', userSchema);

