import React from 'react';

const AlertsPanel = ({ alerts }) => {
  const getCategoryIcon = (category) => {
    switch (category) {
      case 'inappropriate_content':
        return '⚠️';
      case 'predatory_behavior':
        return '🚨';
      case 'cyberbullying':
        return '🛡️';
      default:
        return '⚡';
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'inappropriate_content':
        return 'border-l-yellow-500 bg-yellow-50';
      case 'predatory_behavior':
        return 'border-l-red-500 bg-red-50';
      case 'cyberbullying':
        return 'border-l-orange-500 bg-orange-50';
      default:
        return 'border-l-gray-500 bg-gray-50';
    }
  };

  const formatCategory = (category) => {
    return category.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800">
          Safety Alerts
        </h3>
        <span className="bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
          {alerts.length} active
        </span>
      </div>
      
      {alerts.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-gray-600">No active alerts</p>
          <p className="text-sm text-gray-500">Your child's activity looks safe</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className={`border-l-4 p-4 rounded-r-lg ${getCategoryColor(alert.category)}`}>
              <div className="flex items-start space-x-3">
                <span className="text-xl">{getCategoryIcon(alert.category)}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-800">
                      {formatCategory(alert.category)}
                    </h4>
                    <span className="text-xs text-gray-500">
                      {new Date(alert.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">
                    {alert.description}
                  </p>
                  <div className="flex items-center space-x-4 mt-2 text-xs text-gray-600">
                    <span>Platform: {alert.platform}</span>
                    <span>Severity: {alert.severity}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AlertsPanel;