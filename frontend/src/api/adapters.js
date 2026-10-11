// Maps API documents to the props the presentational dashboard components expect.

const SOURCE_NAMES = { roblox: 'Roblox', manual: 'Manual' };

export const threatLevelFor = (riskScore = 0) => (riskScore >= 7 ? 'high' : riskScore >= 3 ? 'medium' : 'low');

// The detector's "type:category" labels all describe grooming-style behaviour
const categoryFor = (categories = []) =>
  categories.some((c) => /^(predatory_language|personal_info_request|off_platform_pressure):/.test(c))
    ? 'predatory_behavior'
    : 'inappropriate_content';

const truncate = (text = '', max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const mapInteraction = (i) => ({
  id: i._id,
  platform: SOURCE_NAMES[i.source] || 'Roblox',
  type: i.direction === 'outgoing' ? 'Sent message' : 'Received message',
  description: truncate(i.message),
  username: i.contact || 'Unknown',
  timestamp: i.timestamp,
  threatLevel: threatLevelFor(i.riskScore),
  childId: i.userId
});

export const mapAlert = (a) => ({
  id: a._id,
  category: categoryFor(a.categories),
  severity: a.severity === 'critical' ? 'high' : a.severity,
  platform: 'Roblox',
  description: a.description || 'Potential safety concern detected',
  timestamp: a.createdAt,
  status: a.status,
  childId: a.userId
});

export const isOpenAlert = (alert) => alert.status === 'pending' || alert.status === 'escalated';

export const mapOverallStatus = (status) => ({ critical: 'danger', warning: 'warning' })[status] || 'safe';

export const RANGE_MS = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };
