const { body, param, query, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const xss = require('xss');
const DOMPurify = require('isomorphic-dompurify');

/**
 * Handle validation errors middleware
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(error => ({
        field: error.path || error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

/**
 * Sanitize input data
 */
const sanitizeInput = (req, res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      // Remove XSS attempts and sanitize HTML
      return DOMPurify.sanitize(xss(value.trim()));
    }
    if (typeof value === 'object' && value !== null) {
      const sanitized = {};
      for (const key in value) {
        sanitized[key] = sanitizeValue(value[key]);
      }
      return sanitized;
    }
    return value;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeValue(req.query);
  }

  next();
};

/**
 * User registration validation
 */
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('First name must be 2-50 characters and contain only letters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Last name must be 2-50 characters and contain only letters'),
  body('role')
    .isIn(['parent', 'child'])
    .withMessage('Role must be either parent or child'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('Date of birth must be a valid date'),
  handleValidationErrors
];

/**
 * User login validation
 */
const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

/**
 * Child profile validation
 */
const validateChildProfile = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('First name must be 2-50 characters and contain only letters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Last name must be 2-50 characters and contain only letters'),
  body('dateOfBirth')
    .isISO8601()
    .toDate()
    .custom((value) => {
      const age = Math.floor((Date.now() - new Date(value).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 3 || age > 17) {
        throw new Error('Child must be between 3 and 17 years old');
      }
      return true;
    }),
  body('grade')
    .optional()
    .isInt({ min: -1, max: 12 })
    .withMessage('Grade must be between -1 (Pre-K) and 12'),
  body('interests')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Interests must be an array with maximum 10 items'),
  body('interests.*')
    .optional()
    .trim()
    .isLength({ min: 2, max: 30 })
    .matches(/^[a-zA-Z0-9\s]+$/)
    .withMessage('Each interest must be 2-30 characters and contain only letters, numbers, and spaces'),
  handleValidationErrors
];

/**
 * Activity validation
 */
const validateActivity = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Activity title must be 3-100 characters long'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Activity description must be 10-500 characters long'),
  body('category')
    .isIn(['educational', 'creative', 'physical', 'social', 'stem', 'reading'])
    .withMessage('Invalid activity category'),
  body('ageRange')
    .isObject()
    .withMessage('Age range must be an object'),
  body('ageRange.min')
    .isInt({ min: 3, max: 17 })
    .withMessage('Minimum age must be between 3 and 17'),
  body('ageRange.max')
    .isInt({ min: 3, max: 17 })
    .withMessage('Maximum age must be between 3 and 17')
    .custom((value, { req }) => {
      if (value < req.body.ageRange.min) {
        throw new Error('Maximum age must be greater than or equal to minimum age');
      }
      return true;
    }),
  body('duration')
    .isInt({ min: 5, max: 180 })
    .withMessage('Duration must be between 5 and 180 minutes'),
  body('difficulty')
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Difficulty must be easy, medium, or hard'),
  body('materials')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Materials must be an array with maximum 20 items'),
  body('materials.*')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Each material must be 2-50 characters long'),
  handleValidationErrors
];

/**
 * Progress tracking validation
 */
const validateProgress = [
  body('activityId')
    .isMongoId()
    .withMessage('Invalid activity ID'),
  body('childId')
    .isMongoId()
    .withMessage('Invalid child ID'),
  body('status')
    .isIn(['started', 'in_progress', 'completed', 'abandoned'])
    .withMessage('Invalid progress status'),
  body('completionPercentage')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Completion percentage must be between 0 and 100'),
  body('timeSpent')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Time spent must be a positive number'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),
  handleValidationErrors
];

/**
 * MongoDB ObjectId validation
 */
const validateObjectId = (paramName) => [
  param(paramName)
    .custom((value) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error(`Invalid ${paramName}`);
      }
      return true;
    }),
  handleValidationErrors
];

/**
 * Pagination validation
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('sortBy')
    .optional()
    .matches(/^[a-zA-Z_]+$/)
    .withMessage('Sort field can only contain letters and underscores'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc', '1', '-1'])
    .withMessage('Sort order must be asc, desc, 1, or -1'),
  handleValidationErrors
];

/**
 * Search validation
 */
const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .matches(/^[a-zA-Z0-9\s\-_]+$/)
    .withMessage('Search query must be 2-100 characters and contain only letters, numbers, spaces, hyphens, and underscores'),
  query('category')
    .optional()
    .isIn(['educational', 'creative', 'physical', 'social', 'stem', 'reading'])
    .withMessage('Invalid category filter'),
  query('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard'])
    .withMessage('Invalid difficulty filter'),
  query('ageMin')
    .optional()
    .isInt({ min: 3, max: 17 })
    .withMessage('Minimum age must be between 3 and 17'),
  query('ageMax')
    .optional()
    .isInt({ min: 3, max: 17 })
    .withMessage('Maximum age must be between 3 and 17'),
  handleValidationErrors
];

/**
 * File upload validation
 */
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded'
    });
  }

  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const maxFileSize = 5 * 1024 * 1024; // 5MB

  if (!allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
    });
  }

  if (req.file.size > maxFileSize) {
    return res.status(400).json({
      success: false,
      message: 'File size too large. Maximum size is 5MB.'
    });
  }

  next();
};

module.exports = {
  handleValidationErrors,
  sanitizeInput,
  validateUserRegistration,
  validateUserLogin,
  validateChildProfile,
  validateActivity,
  validateProgress,
  validateObjectId,
  validatePagination,
  validateSearch,
  validateFileUpload
};