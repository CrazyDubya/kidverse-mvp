const Interaction = require('../models/Interaction');
const Alert = require('../models/Alert');
const Config = require('../models/Config');
const AlertDetectionService = require('./alertDetection');

const detector = new AlertDetectionService();

// Anything below this risk is stored but not flagged
const FLAG_THRESHOLD = 3;

const severityFor = (risk) => {
  if (risk >= 9) return 'critical';
  if (risk >= 7) return 'high';
  if (risk >= 5) return 'medium';
  return 'low';
};

/**
 * Store an observed interaction for a monitored child, run threat detection, and raise an
 * alert (plus a realtime notification to the family room) when the risk is high enough.
 * Returns { skipped: true } when the family has switched monitoring off.
 */
async function recordInteraction({ familyId, userId, message, contact, direction, timestamp, io }) {
  const config = await Config.findOne({ familyId }).lean();
  if (config && config.monitoringEnabled === false) {
    return { skipped: true };
  }

  const analysis = detector.detectThreats(message);
  const flagged = analysis.overallRisk >= FLAG_THRESHOLD;

  const interaction = await Interaction.create({
    familyId,
    userId,
    contact,
    direction,
    message,
    flagged,
    riskScore: analysis.overallRisk,
    timestamp: timestamp || new Date()
  });

  let alert = null;
  if (flagged) {
    alert = await Alert.create({
      familyId,
      userId,
      interactionId: interaction._id,
      severity: severityFor(analysis.overallRisk),
      status: 'pending',
      riskScore: analysis.overallRisk,
      confidence: analysis.confidence,
      categories: [...new Set(analysis.threats.map((t) => `${t.type}:${t.category}`))],
      description: analysis.threats[0].description,
      recommendations: analysis.recommendations
    });

    if (io) {
      // Deliberately excludes the message text
      io.to(`family_${familyId}`).emit('alert:new', {
        id: alert._id.toString(),
        userId: userId.toString(),
        severity: alert.severity,
        description: alert.description,
        createdAt: new Date().toISOString()
      });
    }
  }

  return { interaction, alert };
}

module.exports = { recordInteraction, severityFor, FLAG_THRESHOLD };
