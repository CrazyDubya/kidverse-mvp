import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../api/client';
import { connectSocket } from '../api/socket';
import { useAuth } from '../store/auth';
import { RANGE_MS, isOpenAlert, mapAlert, mapInteraction, mapOverallStatus } from '../api/adapters';

const REFRESH_MS = 60 * 1000;

// `enabled` lets callers skip all network activity (e.g. for non-guardian accounts)
export function useDashboardData(filters, enabled = true) {
  const token = useAuth((s) => s.token);
  const [state, setState] = useState({ status: null, alerts: [], interactions: [], children: [], loading: enabled, error: null });
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const since = new Date(Date.now() - RANGE_MS[filters.timeRange]).toISOString();
      const [status, alerts, interactions, children] = await Promise.all([
        api.get('/status'),
        api.get('/alerts', { params: { limit: 100 } }),
        api.get('/interactions', { params: { limit: 100, startDate: since } }),
        api.get('/auth/children')
      ]);
      if (id !== requestId.current) return; // a newer request superseded this one
      setState({
        status: status.data,
        alerts: alerts.data.alerts.map(mapAlert),
        interactions: interactions.data.interactions.map(mapInteraction),
        children: children.data.children,
        loading: false,
        error: null
      });
    } catch (err) {
      if (id !== requestId.current) return;
      setState((s) => ({ ...s, loading: false, error: errorMessage(err, 'Could not load dashboard data.') }));
    }
  }, [filters.timeRange]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, enabled]);

  // Realtime: refresh as soon as the server raises an alert for the family
  useEffect(() => {
    if (!token || !enabled) return undefined;
    const socket = connectSocket(token);
    socket.on('alert:new', (alert) => {
      toast.error(`New ${alert.severity} alert: ${alert.description}`);
      loadRef.current();
    });
    return () => {
      socket.off('alert:new');
      socket.disconnect();
    };
  }, [token, enabled]);

  const review = useCallback(async (alertId, action) => {
    try {
      await api.post(`/alerts/${alertId}/review`, { action });
      toast.success(`Alert ${action}`);
      await loadRef.current();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the alert.'));
    }
  }, []);

  // Rejects on failure so the form can show the server's message
  const createChild = useCallback(async (child) => {
    await api.post('/auth/children', child);
    toast.success(`Added ${child.firstName}`);
    await loadRef.current();
  }, []);

  const view = useMemo(() => {
    const names = Object.fromEntries(state.children.map((c) => [c.id, c.firstName]));
    const withName = (item) => ({ ...item, childName: names[item.childId] });
    const cutoff = Date.now() - RANGE_MS[filters.timeRange];
    const platformOk = (item) => filters.platform === 'all' || item.platform.toLowerCase() === filters.platform;
    return {
      alerts: state.alerts
        .filter((a) => isOpenAlert(a) && platformOk(a) && new Date(a.timestamp).getTime() >= cutoff)
        .map(withName),
      interactions: state.interactions
        .filter((i) => platformOk(i) && (filters.threatLevel === 'all' || i.threatLevel === filters.threatLevel))
        .map(withName)
    };
  }, [state.alerts, state.interactions, state.children, filters]);

  return {
    ...view,
    children: state.children,
    createChild,
    overallStatus: state.status ? mapOverallStatus(state.status.overallStatus) : 'safe',
    monitoringEnabled: state.status ? state.status.statistics.monitoringEnabled : true,
    lastUpdated: state.status ? state.status.lastUpdated : null,
    latestActivity: state.interactions[0] ? state.interactions[0].timestamp : null,
    loading: state.loading,
    error: state.error,
    refresh: load,
    review
  };
}
