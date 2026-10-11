import { useState } from 'react';
import SafetyStatusIndicator from './SafetyStatusIndicator';
import InteractionsList from './InteractionsList';
import AlertsPanel from './AlertsPanel';
import FilteringOptions from './FilteringOptions';
import MonitoringIndicator from './MonitoringIndicator';
import ChildrenPanel from './ChildrenPanel';
import { useDashboardData } from '../../hooks/useDashboardData';
import { useAuth } from '../../store/auth';

const GuardianOnly = ({ onLogout }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
    <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 max-w-md text-center">
      <h1 className="text-xl font-semibold text-gray-800 mb-2">This dashboard is for parents and guardians</h1>
      <p className="text-gray-600 mb-4">Ask your parent or guardian to sign in to see safety information.</p>
      <button onClick={onLogout} className="text-sm text-blue-700 underline">Sign out</button>
    </div>
  </div>
);

const Dashboard = () => {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  const [filters, setFilters] = useState({ platform: 'all', timeRange: '24h', threatLevel: 'all' });
  const isGuardian = user && (user.role === 'parent' || user.role === 'admin');
  const data = useDashboardData(filters, Boolean(isGuardian));

  if (!isGuardian) return <GuardianOnly onLogout={logout} />;

  const platforms = [
    {
      name: 'Roblox',
      connected: data.monitoringEnabled,
      lastActivity: data.latestActivity
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">KidVerse Safety Dashboard</h1>
            <p className="text-gray-600">Monitor your child&apos;s online gaming activity and safety</p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <p>{user.firstName}</p>
            <button onClick={logout} className="text-blue-700 underline">Sign out</button>
          </div>
        </div>

        {data.error && (
          <div role="alert" className="mb-6 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            <span>{data.error}</span>
            <button onClick={data.refresh} className="ml-4 rounded bg-red-100 px-3 py-1 text-sm font-medium hover:bg-red-200">
              Retry
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <SafetyStatusIndicator status={data.overallStatus} lastUpdate={data.lastUpdated || new Date().toISOString()} />
          </div>
          <div>
            <MonitoringIndicator
              isActive={data.monitoringEnabled}
              monitoredPlatforms={platforms}
              lastSync={data.lastUpdated || new Date().toISOString()}
            />
          </div>
        </div>

        <div className="mb-6">
          <FilteringOptions filters={filters} onFilterChange={setFilters} />
        </div>

        {data.loading ? (
          <p className="text-center text-gray-500" role="status">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <AlertsPanel alerts={data.alerts} onReview={data.review} />
              <ChildrenPanel kids={data.children} onCreate={data.createChild} />
            </div>
            <div className="space-y-6">
              <InteractionsList interactions={data.interactions.slice(0, 5)} />
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200 text-center text-sm text-gray-500">
          <p>KidVerse Safety Dashboard • Protecting your child&apos;s digital experience</p>
          <p className="mt-1">
            Showing {data.interactions.length} interactions, {data.alerts.length} active alerts
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
