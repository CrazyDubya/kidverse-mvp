const express = require('express');
const router = express.Router();

// Middleware for input validation
const validatePagination = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  
  if (page < 1) {
    return res.status(400).json({ 
      error: 'Invalid pagination', 
      message: 'Page number must be greater than 0' 
    });
  }
  
  if (limit < 1 || limit > 100) {
    return res.status(400).json({ 
      error: 'Invalid pagination', 
      message: 'Limit must be between 1 and 100' 
    });
  }
  
  req.pagination = { page, limit, skip: (page - 1) * limit };
  next();
};

// Middleware for authentication (placeholder - implement based on your auth system)
const authenticate = (req, res, next) => {
  // TODO: Implement actual authentication
  // For MVP, you might want to verify JWT token or session
  // Example: const token = req.headers.authorization?.split(' ')[1];
  
  // For now, allowing all requests - REPLACE THIS IN PRODUCTION
  next();
};

/**
 * GET /api/status
 * Get overall safety status and summary statistics
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    // TODO: Replace with actual database queries
    // This is a placeholder structure for MVP
    const status = {
      overallStatus: 'safe', // 'safe', 'warning', 'critical'
      lastUpdated: new Date().toISOString(),
      statistics: {
        totalInteractions: 0,
        flaggedInteractions: 0,
        activeAlerts: 0,
        resolvedAlerts: 0,
        monitoringEnabled: true
      },
      recentActivity: {
        last24Hours: {
          interactions: 0,
          alerts: 0
        },
        last7Days: {
          interactions: 0,
          alerts: 0
        }
      },
      systemHealth: {
        apiStatus: 'operational',
        lastCheckIn: new Date().toISOString()
      }
    };

    res.json(status);
  } catch (error) {
    console.error('Error fetching safety status:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to retrieve safety status' 
    });
  }
});

/**
 * GET /api/interactions
 * Get interaction history with pagination and optional filters
 */
router.get('/interactions', authenticate, validatePagination, async (req, res) => {
  try {
    const { page, limit, skip } = req.pagination;
    const { startDate, endDate, flagged, userId } = req.query;

    // Build filter object
    const filters = {};
    
    if (startDate || endDate) {
      filters.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return res.status(400).json({ 
            error: 'Invalid date format', 
            message: 'startDate must be a valid ISO 8601 date' 
          });
        }
        filters.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return res.status(400).json({ 
            error: 'Invalid date format', 
            message: 'endDate must be a valid ISO 8601 date' 
          });
        }
        filters.timestamp.$lte = end;
      }
    }
    
    if (flagged !== undefined) {
      filters.flagged = flagged === 'true';
    }
    
    if (userId) {
      filters.userId = userId;
    }

    // TODO: Replace with actual database queries
    // Example with MongoDB:
    // const interactions = await Interaction.find(filters)
    //   .sort({ timestamp: -1 })
    //   .skip(skip)
    //   .limit(limit);
    // const total = await Interaction.countDocuments(filters);

    const interactions = [];
    const total = 0;

    res.json({
      interactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      filters: filters
    });
  } catch (error) {
    console.error('Error fetching interactions:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to retrieve interaction history' 
    });
  }
});

/**
 * GET /api/alerts
 * Get safety alerts with optional filtering
 */
router.get('/alerts', authenticate, async (req, res) => {
  try {
    const { status, severity, limit } = req.query;
    
    // Build filter object
    const filters = {};
    
    if (status) {
      const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: 'Invalid status', 
          message: `Status must be one of: ${validStatuses.join(', ')}` 
        });
      }
      filters.status = status;
    }
    
    if (severity) {
      const validSeverities = ['low', 'medium', 'high', 'critical'];
      if (!validSeverities.includes(severity)) {
        return res.status(400).json({ 
          error: 'Invalid severity', 
          message: `Severity must be one of: ${validSeverities.join(', ')}` 
        });
      }
      filters.severity = severity;
    }

    const queryLimit = limit ? Math.min(parseInt(limit), 100) : 50;

    // TODO: Replace with actual database queries
    // Example:
    // const alerts = await Alert.find(filters)
    //   .sort({ createdAt: -1, severity: -1 })
    //   .limit(queryLimit);

    const alerts = [];

    res.json({
      alerts,
      count: alerts.length,
      filters: filters
    });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to retrieve alerts' 
    });
  }
});

/**
 * POST /api/alerts/:id/review
 * Mark an alert as reviewed with optional notes
 */
router.post('/alerts/:id/review', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes, reviewedBy } = req.body;

    // Validate alert ID
    if (!id || id.trim() === '') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Alert ID is required' 
      });
    }

    // Validate action
    const validActions = ['resolved', 'dismissed', 'escalated', 'pending'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ 
        error: 'Invalid action', 
        message: `Action must be one of: ${validActions.join(', ')}` 
      });
    }

    // Validate notes (optional but should be string if provided)
    if (notes !== undefined && typeof notes !== 'string') {
      return res.status(400).json({ 
        error: 'Invalid notes', 
        message: 'Notes must be a string' 
      });
    }

    // TODO: Replace with actual database update
    // Example:
    // const alert = await Alert.findById(id);
    // if (!alert) {
    //   return res.status(404).json({ 
    //     error: 'Not found', 
    //     message: 'Alert not found' 
    //   });
    // }
    // 
    // alert.status = action;
    // alert.reviewedAt = new Date();
    // alert.reviewedBy = reviewedBy || req.user.id;
    // alert.reviewNotes = notes;
    // await alert.save();

    // Placeholder response
    const updatedAlert = {
      id,
      status: action,
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy || 'current_user',
      reviewNotes: notes || null
    };

    res.json({
      success: true,
      message: `Alert ${action} successfully`,
      alert: updatedAlert
    });
  } catch (error) {
    console.error('Error reviewing alert:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to review alert' 
    });
  }
});

/**
 * GET /api/config
 * Get current monitoring configuration settings
 */
router.get('/config', authenticate, async (req, res) => {
  try {
    // TODO: Replace with actual database query or config file
    // Example:
    // const config = await Config.findOne({ userId: req.user.id });

    const config = {
      monitoringEnabled: true,
      alertThresholds: {
        inappropriate: {
          enabled: true,
          severity: 'high'
        },
        suspicious: {
          enabled: true,
          severity: 'medium'
        },
        excessive: {
          enabled: true,
          threshold: 100, // interactions per hour
          severity: 'low'
        }
      },
      notifications: {
        email: {
          enabled: false,
          address: ''
        },
        sms: {
          enabled: false,
          phone: ''
        },
        push: {
          enabled: true
        }
      },
      contentFilters: {
        profanity: true,
        violence: true,
        adult: true,
        personalInfo: true
      },
      dataRetention: {
        interactions: 90, // days
        alerts: 365 // days
      },
      lastUpdated: new Date().toISOString()
    };

    res.json(config);
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to retrieve configuration' 
    });
  }
});

/**
 * POST /api/config
 * Update monitoring configuration settings
 */
router.post('/config', authenticate, async (req, res) => {
  try {
    const updates = req.body;

    // Validate configuration updates
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ 
        error: 'Invalid request', 
        message: 'Configuration updates must be provided as an object' 
      });
    }

    // Validate monitoringEnabled if provided
    if (updates.monitoringEnabled !== undefined && typeof updates.monitoringEnabled !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid configuration', 
        message: 'monitoringEnabled must be a boolean' 
      });
    }

    // Validate alertThresholds if provided
    if (updates.alertThresholds) {
      if (typeof updates.alertThresholds !== 'object') {
        return res.status(400).json({ 
          error: 'Invalid configuration', 
          message: 'alertThresholds must be an object' 
        });
      }
    }

    // Validate notifications if provided
    if (updates.notifications) {
      if (typeof updates.notifications !== 'object') {
        return res.status(400).json({ 
          error: 'Invalid configuration', 
          message: 'notifications must be an object' 
        });
      }
      
      // Validate email if provided
      if (updates.notifications.email?.address) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updates.notifications.email.address)) {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: 'Invalid email address format' 
          });
        }
      }
      
      // Validate phone if provided
      if (updates.notifications.sms?.phone) {
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        if (!phoneRegex.test(updates.notifications.sms.phone)) {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: 'Invalid phone number format (use E.164 format)' 
          });
        }
      }
    }

    // Validate contentFilters if provided
    if (updates.contentFilters) {
      if (typeof updates.contentFilters !== 'object') {
        return res.status(400).json({ 
          error: 'Invalid configuration', 
          message: 'contentFilters must be an object' 
        });
      }
      
      const validFilters = ['profanity', 'violence', 'adult', 'personalInfo'];
      for (const [key, value] of Object.entries(updates.contentFilters)) {
        if (!validFilters.includes(key)) {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: `Invalid content filter: ${key}. Valid filters: ${validFilters.join(', ')}` 
          });
        }
        if (typeof value !== 'boolean') {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: `Content filter ${key} must be a boolean` 
          });
        }
      }
    }

    // Validate dataRetention if provided
    if (updates.dataRetention) {
      if (typeof updates.dataRetention !== 'object') {
        return res.status(400).json({ 
          error: 'Invalid configuration', 
          message: 'dataRetention must be an object' 
        });
      }
      
      if (updates.dataRetention.interactions !== undefined) {
        const interactions = parseInt(updates.dataRetention.interactions);
        if (isNaN(interactions) || interactions < 1 || interactions > 365) {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: 'interactions retention must be between 1 and 365 days' 
          });
        }
      }
      
      if (updates.dataRetention.alerts !== undefined) {
        const alerts = parseInt(updates.dataRetention.alerts);
        if (isNaN(alerts) || alerts < 1 || alerts > 365) {
          return res.status(400).json({ 
            error: 'Invalid configuration', 
            message: 'alerts retention must be between 1 and 365 days' 
          });
        }
      }
    }

    // TODO: Replace with actual database update
    // Example:
    // const config = await Config.findOneAndUpdate(
    //   { userId: req.user.id },
    //   { 
    //     ...updates,
    //     lastUpdated: new Date()
    //   },
    //   { new: true, upsert: true }
    // );

    const updatedConfig = {
      ...updates,
      lastUpdated: new Date().toISOString()
    };

    res.json({
      success: true,
      message: 'Configuration updated successfully',
      config: updatedConfig
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: 'Failed to update configuration' 
    });
  }
});

// Error handling middleware for this router
router.use((err, req, res, next) => {
  console.error('Dashboard route error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    message: 'An error occurred processing your request'
  });
});

module.exports = router;
