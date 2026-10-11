const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');

const User = require('../models/User');
const Family = require('../models/Family');
const { authenticate, requireParent } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Compared against when the account doesn't exist so response time doesn't reveal it
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' }
});

// ---------- validators ----------

// bcrypt ignores everything past 72 bytes, so cap it
const passwordRule = body('password')
  .isString()
  .isLength({ min: 8, max: 72 })
  .withMessage('Password must be 8-72 characters')
  .matches(/[a-z]/)
  .withMessage('Password must contain a lowercase letter')
  .matches(/[A-Z]/)
  .withMessage('Password must contain an uppercase letter')
  .matches(/\d/)
  .withMessage('Password must contain a number')
  .matches(/[^A-Za-z0-9]/)
  .withMessage('Password must contain a special character');

const nameRule = (field) =>
  body(field)
    .isString()
    .trim()
    .isLength({ min: 2, max: 50 })
    .matches(/^[\p{L}\s'-]+$/u)
    .withMessage(`${field} must be 2-50 characters and contain only letters`);

const validateRegister = [
  body('email').isString().isEmail().isLength({ max: 254 }).normalizeEmail().withMessage('A valid email is required'),
  passwordRule,
  nameRule('firstName'),
  nameRule('lastName'),
  handleValidationErrors
];

const validateLogin = [
  body('identifier').isString().trim().isLength({ min: 3, max: 254 }).withMessage('Email or username is required'),
  body('password').isString().isLength({ min: 1, max: 72 }).withMessage('Password is required'),
  handleValidationErrors
];

const validateCreateChild = [
  body('username')
    .isString()
    .trim()
    .toLowerCase()
    .matches(User.USERNAME_PATTERN)
    .withMessage('Username must be 3-30 characters: letters, numbers, underscores'),
  passwordRule,
  nameRule('firstName'),
  nameRule('lastName'),
  body('dateOfBirth')
    .isISO8601()
    .custom((value) => {
      const dob = new Date(value);
      const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 3 || age > 17) throw new Error('Child must be between 3 and 17 years old');
      return true;
    }),
  handleValidationErrors
];

// ---------- helpers ----------

const signToken = (user) =>
  jwt.sign(
    {
      userId: user._id.toString(),
      role: user.role,
      familyId: user.familyId ? user.familyId.toString() : undefined,
      username: user.username || user.firstName
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

const publicUser = (user) => ({
  id: user._id.toString(),
  email: user.email,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  familyId: user.familyId ? user.familyId.toString() : undefined
});

const isDuplicateKey = (err) => err && err.code === 11000;

// ---------- routes ----------

/**
 * POST /api/auth/register
 * Public registration creates a parent and their family. Child accounts can only be
 * created by an authenticated parent (POST /api/auth/children), so nobody can
 * self-register into someone else's family.
 */
router.post('/register', authLimiter, validateRegister, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const userId = new mongoose.Types.ObjectId();
    const familyId = new mongoose.Types.ObjectId();

    let user;
    try {
      user = await User.create({
        _id: userId,
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'parent',
        familyId
      });
    } catch (err) {
      if (isDuplicateKey(err)) {
        return res.status(409).json({ success: false, message: 'Unable to register with those details' });
      }
      throw err;
    }

    try {
      await Family.create({ _id: familyId, createdBy: userId });
    } catch (err) {
      await User.deleteOne({ _id: userId }); // don't leave a parent pointing at a missing family
      throw err;
    }

    res.status(201).json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 * identifier = email (parents/admins) or username (children)
 */
router.post('/login', authLimiter, validateLogin, async (req, res, next) => {
  try {
    const identifier = req.body.identifier.trim().toLowerCase();
    const { password } = req.body;
    const query = identifier.includes('@') ? { email: identifier } : { username: identifier };

    const user = await User.findOne(query).select('+passwordHash +failedLoginAttempts +lockUntil');

    // Always run a bcrypt compare so timing doesn't reveal whether the account exists
    const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (user && user.lockUntil && user.lockUntil > new Date()) {
      return res.status(429).json({ success: false, message: 'Account temporarily locked. Try again later.' });
    }

    if (!user || !user.isActive || !matches) {
      if (user) {
        const updated = await User.findByIdAndUpdate(
          user._id,
          { $inc: { failedLoginAttempts: 1 } },
          { new: true }
        ).select('+failedLoginAttempts');
        if (updated && updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          await User.updateOne(
            { _id: user._id },
            { $set: { failedLoginAttempts: 0, lockUntil: new Date(Date.now() + LOCK_MS) } }
          );
        }
      }
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.failedLoginAttempts || user.lockUntil) {
      await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0 }, $unset: { lockUntil: 1 } });
    }

    res.json({ success: true, token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/children  (parent only)
 * Creates a child account inside the calling parent's family.
 */
router.post('/children', authenticate, requireParent, validateCreateChild, async (req, res, next) => {
  try {
    if (!req.user.familyId) {
      return res.status(400).json({ success: false, message: 'Your account is not part of a family' });
    }

    const { username, password, firstName, lastName, dateOfBirth } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      const child = await User.create({
        username,
        passwordHash,
        firstName,
        lastName,
        dateOfBirth: new Date(dateOfBirth),
        role: 'child',
        familyId: req.user.familyId
      });
      res.status(201).json({ success: true, user: publicUser(child) });
    } catch (err) {
      if (isDuplicateKey(err)) {
        return res.status(409).json({ success: false, message: 'That username is not available' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

module.exports = router;
