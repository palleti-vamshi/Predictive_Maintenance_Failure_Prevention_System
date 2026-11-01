import mongoose from 'mongoose';
import crypto from 'node:crypto';

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      required: true
    },
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    userAgent: {
      type: String,
      default: ''
    },
    ip: {
      type: String,
      default: ''
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 } // MongoDB automatic TTL cleanup upon expiration
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  { timestamps: true }
);

/**
 * Hash raw session token using SHA-256 for secure DB lookup.
 */
sessionSchema.statics.hashToken = function (rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

/**
 * Generate 256-bit cryptographically secure session token.
 */
sessionSchema.statics.generateToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

export const Session = mongoose.model('Session', sessionSchema);

