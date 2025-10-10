import React from 'react';

const FilteringOptions = ({ filters, onFilterChange }) => {
  const platforms = ['All', 'Roblox', 'Minecraft', 'Discord'];
  const timeRanges = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' }
  ];
  const threatLevels = ['All', 'High', 'Medium', 'Low'];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">
        Filter Options
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Platform Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Platform
          </label>
          <select 
            value={filters.platform}
            onChange={(e) => onFilterChange({ ...filters, platform: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {platforms.map(platform => (
              <option key={platform} value={platform.toLowerCase()}>
                {platform}
              </option>
            ))}
          </select>
        </div>

        {/* Time Range Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Time Range
          </label>
          <select 
            value={filters.timeRange}
            onChange={(e) => onFilterChange({ ...filters, timeRange: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {timeRanges.map(range => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
        </div>

        {/* Threat Level Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Threat Level
          </label>
          <select 
            value={filters.threatLevel}
            onChange={(e) => onFilterChange({ ...filters, threatLevel: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {threatLevels.map(level => (
              <option key={level} value={level.toLowerCase()}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => onFilterChange({ platform: 'all', timeRange: '24h', threatLevel: 'all' })}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            Reset Filters
          </button>
          <button 
            onClick={() => onFilterChange({ ...filters, threatLevel: 'high' })}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
          >
            High Risk Only
          </button>
          <button 
            onClick={() => onFilterChange({ ...filters, timeRange: '24h' })}
            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
          >
            Today Only
          </button>
        </div>
      </div>
    </div>
  );
};

export default FilteringOptions;