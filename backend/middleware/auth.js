const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { promisify } = require('util');

/**
 * JWT Authentication Middleware
 * Validates JWT tokens and attaches user info to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided or invalid format.'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Token is valid but user no longer exists.'
      });
    }

    // Check if user account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated.'
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired.'
      });
    }
    
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication.'
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {string|Array} roles - Required role(s) to access the route
 */
const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role];
    const requiredRoles = Array.isArray(roles) ? roles : [roles];

    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to access this resource.'
      });
    }

    next();
  };
};

/**
 * Parent authorization middleware
 * Ensures only parents can access parent-specific routes
 */
const requireParent = authorize(['parent', 'admin']);

/**
 * Child authorization middleware
 * Ensures only children can access child-specific routes
 */
const requireChild = authorize(['child']);

/**
 * Family member validation middleware
 * Ensures user can only access resources within their family
 */
const validateFamilyAccess = async (req, res, next) => {
  try {
    const { familyId } = req.params;
    
    if (!familyId) {
      return res.status(400).json({
        success: false,
        message: 'Family ID is required.'
      });
    }

    // Check if user belongs to the family
    if (req.user.familyId.toString() !== familyId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only access your own family data.'
      });
    }

    next();
  } catch (error) {
    console.error('Family access validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error validating family access.'
    });
  }
};

/**
 * Child profile access validation
 * Ensures parents can only access their own children's profiles
 */
const validateChildAccess = async (req, res, next) => {
  try {
    const { childId } = req.params;
    
    if (!childId) {
      return res.status(400).json({
        success: false,
        message: 'Child ID is required.'
      });
    }

    // If user is a child, they can only access their own profile
    if (req.user.role === 'child') {
      if (req.user._id.toString() !== childId) {
        return res.status(403).json({
          success: false,
          message: 'Children can only access their own profile.'
        });
      }
    } else if (req.user.role === 'parent') {
      // Parents can only access children in their family
      const child = await User.findById(childId);
      if (!child || child.familyId.toString() !== req.user.familyId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only access your own children.'
        });
      }
    }

    next();
  } catch (error) {
    console.error('Child access validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error validating child access.'
    });
  }
};

/**
 * Rate limiting middleware for authentication attempts
 */
const authRateLimit = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
};

module.exports = {
  authenticate,
  authorize,
  requireParent,
  requireChild,
  validateFamilyAccess,
  validateChildAccess,
  authRateLimit
};