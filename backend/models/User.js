const mongoose = require('mongoose');

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

const userSchema = new mongoose.Schema(
  {
    // Parents/admins sign in with email; children sign in with a parent-assigned username.
    // Both are sparse-unique so accounts without the field don't collide on null.
    email: { type: String, lowercase: true, trim: true, maxlength: 254, unique: true, sparse: true },
    username: {
      type: String,
      lowercase: true,
      trim: true,
      unique: true,
      sparse: true,
      match: [USERNAME_PATTERN, 'Username must be 3-30 characters: letters, numbers, underscores']
    },
    passwordHash: { type: String, required: true, select: false },
    firstName: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    role: { type: String, enum: ['parent', 'child', 'admin'], required: true, default: 'parent' },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', index: true },
    dateOfBirth: { type: Date },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.failedLoginAttempts;
        delete ret.lockUntil;
        delete ret.__v;
        return ret;
      }
    }
  }
);

userSchema.pre('validate', function (next) {
  if (this.role === 'child' && !this.username) {
    this.invalidate('username', 'Child accounts require a username');
  }
  if (this.role !== 'child' && !this.email) {
    this.invalidate('email', 'Parent and admin accounts require an email');
  }
  if (this.role !== 'admin' && !this.familyId) {
    this.invalidate('familyId', 'A family is required');
  }
  next();
});

userSchema.statics.USERNAME_PATTERN = USERNAME_PATTERN;

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
