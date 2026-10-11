const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // the monitored child
  source: { type: String, enum: ['roblox', 'manual'], default: 'roblox' },
  contact: { type: String, trim: true, maxlength: 100 }, // the other party's display name
  direction: { type: String, enum: ['incoming', 'outgoing'], default: 'incoming' },
  message: { type: String, required: true, maxlength: 2000 },
  flagged: { type: Boolean, default: false },
  riskScore: { type: Number, default: 0, min: 0, max: 10 },
  timestamp: { type: Date, default: Date.now }
});

interactionSchema.index({ familyId: 1, timestamp: -1 });
interactionSchema.index({ familyId: 1, userId: 1, timestamp: -1 });
interactionSchema.index({ familyId: 1, flagged: 1, timestamp: -1 });

module.exports = mongoose.models.Interaction || mongoose.model('Interaction', interactionSchema);
