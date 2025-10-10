import React from 'react';

const InteractionsList = ({ interactions }) => {
  const getThreatLevelColor = (level) => {
    switch (level) {
      case 'high':
        return 'text-red-600 bg-red-100';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100';
      case 'low':
        return 'text-green-600 bg-green-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const formatTimeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInMinutes = Math.floor((now - time) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Recent Interactions
      </h3>
      <div className="space-y-3">
        {interactions.map((interaction) => (
          <div key={interaction.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-gray-800">
                  {interaction.platform}
                </span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getThreatLevelColor(interaction.threatLevel)}`}>
                  {interaction.threatLevel}
                </span>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {interaction.type}: {interaction.description}
              </p>
              <p className="text-xs text-gray-500">
                User: {interaction.username}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">
                {formatTimeAgo(interaction.timestamp)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InteractionsList;