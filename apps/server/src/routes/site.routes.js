import { Router } from 'express';
import mongoose from 'mongoose';
import { Site } from '../models/Site.js';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';

const router = Router();

// All site routes require authentication
router.use(authenticate);

// Validate id parameter format across all routes
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Invalid site ID format.'
    });
  }
  next();
});

/**
 * GET /api/sites
 * Lists all sites belonging to the user's factory.
 */
router.get('/', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const { includeArchived } = req.query;

    const query = { factoryId };
    if (includeArchived !== 'true') {
      query.isArchived = { $ne: true };
    }

    const sites = await Site.find(query).sort({ code: 1 });

    return res.status(200).json({
      count: sites.length,
      sites
    });
  } catch (err) {
    console.error('[SiteRoute:List] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve factory sites.'
    });
  }
});

/**
 * GET /api/sites/:id
 * Retrieves a single site record within the user's factory.
 */
router.get('/:id', async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const site = await Site.findById(req.params.id);

    if (!site || site.factoryId.toString() !== factoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Site not found within your factory scope.'
      });
    }

    return res.status(200).json({ site });
  } catch (err) {
    console.error('[SiteRoute:GetById] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve site.'
    });
  }
});

/**
 * POST /api/sites
 * Manager-only endpoint to create a new production site.
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const { name, code, description, area } = req.body;

    if (!name || !name.trim() || !code || !code.trim()) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Both site name and site code are required.'
      });
    }

    const formattedCode = code.trim().toUpperCase();

    // Check for duplicate code in the same factory
    const existing = await Site.findOne({ factoryId, code: formattedCode });
    if (existing) {
      return res.status(409).json({
        error: 'Conflict',
        message: `A site with code "${formattedCode}" already exists in your factory.`
      });
    }

    const site = await Site.create({
      factoryId,
      name: name.trim(),
      code: formattedCode,
      description: description?.trim() || '',
      area: area?.trim() || ''
    });

    return res.status(201).json({
      success: true,
      message: 'Site created successfully.',
      site
    });
  } catch (err) {
    console.error('[SiteRoute:Create] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to create site.'
    });
  }
});

/**
 * PUT /api/sites/:id
 * Manager-only endpoint to update an existing site.
 */
router.put('/:id', requireManager, async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const site = await Site.findById(req.params.id);

    if (!site || site.factoryId.toString() !== factoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Site not found within your factory scope.'
      });
    }

    const { name, code, description, area } = req.body;

    if (code && code.trim().toUpperCase() !== site.code) {
      const formattedCode = code.trim().toUpperCase();
      const duplicate = await Site.findOne({
        factoryId,
        code: formattedCode,
        _id: { $ne: site._id }
      });
      if (duplicate) {
        return res.status(409).json({
          error: 'Conflict',
          message: `A site with code "${formattedCode}" already exists in your factory.`
        });
      }
      site.code = formattedCode;
    }

    if (name && name.trim()) {
      site.name = name.trim();
    }
    if (description !== undefined) {
      site.description = description.trim();
    }
    if (area !== undefined) {
      site.area = area.trim();
    }

    await site.save();

    return res.status(200).json({
      success: true,
      message: 'Site updated successfully.',
      site
    });
  } catch (err) {
    console.error('[SiteRoute:Update] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to update site.'
    });
  }
});

/**
 * DELETE /api/sites/:id
 * Manager-only endpoint to archive a site.
 * Verifies no active machines are currently located at this site.
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const site = await Site.findById(req.params.id);

    if (!site || site.factoryId.toString() !== factoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Site not found within your factory scope.'
      });
    }

    // Check for machines stationed at this site
    const activeMachineCount = await Machine.countDocuments({
      siteId: site._id,
      isDecommissioned: { $ne: true }
    });

    if (activeMachineCount > 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Cannot archive site "${site.code}". It currently contains ${activeMachineCount} active machine(s). Reassign or decommission machines first.`
      });
    }

    site.isArchived = true;
    await site.save();

    return res.status(200).json({
      success: true,
      message: `Site "${site.code}" archived successfully.`,
      site
    });
  } catch (err) {
    console.error('[SiteRoute:Archive] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to archive site.'
    });
  }
});

export default router;
