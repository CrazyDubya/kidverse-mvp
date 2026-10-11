import { describe, expect, it } from 'vitest';
import { isOpenAlert, mapAlert, mapInteraction, mapOverallStatus, threatLevelFor } from './adapters';

describe('adapters', () => {
  it('buckets risk scores into threat levels', () => {
    expect([0, 2.9, 3, 6.9, 7, 10].map(threatLevelFor)).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high']);
    expect(threatLevelFor(undefined)).toBe('low');
  });

  it('maps an interaction to component props', () => {
    const mapped = mapInteraction({
      _id: 'i1', source: 'roblox', direction: 'outgoing', message: 'hello', contact: 'Bob', timestamp: 't', riskScore: 8, userId: 'c1'
    });
    expect(mapped).toEqual({
      id: 'i1', platform: 'Roblox', type: 'Sent message', description: 'hello', username: 'Bob',
      timestamp: 't', threatLevel: 'high', childId: 'c1'
    });
  });

  it('truncates long messages and tolerates a missing contact', () => {
    const mapped = mapInteraction({ _id: 'i', message: 'x'.repeat(500), timestamp: 't' });
    expect(mapped.description).toHaveLength(140);
    expect(mapped.username).toBe('Unknown');
    expect(mapped.type).toBe('Received message');
  });

  it('maps alerts: grooming categories and critical severity', () => {
    const mapped = mapAlert({
      _id: 'a1', severity: 'critical', status: 'pending', createdAt: 't', description: 'd',
      categories: ['off_platform_pressure:meetingRequests']
    });
    expect(mapped).toMatchObject({ id: 'a1', category: 'predatory_behavior', severity: 'high', timestamp: 't' });
    expect(mapAlert({ _id: 'a2', severity: 'low', categories: [] }).category).toBe('inappropriate_content');
  });

  it('treats pending and escalated alerts as open', () => {
    expect(['pending', 'escalated', 'resolved', 'dismissed', 'reviewed'].map((status) => isOpenAlert({ status })))
      .toEqual([true, true, false, false, false]);
  });

  it('maps server status to indicator status', () => {
    expect(['critical', 'warning', 'safe', undefined].map(mapOverallStatus)).toEqual(['danger', 'warning', 'safe', 'safe']);
  });
});
