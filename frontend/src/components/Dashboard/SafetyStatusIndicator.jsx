import React from 'react';

const SafetyStatusIndicator = ({ status, lastUpdate }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'safe':
        return {
          color: 'bg-green-500',
          text: 'Safe',
          textColor: 'text-green-700',
          bgColor: 'bg-green-50',
          borderColor: 'border-green-200',
          pulse: false
        };
      case 'warning':
        return {
          color: 'bg-yellow-500',
          text: 'Caution',
          textColor: 'text-yellow-700',
          bgColor: 'bg-yellow-50',
          borderColor: 'border-yellow-200',
          pulse: true
        };
      case 'danger':
        return {
          color: 'bg-red-500',
          text: 'Alert',
          textColor: 'text-red-700',
          bgColor: 'bg-red-50',
          borderColor: 'border-red-200',
          pulse: true
        };
      default:
        return {
          color: 'bg-gray-500',
          text: 'Unknown',
          textColor: 'text-gray-700',
          bgColor: 'bg-gray-50',
          borderColor: 'border-gray-200',
          pulse: false
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`p-6 rounded-lg border-2 ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-center space-x-4">
        <div className="relative">
          <div className={`w-4 h-4 rounded-full ${config.color}`}></div>
          {config.pulse && (
            <div className={`absolute inset-0 w-4 h-4 rounded-full ${config.color} animate-ping opacity-75`}></div>
          )}
        </div>
        <div>
          <h3 className={`text-lg font-semibold ${config.textColor}`}>
            Safety Status: {config.text}
          </h3>
          <p className="text-sm text-gray-600">
            Last updated: {new Date(lastUpdate).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

export default SafetyStatusIndicator;