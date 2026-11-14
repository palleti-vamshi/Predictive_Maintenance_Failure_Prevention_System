import { Router } from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import { DailyMaintenanceReview } from '../models/DailyMaintenanceReview.js';
import {
  generateDailyMaintenanceReview,
  createWorkOrderForIssueGroup,
  dismissIssueGroup
} from '../services/dailyMaintenanceReview.service.js';

const router = Router();

// All daily maintenance review routes require authentication
router.use(authenticate);

// Validate reviewId parameter format
router.param('reviewId', (req, res, next, reviewId) => {
  if (!mongoose.Types.ObjectId.isValid(reviewId)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Invalid daily maintenance review ID format.'
    });
  }
  next();
});

/**
 * GET /api/maintenance-reviews/daily
 * Idempotently retrieves or generates the daily maintenance review for the caller's factory and target date.
 */
router.get('/daily', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const reviewDate = req.query.date || new Date().toISOString().split('T')[0];

    const review = await generateDailyMaintenanceReview({
      factoryId,
      reviewDate,
      userId: req.user._id,
      userName: req.user.fullName,
      userRole: req.user.role
    });

    const isUrgent = review.summary?.criticalUrgentCount > 0;

    return res.status(200).json({
      success: true,
      review,
      urgentEscalationActive: isUrgent,
      urgentNotice: isUrgent
        ? `Immediate safety escalation: ${review.summary.criticalUrgentCount} critical issue group(s) require immediate inspection and must not be delayed for batch review.`
        : null
    });
  } catch (err) {
    console.error('[MaintenanceReviewRoute:Daily] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to retrieve daily maintenance review.'
    });
  }
});

/**
 * POST /api/maintenance-reviews/generate
 * Explicit manager trigger to generate or refresh the review for a specific date.
 */
router.post('/generate', requireManager, async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const reviewDate = req.body.date || req.query.date || new Date().toISOString().split('T')[0];

    const review = await generateDailyMaintenanceReview({
      factoryId,
      reviewDate,
      userId: req.user._id,
      userName: req.user.fullName,
      userRole: req.user.role
    });

    return res.status(200).json({
      success: true,
      message: `Daily maintenance review for ${reviewDate} processed successfully.`,
      review
    });
  } catch (err) {
    console.error('[MaintenanceReviewRoute:Generate] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to generate daily maintenance review.'
    });
  }
});

/**
 * GET /api/maintenance-reviews/history
 * Returns historical daily maintenance reviews for the caller's factory.
 */
router.get('/history', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const limit = Math.min(Number(req.query.limit) || 30, 90);

    const reviews = await DailyMaintenanceReview.find({ factoryId })
      .select('reportNumber reviewDate status generatedAt generatedByName summary completedAt')
      .sort({ reviewDate: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      success: true,
      count: reviews.length,
      reviews
    });
  } catch (err) {
    console.error('[MaintenanceReviewRoute:History] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to fetch maintenance review history.'
    });
  }
});

/**
 * GET /api/maintenance-reviews/:reviewId
 * Retrieves a single review by ID with factory scoping.
 */
router.get('/:reviewId', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const review = await DailyMaintenanceReview.findOne({
      _id: req.params.reviewId,
      factoryId
    })
      .populate('issueGroups.machineId', 'code name type location')
      .populate('issueGroups.linkedWorkOrderId', 'orderNumber status priority assignedTechnicianId')
      .lean();

    if (!review) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Daily maintenance review not found or unauthorized.'
      });
    }

    return res.status(200).json({
      success: true,
      review
    });
  } catch (err) {
    console.error('[MaintenanceReviewRoute:GetById] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to fetch daily maintenance review.'
    });
  }
});

/**
 * POST /api/maintenance-reviews/:reviewId/create-work-order
 * Manager-only endpoint to create and assign a work order for a specific issue group.
 */
router.post('/:reviewId/create-work-order', requireManager, async (req, res) => {
  try {
    const { groupId, assignedTechnicianId, priority, dueDate, title, description, grantMachineAccess, decisionNote } =
      req.body;

    if (!groupId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Field "groupId" is required.'
      });
    }

    if (!assignedTechnicianId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Field "assignedTechnicianId" is required.'
      });
    }

    const result = await createWorkOrderForIssueGroup({
      reviewId: req.params.reviewId,
      groupId,
      workOrderData: {
        assignedTechnicianId,
        priority,
        dueDate,
        title,
        description,
        grantMachineAccess: grantMachineAccess === true,
        decisionNote
      },
      user: req.user
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[MaintenanceReviewRoute:CreateWorkOrder] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to create work order from issue group.'
    });
  }
});

/**
 * POST /api/maintenance-reviews/:reviewId/dismiss-issue
 * Manager-only endpoint to acknowledge/dismiss an issue group with documented rationale.
 */
router.post('/:reviewId/dismiss-issue', requireManager, async (req, res) => {
  try {
    const { groupId, reason } = req.body;

    if (!groupId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Field "groupId" is required.'
      });
    }

    const result = await dismissIssueGroup({
      reviewId: req.params.reviewId,
      groupId,
      reason,
      user: req.user
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[MaintenanceReviewRoute:DismissIssue] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to dismiss issue group.'
    });
  }
});

/**
 * PATCH /api/maintenance-reviews/:reviewId/complete
 * Manager-only endpoint to mark a daily review session completed with closing notes.
 */
router.patch('/:reviewId/complete', requireManager, async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const { managerNotes } = req.body;

    const review = await DailyMaintenanceReview.findOne({
      _id: req.params.reviewId,
      factoryId
    });

    if (!review) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Daily maintenance review not found or unauthorized.'
      });
    }

    review.status = 'completed';
    review.completedAt = new Date();
    review.completedById = req.user._id;
    if (managerNotes) {
      review.managerNotes = managerNotes;
    }

    review.auditLog.push({
      action: 'review_completed',
      performedById: req.user._id,
      performedByName: req.user.fullName,
      performedByRole: req.user.role,
      timestamp: new Date(),
      details: `Manager completed daily maintenance review ${review.reportNumber} with ${review.summary.workOrdersCreatedCount} work orders generated. Notes: ${managerNotes || 'None'}.`
    });

    await review.save();

    return res.status(200).json({
      success: true,
      message: `Daily maintenance review ${review.reportNumber} completed.`,
      review
    });
  } catch (err) {
    console.error('[MaintenanceReviewRoute:Complete] Error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to complete maintenance review.'
    });
  }
});

export default router;
