import React, { useState, useEffect } from 'react';
import SafetyStatusIndicator from './SafetyStatusIndicator';
import InteractionsList from './InteractionsList';
import AlertsPanel from './AlertsPanel';
import FilteringOptions from './FilteringOptions';
import MonitoringIndicator from './MonitoringIndicator';
import { sampleData } from './sampleData';

const Dashboard = () => {
  const [filters, setFilters] = useState({
    platform: 'all',
    timeRange: '24h',
    threatLevel: 'all'
  });
  
  const [filteredData, setFilteredData] = useState(sampleData);
  const [overallStatus, setOverallStatus] = useState('safe');

  // Filter data based on current filters
  useEffect(() => {
    let filtered = { ...sampleData };
    
    // Filter interactions
    filtered.interactions = sampleData.interactions.filter(interaction => {
      const platformMatch = filters.platform === 'all' || 
        interaction.platform.toLowerCase() === filters.platform;
      const threatMatch = filters.threatLevel === 'all' || 
        interaction.threatLevel === filters.threatLevel;
      
      // Time range filtering
      const now = new Date();
      const interactionTime = new Date(interaction.timestamp);
      const timeDiff = now - interactionTime;
      
      let timeMatch = true;
      switch (filters.timeRange) {
        case '24h':
          timeMatch = timeDiff <= 24 * 60 * 60 * 1000;
          break;
        case '7d':
          timeMatch = timeDiff <= 7 * 24 * 60 * 60 * 1000;
          break;
        case '30d':
          timeMatch = timeDiff <= 30 * 24 * 60 * 60 * 1000;
          break;
      }
      
      return platformMatch && threatMatch && timeMatch;
    });
    
    // Filter alerts
    filtered.alerts = sampleData.alerts.filter(alert => {
      const platformMatch = filters.platform === 'all' || 
        alert.platform.toLowerCase() === filters.platform;
      
      const now = new Date();
      const alertTime = new Date(alert.timestamp);
      const timeDiff = now - alertTime;
      
      let timeMatch = true;
      switch (filters.timeRange) {
        case '24h':
          timeMatch = timeDiff <= 24 * 60 * 60 * 1000;
          break;
        case '7d':
          timeMatch = timeDiff <= 7 * 24 * 60 * 60 * 1000;
          break;
        case '30d':
          timeMatch = timeDiff <= 30 * 24 * 60 * 60 * 1000;
          break;
      }
      
      return platformMatch && timeMatch;
    });
    
    setFilteredData(filtered);
    
    // Update overall status based on filtered alerts
    const highAlerts = filtered.alerts.filter(alert => alert.severity === 'high');
    const mediumAlerts = filtered.alerts.filter(alert => alert.severity === 'medium');
    
    if (highAlerts.length > 0) {
      setOverallStatus('danger');
    } else if (mediumAlerts.length > 0) {
      setOverallStatus('warning');
    } else {
      setOverallStatus('safe');
    }
  }, [filters]);

  const handleFilterChange = (newFilters) => {
    setFilters(newFilters);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            KidVerse Safety Dashboard
          </h1>
          <p className="text-gray-600">
            Monitor your child's online gaming activity and safety
          </p>
        </div>
        
        {/* Top Row - Status and Monitoring */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <SafetyStatusIndicator 
              status={overallStatus}
              lastUpdate={new Date().toISOString()}
            />
          </div>
          <div>
            <MonitoringIndicator 
              isActive={sampleData.monitoring.isActive}
              monitoredPlatforms={sampleData.monitoring.platforms}
              lastSync={sampleData.monitoring.lastSync}
            />
          </div>
        </div>
        
        {/* Filtering Options */}
        <div className="mb-6">
          <FilteringOptions 
            filters={filters}
            onFilterChange={handleFilterChange}
          />
        </div>
        
        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            <AlertsPanel alerts={filteredData.alerts} />
          </div>
          
          {/* Right Column */}
          <div className="space-y-6">
            <InteractionsList interactions={filteredData.interactions.slice(0, 5)} />
          </div>
        </div>
        
        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="text-center text-sm text-gray-500">
            <p>KidVerse Safety Dashboard • Protecting your child's digital experience</p>
            <p className="mt-1">
              Last updated: {new Date().toLocaleString()} • 
              Showing {filteredData.interactions.length} interactions, {filteredData.alerts.length} alerts
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;