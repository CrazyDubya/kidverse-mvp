import React from 'react';

const MonitoringIndicator = ({ isActive, monitoredPlatforms, lastSync }) => {
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${
              isActive ? 'bg-green-500' : 'bg-gray-400'
            }`}></div>
            {isActive && (
              <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-pulse opacity-75"></div>
            )}
          </div>
          <div>
            <h4 className="font-medium text-gray-800">
              Monitoring Status
            </h4>
            <p className="text-sm text-gray-600">
              {isActive ? 'Active' : 'Inactive'} • {monitoredPlatforms.length} platforms
            </p>
          </div>
        </div>
        
        <div className="text-right">
          <p className="text-xs text-gray-500">
            Last sync: {new Date(lastSync).toLocaleTimeString()}
          </p>
        </div>
      </div>
      
      {/* Monitored Platforms */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex flex-wrap gap-2">
          {monitoredPlatforms.map((platform) => (
            <span 
              key={platform.name}
              className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                platform.connected 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              <div className={`w-2 h-2 rounded-full mr-1 ${
                platform.connected ? 'bg-green-500' : 'bg-gray-400'
              }`}></div>
              {platform.name}
            </span>
          ))}
        </div>
      </div>
      
      {/* Transparency Notice */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <p className="text-xs text-gray-500 italic">
          🔒 All monitoring is transparent and privacy-focused. Data is processed locally and only safety alerts are stored.
        </p>
      </div>
    </div>
  );
};

export default MonitoringIndicator;