const express = require('express');
const rateLimit = require('express-rate-limit');

const { authenticate, authorize } = require('../middleware/auth');
const User = require('../models/User');
const Interaction = require('../models/Interaction');
const Alert = require('../models/Alert');
const Config = require('../models/Config');
const { recordInteraction } = require('../services/interactionService');

const router = express.Router();

const requireGuardian = authorize(['parent', 'admin']);

// Mongoose's ObjectId.isValid() also accepts any 12-character string, so be strict
const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const isObjectId = (v) => typeof v === 'string' && OBJECT_ID.test(v);

const fail = (res, status, error, message) => res.status(status).json({ error, message });

// ---------- shared middleware ----------

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests', message: 'Please try again later' }
  })
);

// Every dashboard query is scoped to the caller's family; there is no cross-family access.
const requireFamily = (req, res, next) => {
  if (!req.user.familyId) {
    return fail(res, 403, 'Access denied', 'Your account is not part of a family');
  }
  req.familyId = req.user.familyId;
  next();
};

const validatePagination = (req, res, next) => {
  const { page: rawPage, limit: rawLimit } = req.query;
  if ([rawPage, rawLimit].some((v) => v !== undefined && typeof v !== 'string')) {
    return fail(res, 400, 'Invalid pagination', 'page and limit must be numbers');
  }
  const page = rawPage === undefined ? 1 : parseInt(rawPage, 10);
  const limit = rawLimit === undefined ? 20 : parseInt(rawLimit, 10);

  if (!Number.isInteger(page) || page < 1) {
    return fail(res, 400, 'Invalid pagination', 'Page number must be greater than 0');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return fail(res, 400, 'Invalid pagination', 'Limit must be between 1 and 100');
  }

  req.pagination = { page, limit, skip: (page - 1) * limit };
  next();
};

const requireStringQuery = (...names) => (req, res, next) => {
  for (const name of names) {
    if (req.query[name] !== undefined && typeof req.query[name] !== 'string') {
      return fail(res, 400, 'Invalid query', `${name} must be a single value`);
    }
  }
  next();
};

// Resolve a child id to a member of the caller's family, or null. Used for every userId filter.
const findFamilyMember = (familyId, userId) =>
  isObjectId(userId) ? User.findOne({ _id: userId, familyId }).select('_id role').lean() : null;

// ---------- status ----------

/**
 * GET /api/status
 */
router.get('/status', authenticate, requireGuardian, requireFamily, async (req, res, next) => {
  try {
    const familyId = req.familyId;
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000);
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const open = { $in: ['pending', 'escalated'] };

    const [
      totalInteractions,
      flaggedInteractions,
      activeAlerts,
      resolvedAlerts,
      interactions24h,
      interactions7d,
      alerts24h,
      alerts7d,
      urgentOpen,
      anyOpen,
      config
    ] = await Promise.all([
      Interaction.countDocuments({ familyId }),
      Interaction.countDocuments({ familyId, flagged: true }),
      Alert.countDocuments({ familyId, status: open }),
      Alert.countDocuments({ familyId, status: { $in: ['resolved', 'dismissed'] } }),
      Interaction.countDocuments({ familyId, timestamp: { $gte: since24h } }),
      Interaction.countDocuments({ familyId, timestamp: { $gte: since7d } }),
      Alert.countDocuments({ familyId, createdAt: { $gte: since24h } }),
      Alert.countDocuments({ familyId, createdAt: { $gte: since7d } }),
      Alert.countDocuments({ familyId, status: open, severity: { $in: ['high', 'critical'] } }),
      Alert.countDocuments({ familyId, status: open }),
      Config.findOne({ familyId }).lean()
    ]);

    res.json({
      overallStatus: urgentOpen > 0 ? 'critical' : anyOpen > 0 ? 'warning' : 'safe',
      lastUpdated: new Date().toISOString(),
      statistics: {
        totalInteractions,
        flaggedInteractions,
        activeAlerts,
        resolvedAlerts,
        monitoringEnabled: config && config.monitoringEnabled === false ? false : true
      },
      recentActivity: {
        last24Hours: { interactions: interactions24h, alerts: alerts24h },
        last7Days: { interactions: interactions7d, alerts: alerts7d }
      },
      systemHealth: { apiStatus: 'operational', lastCheckIn: new Date().toISOString() }
    });
  } catch (err) {
    next(err);
  }
});

// ---------- interactions ----------

/**
 * GET /api/interactions
 */
router.get(
  '/interactions',
  authenticate,
  requireGuardian,
  requireFamily,
  validatePagination,
  requireStringQuery('startDate', 'endDate', 'flagged', 'userId'),
  async (req, res, next) => {
    try {
      const { page, limit, skip } = req.pagination;
      const { startDate, endDate, flagged, userId } = req.query;
      const filter = { familyId: req.familyId };

      if (startDate || endDate) {
        filter.timestamp = {};
        for (const [name, value, op] of [['startDate', startDate, '$gte'], ['endDate', endDate, '$lte']]) {
          if (!value) continue;
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            return fail(res, 400, 'Invalid date format', `${name} must be a valid ISO 8601 date`);
          }
          filter.timestamp[op] = date;
        }
      }

      if (flagged !== undefined) filter.flagged = flagged === 'true';

      if (userId !== undefined) {
        const member = await findFamilyMember(req.familyId, userId);
        if (!member) return fail(res, 404, 'Not found', 'User not found');
        filter.userId = member._id;
      }

      const [interactions, total] = await Promise.all([
        Interaction.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
        Interaction.countDocuments(filter)
      ]);

      res.json({
        interactions,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/interactions
 * Ingestion path for observed messages. A child may report only for themself; a guardian
 * may report for any child in their family. Runs threat detection and raises alerts.
 */
router.post('/interactions', authenticate, requireFamily, async (req, res, next) => {
  try {
    const { message, contact, direction, timestamp } = req.body || {};
    let { userId } = req.body || {};

    if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
      return fail(res, 400, 'Invalid message', 'message must be a string of 1-2000 characters');
    }
    if (contact !== undefined && (typeof contact !== 'string' || contact.length > 100)) {
      return fail(res, 400, 'Invalid contact', 'contact must be a string of at most 100 characters');
    }
    if (direction !== undefined && !['incoming', 'outgoing'].includes(direction)) {
      return fail(res, 400, 'Invalid direction', 'direction must be incoming or outgoing');
    }
    let when;
    if (timestamp !== undefined) {
      when = typeof timestamp === 'string' ? new Date(timestamp) : null;
      if (!when || isNaN(when.getTime()) || when.getTime() > Date.now() + 5 * 60 * 1000) {
        return fail(res, 400, 'Invalid timestamp', 'timestamp must be a valid ISO 8601 date that is not in the future');
      }
    }

    const isChild = req.user.role === 'child';
    if (isChild) {
      if (userId !== undefined && String(userId) !== String(req.user._id)) {
        return fail(res, 403, 'Access denied', 'Children can only report their own interactions');
      }
      userId = String(req.user._id);
    } else if (userId === undefined) {
      return fail(res, 400, 'Invalid userId', 'userId is required');
    }

    const member = await findFamilyMember(req.familyId, userId);
    if (!member || member.role !== 'child') return fail(res, 404, 'Not found', 'Child not found');

    const result = await recordInteraction({
      familyId: req.familyId,
      userId: member._id,
      message: message.trim(),
      contact,
      direction,
      timestamp: when,
      io: req.app.get('io')
    });

    if (result.skipped) return res.status(202).json({ success: true, skipped: true });

    // Children don't get to see whether they triggered an alert
    res.status(201).json({
      success: true,
      flagged: isChild ? undefined : result.interaction.flagged,
      interactionId: isChild ? undefined : result.interaction._id,
      alertId: isChild || !result.alert ? undefined : result.alert._id
    });
  } catch (err) {
    next(err);
  }
});

// ---------- alerts ----------

/**
 * GET /api/alerts
 */
router.get(
  '/alerts',
  authenticate,
  requireGuardian,
  requireFamily,
  requireStringQuery('status', 'severity', 'limit', 'userId'),
  async (req, res, next) => {
    try {
      const { status, severity, limit, userId } = req.query;
      const filter = { familyId: req.familyId };

      if (status !== undefined) {
        if (!Alert.STATUSES.includes(status)) {
          return fail(res, 400, 'Invalid status', `Status must be one of: ${Alert.STATUSES.join(', ')}`);
        }
        filter.status = status;
      }
      if (severity !== undefined) {
        if (!Alert.SEVERITIES.includes(severity)) {
          return fail(res, 400, 'Invalid severity', `Severity must be one of: ${Alert.SEVERITIES.join(', ')}`);
        }
        filter.severity = severity;
      }
      if (userId !== undefined) {
        const member = await findFamilyMember(req.familyId, userId);
        if (!member) return fail(res, 404, 'Not found', 'User not found');
        filter.userId = member._id;
      }

      const parsed = parseInt(limit, 10);
      const queryLimit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;

      const alerts = await Alert.find(filter).sort({ createdAt: -1 }).limit(queryLimit).lean();
      res.json({ alerts, count: alerts.length });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/alerts/:id/review
 */
router.post('/alerts/:id/review', authenticate, requireGuardian, requireFamily, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body || {};

    if (!isObjectId(id)) return fail(res, 400, 'Invalid ID', 'id must be a valid identifier');

    const validActions = ['reviewed', 'resolved', 'dismissed', 'escalated', 'pending'];
    if (typeof action !== 'string' || !validActions.includes(action)) {
      return fail(res, 400, 'Invalid action', `Action must be one of: ${validActions.join(', ')}`);
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) {
      return fail(res, 400, 'Invalid notes', 'Notes must be a string of at most 1000 characters');
    }

    // Matching on familyId means another family's alert is indistinguishable from a missing one
    const alert = await Alert.findOneAndUpdate(
      { _id: id, familyId: req.familyId },
      { $set: { status: action, reviewedBy: req.user._id, reviewedAt: new Date(), reviewNotes: notes || null } },
      { new: true }
    ).lean();

    if (!alert) return fail(res, 404, 'Not found', 'Alert not found');

    res.json({ success: true, message: `Alert ${action} successfully`, alert });
  } catch (err) {
    next(err);
  }
});

// ---------- config ----------

const isBool = (v) => typeof v === 'boolean';
const isSeverity = (v) => Alert.SEVERITIES.includes(v);
const intBetween = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;

// Every settable leaf path and how to validate it. Anything not listed is rejected.
const CONFIG_SPEC = {
  monitoringEnabled: isBool,
  'alertThresholds.inappropriate.enabled': isBool,
  'alertThresholds.inappropriate.severity': isSeverity,
  'alertThresholds.suspicious.enabled': isBool,
  'alertThresholds.suspicious.severity': isSeverity,
  'alertThresholds.excessive.enabled': isBool,
  'alertThresholds.excessive.severity': isSeverity,
  'alertThresholds.excessive.threshold': intBetween(1, 10000),
  'notifications.email.enabled': isBool,
  'notifications.email.address': (v) => v === '' || (typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)),
  'notifications.sms.enabled': isBool,
  'notifications.sms.phone': (v) => v === '' || (typeof v === 'string' && /^\+?[1-9]\d{1,14}$/.test(v)),
  'notifications.push.enabled': isBool,
  'contentFilters.profanity': isBool,
  'contentFilters.violence': isBool,
  'contentFilters.adult': isBool,
  'contentFilters.personalInfo': isBool,
  'dataRetention.interactions': intBetween(1, 365),
  'dataRetention.alerts': intBetween(1, 365)
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Flatten nested updates to dotted leaf paths; returns null on anything that isn't a plain object tree
const flatten = (obj, prefix = '', out = {}) => {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Object.prototype.hasOwnProperty.call(CONFIG_SPEC, path)) {
      out[path] = obj[key];
    } else if (isPlainObject(obj[key]) && Object.keys(CONFIG_SPEC).some((p) => p.startsWith(`${path}.`))) {
      flatten(obj[key], path, out);
    } else {
      out[path] = obj[key]; // unknown path: caught by the spec check
    }
  }
  return out;
};

const deepMerge = (base, override) => {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
};

const presentConfig = (stored) => {
  const { _id, familyId, __v, createdAt, ...rest } = stored || {};
  return { ...deepMerge(Config.DEFAULTS, rest), lastUpdated: (stored && stored.updatedAt) || null };
};

/**
 * GET /api/config
 */
router.get('/config', authenticate, requireGuardian, requireFamily, async (req, res, next) => {
  try {
    const stored = await Config.findOne({ familyId: req.familyId }).lean();
    res.json(presentConfig(stored));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/config
 */
router.post('/config', authenticate, requireGuardian, requireFamily, async (req, res, next) => {
  try {
    const updates = req.body;
    if (!isPlainObject(updates) || Object.keys(updates).length === 0) {
      return fail(res, 400, 'Invalid request', 'Configuration updates must be provided as a non-empty object');
    }

    const flat = flatten(updates);
    for (const [path, value] of Object.entries(flat)) {
      const validate = Object.prototype.hasOwnProperty.call(CONFIG_SPEC, path) ? CONFIG_SPEC[path] : null;
      if (!validate) return fail(res, 400, 'Invalid configuration', `Unknown setting: ${path}`);
      if (!validate(value)) return fail(res, 400, 'Invalid configuration', `Invalid value for ${path}`);
    }

    const stored = await Config.findOneAndUpdate(
      { familyId: req.familyId },
      { $set: flat },
      { new: true, upsert: true }
    ).lean();

    res.json({ success: true, message: 'Configuration updated successfully', config: presentConfig(stored) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
