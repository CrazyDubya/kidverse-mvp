export const sampleData = {
  interactions: [
    {
      id: 1,
      platform: 'Roblox',
      type: 'Chat Message',
      description: 'Received friend request from new user',
      username: 'CoolGamer123',
      timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
      threatLevel: 'low'
    },
    {
      id: 2,
      platform: 'Roblox',
      type: 'Private Message',
      description: 'User asked for personal information',
      username: 'FriendlyHelper',
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
      threatLevel: 'high'
    },
    {
      id: 3,
      platform: 'Minecraft',
      type: 'Server Chat',
      description: 'Normal gameplay conversation',
      username: 'BuilderPro',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      threatLevel: 'low'
    },
    {
      id: 4,
      platform: 'Roblox',
      type: 'Group Chat',
      description: 'Inappropriate language detected',
      username: 'EdgeLord99',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      threatLevel: 'medium'
    },
    {
      id: 5,
      platform: 'Discord',
      type: 'Voice Chat',
      description: 'Joined gaming voice channel',
      username: 'TeamPlayer',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
      threatLevel: 'low'
    },
    {
      id: 6,
      platform: 'Roblox',
      type: 'Trade Request',
      description: 'Suspicious trade offer received',
      username: 'RichTrader',
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
      threatLevel: 'medium'
    },
    {
      id: 7,
      platform: 'Minecraft',
      type: 'Server Join',
      description: 'Joined creative building server',
      username: 'ArchitectKid',
      timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
      threatLevel: 'low'
    },
    {
      id: 8,
      platform: 'Roblox',
      type: 'Private Message',
      description: 'User repeatedly messaging after being ignored',
      username: 'PersistentUser',
      timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
      threatLevel: 'high'
    }
  ],
  
  alerts: [
    {
      id: 1,
      category: 'predatory_behavior',
      severity: 'high',
      platform: 'Roblox',
      description: 'User "FriendlyHelper" asked for personal information including real name and address',
      timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      details: {
        messages: [
          'Hey what\'s your real name?',
          'Where do you live? I want to send you Robux',
          'Can you give me your phone number?'
        ],
        riskFactors: ['Personal info request', 'Gift offering', 'Contact outside platform']
      }
    },
    {
      id: 2,
      category: 'inappropriate_content',
      severity: 'medium',
      platform: 'Roblox',
      description: 'Inappropriate language detected in group chat',
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      details: {
        messages: ['Multiple profanity instances', 'Sexual references'],
        riskFactors: ['Language filter bypass', 'Repeated violations']
      }
    },
    {
      id: 3,
      category: 'cyberbullying',
      severity: 'high',
      platform: 'Roblox',
      description: 'Persistent harassment from user "PersistentUser" after being blocked',
      timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      details: {
        messages: [
          'You can\'t ignore me forever',
          'I\'ll find you on other games',
          'Why are you being so mean?'
        ],
        riskFactors: ['Persistent contact', 'Threats', 'Boundary violation']
      }
    },
    {
      id: 4,
      category: 'inappropriate_content',
      severity: 'low',
      platform: 'Minecraft',
      description: 'Mild inappropriate content in server chat',
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      details: {
        messages: ['Borderline inappropriate jokes'],
        riskFactors: ['Minor language issues']
      }
    }
  ],
  
  monitoring: {
    isActive: true,
    lastSync: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    platforms: [
      {
        name: 'Roblox',
        connected: true,
        lastActivity: new Date(Date.now() - 15 * 60 * 1000).toISOString()
      },
      {
        name: 'Minecraft',
        connected: true,
        lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        name: 'Discord',
        connected: false,
        lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  },
  
  statistics: {
    totalInteractions: 156,
    safeInteractions: 142,
    flaggedInteractions: 14,
    blockedUsers: 3,
    reportedContent: 2
  }
};