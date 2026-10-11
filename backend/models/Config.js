const mongoose = require('mongoose');

// Defaults live in code (not only the schema) so reads can merge them over a sparse stored doc
const DEFAULTS = Object.freeze({
  monitoringEnabled: true,
  alertThresholds: {
    inappropriate: { enabled: true, severity: 'high' },
    suspicious: { enabled: true, severity: 'medium' },
    excessive: { enabled: true, threshold: 100, severity: 'low' }
  },
  notifications: {
    email: { enabled: false, address: '' },
    sms: { enabled: false, phone: '' },
    push: { enabled: true }
  },
  contentFilters: { profanity: true, violence: true, adult: true, personalInfo: true },
  dataRetention: { interactions: 90, alerts: 365 }
});

const severity = { type: String, enum: ['low', 'medium', 'high', 'critical'] };

const configSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, unique: true },
    monitoringEnabled: Boolean,
    alertThresholds: {
      inappropriate: { enabled: Boolean, severity },
      suspicious: { enabled: Boolean, severity },
      excessive: { enabled: Boolean, threshold: Number, severity }
    },
    notifications: {
      email: { enabled: Boolean, address: String },
      sms: { enabled: Boolean, phone: String },
      push: { enabled: Boolean }
    },
    contentFilters: { profanity: Boolean, violence: Boolean, adult: Boolean, personalInfo: Boolean },
    dataRetention: { interactions: Number, alerts: Number }
  },
  { timestamps: true }
);

configSchema.statics.DEFAULTS = DEFAULTS;

module.exports = mongoose.models.Config || mongoose.model('Config', configSchema);
