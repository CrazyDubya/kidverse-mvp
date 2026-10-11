const mongoose = require('mongoose');

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed', 'escalated'];

const alertSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    interactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Interaction' },
    severity: { type: String, enum: SEVERITIES, required: true },
    status: { type: String, enum: STATUSES, default: 'pending' },
    riskScore: { type: Number, min: 0, max: 10 },
    confidence: { type: Number, min: 0, max: 1 },
    categories: [{ type: String }],
    description: { type: String, maxlength: 500 },
    recommendations: [{ priority: String, action: String, message: String, _id: false }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, maxlength: 1000 }
  },
  { timestamps: true }
);

alertSchema.index({ familyId: 1, status: 1, createdAt: -1 });
alertSchema.index({ familyId: 1, severity: 1, createdAt: -1 });

alertSchema.statics.SEVERITIES = SEVERITIES;
alertSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
