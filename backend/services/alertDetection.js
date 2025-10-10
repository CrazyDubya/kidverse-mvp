/**
 * AI-Powered Alert Detection System for Kidverse MVP
 * Detects predatory behavior, personal information requests, and off-platform pressure
 * 
 * @author Stephen Thompson
 * @version 1.0.0
 */

class AlertDetectionService {
  constructor() {
    this.initializePatterns();
  }

  initializePatterns() {
    // Predatory Language & Grooming Patterns
    this.predatoryPatterns = {
      // Trust building and isolation
      trustBuilding: {
        patterns: [
          /you're so mature for your age/i,
          /you understand me better than/i,
          /don't tell (your )?parents/i,
          /this is our (little )?secret/i,
          /you're different from other kids/i,
          /you're special/i,
          /i trust you more than/i,
          /you can trust me/i,
          /i won't tell anyone/i,
          /keep this between us/i
        ],
        riskScore: 8,
        confidence: 0.85
      },
      
      // Inappropriate compliments and sexualization
      inappropriateCompliments: {
        patterns: [
          /you're so (pretty|beautiful|hot|sexy)/i,
          /i bet you look good/i,
          /you have a nice (body|figure)/i,
          /are you developed/i,
          /do you have a boyfriend/i,
          /have you kissed anyone/i,
          /you're growing up/i,
          /becoming a woman/i
        ],
        riskScore: 9,
        confidence: 0.9
      },

      // Gift offering and manipulation
      giftManipulation: {
        patterns: [
          /i'll buy you/i,
          /want some (robux|money|gift)/i,
          /i can get you/i,
          /free (robux|premium|items)/i,
          /special gift for you/i,
          /you deserve something nice/i,
          /let me spoil you/i
        ],
        riskScore: 7,
        confidence: 0.8
      },

      // Emotional manipulation
      emotionalManipulation: {
        patterns: [
          /no one understands you like i do/i,
          /your parents don't get it/i,
          /i'm the only one who cares/i,
          /you can tell me anything/i,
          /i'm here for you/i,
          /you're lonely/i,
          /i know how you feel/i,
          /we have a connection/i
        ],
        riskScore: 6,
        confidence: 0.75
      }
    };

    // Personal Information Request Patterns
    this.personalInfoPatterns = {
      // Direct personal info requests
      directRequests: {
        patterns: [
          /what's your (real )?name/i,
          /where do you live/i,
          /what (school|grade) are you in/i,
          /what's your address/i,
          /what's your phone number/i,
          /how old are you really/i,
          /send me a (pic|picture|photo)/i,
          /what do you look like/i,
          /are you home alone/i,
          /when are your parents home/i
        ],
        riskScore: 9,
        confidence: 0.95
      },

      // Indirect information gathering
      indirectGathering: {
        patterns: [
          /what city are you from/i,
          /what state do you live in/i,
          /what's your timezone/i,
          /what time do you get home/i,
          /do you walk to school/i,
          /are you allowed out/i,
          /when do you get off school/i,
          /what's your schedule like/i
        ],
        riskScore: 7,
        confidence: 0.8
      },

      // Photo and video requests
      mediaRequests: {
        patterns: [
          /send (me )?a selfie/i,
          /can i see what you look like/i,
          /show me your room/i,
          /take a picture of/i,
          /video chat/i,
          /turn on your camera/i,
          /let me see you/i,
          /facetime me/i
        ],
        riskScore: 8,
        confidence: 0.9
      }
    };

    // Off-Platform Pressure Patterns
    this.offPlatformPatterns = {
      // Discord pressure
      discordPressure: {
        patterns: [
          /add me on discord/i,
          /let's talk on discord/i,
          /discord is better/i,
          /we can talk privately on discord/i,
          /my discord is/i,
          /dm me on discord/i,
          /voice chat on discord/i
        ],
        riskScore: 8,
        confidence: 0.85
      },

      // Other social platforms
      socialPlatforms: {
        patterns: [
          /add me on (snapchat|snap|instagram|tiktok|whatsapp)/i,
          /text me at/i,
          /call me at/i,
          /my (snap|insta|phone) is/i,
          /follow me on/i,
          /dm me on/i
        ],
        riskScore: 7,
        confidence: 0.8
      },

      // Meeting requests
      meetingRequests: {
        patterns: [
          /want to meet (up|irl)/i,
          /let's meet in person/i,
          /can we hang out/i,
          /i live near you/i,
          /i can pick you up/i,
          /meet me at/i,
          /come over to my place/i,
          /let's meet somewhere/i
        ],
        riskScore: 10,
        confidence: 0.95
      },

      // Platform switching justification
      platformSwitching: {
        patterns: [
          /roblox chat is limited/i,
          /we can talk better on/i,
          /roblox might ban us/i,
          /let's move to/i,
          /this platform is better/i,
          /more privacy on/i,
          /roblox is watching/i
        ],
        riskScore: 6,
        confidence: 0.7
      }
    };

    // Context enhancers that increase risk when combined
    this.contextEnhancers = {
      ageGap: {
        patterns: [
          /i'm (1[8-9]|[2-9]\d)/i, // 18+ age mentions
          /i'm an adult/i,
          /i'm older/i,
          /age is just a number/i
        ],
        multiplier: 1.5
      },
      
      secrecy: {
        patterns: [
          /don't tell/i,
          /keep (this|it) secret/i,
          /between us/i,
          /our secret/i,
          /private/i
        ],
        multiplier: 1.3
      },

      urgency: {
        patterns: [
          /right now/i,
          /quickly/i,
          /before someone/i,
          /hurry/i,
          /fast/i
        ],
        multiplier: 1.2
      }
    };
  }

  /**
   * Main detection method - analyzes message for threats
   * @param {string} message - The message to analyze
   * @param {Object} context - Additional context (sender age, recipient age, etc.)
   * @returns {Object} Detection result with risk score and details
   */
  detectThreats(message, context = {}) {
    const results = {
      overallRisk: 0,
      confidence: 0,
      threats: [],
      recommendations: []
    };

    // Analyze each threat category
    const predatoryResults = this.analyzePredatoryLanguage(message);
    const personalInfoResults = this.analyzePersonalInfoRequests(message);
    const offPlatformResults = this.analyzeOffPlatformPressure(message);

    // Combine results
    const allThreats = [
      ...predatoryResults.threats,
      ...personalInfoResults.threats,
      ...offPlatformResults.threats
    ];

    if (allThreats.length > 0) {
      // Calculate overall risk score
      const maxRisk = Math.max(...allThreats.map(t => t.riskScore));
      const avgConfidence = allThreats.reduce((sum, t) => sum + t.confidence, 0) / allThreats.length;
      
      // Apply context enhancers
      const enhancedRisk = this.applyContextEnhancers(message, maxRisk);
      
      results.overallRisk = Math.min(10, enhancedRisk);
      results.confidence = avgConfidence;
      results.threats = allThreats;
      results.recommendations = this.generateRecommendations(results.overallRisk, allThreats);
    }

    return results;
  }

  /**
   * Analyze message for predatory language patterns
   */
  analyzePredatoryLanguage(message) {
    const threats = [];
    
    Object.entries(this.predatoryPatterns).forEach(([category, config]) => {
      const matches = this.findPatternMatches(message, config.patterns);
      
      if (matches.length > 0) {
        threats.push({
          type: 'predatory_language',
          category: category,
          riskScore: config.riskScore,
          confidence: config.confidence,
          matches: matches,
          description: this.getPredatoryDescription(category)
        });
      }
    });

    return { threats };
  }

  /**
   * Analyze message for personal information requests
   */
  analyzePersonalInfoRequests(message) {
    const threats = [];
    
    Object.entries(this.personalInfoPatterns).forEach(([category, config]) => {
      const matches = this.findPatternMatches(message, config.patterns);
      
      if (matches.length > 0) {
        threats.push({
          type: 'personal_info_request',
          category: category,
          riskScore: config.riskScore,
          confidence: config.confidence,
          matches: matches,
          description: this.getPersonalInfoDescription(category)
        });
      }
    });

    return { threats };
  }

  /**
   * Analyze message for off-platform pressure
   */
  analyzeOffPlatformPressure(message) {
    const threats = [];
    
    Object.entries(this.offPlatformPatterns).forEach(([category, config]) => {
      const matches = this.findPatternMatches(message, config.patterns);
      
      if (matches.length > 0) {
        threats.push({
          type: 'off_platform_pressure',
          category: category,
          riskScore: config.riskScore,
          confidence: config.confidence,
          matches: matches,
          description: this.getOffPlatformDescription(category)
        });
      }
    });

    return { threats };
  }

  /**
   * Find pattern matches in message
   */
  findPatternMatches(message, patterns) {
    const matches = [];
    
    patterns.forEach(pattern => {
      const match = message.match(pattern);
      if (match) {
        matches.push({
          text: match[0],
          pattern: pattern.source,
          index: match.index
        });
      }
    });

    return matches;
  }

  /**
   * Apply context enhancers to increase risk score
   */
  applyContextEnhancers(message, baseRisk) {
    let enhancedRisk = baseRisk;
    
    Object.entries(this.contextEnhancers).forEach(([enhancer, config]) => {
      const hasEnhancer = config.patterns.some(pattern => pattern.test(message));
      if (hasEnhancer) {
        enhancedRisk *= config.multiplier;
      }
    });

    return enhancedRisk;
  }

  /**
   * Generate recommendations based on threat level
   */
  generateRecommendations(riskScore, threats) {
    const recommendations = [];

    if (riskScore >= 9) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'IMMEDIATE_INTERVENTION',
        message: 'Immediately block user and alert parents/guardians. Contact platform safety team.'
      });
    } else if (riskScore >= 7) {
      recommendations.push({
        priority: 'HIGH',
        action: 'ALERT_PARENTS',
        message: 'Alert parents and recommend blocking user. Monitor future interactions closely.'
      });
    } else if (riskScore >= 5) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'WARNING',
        message: 'Show safety warning to child. Log interaction for pattern analysis.'
      });
    } else if (riskScore >= 3) {
      recommendations.push({
        priority: 'LOW',
        action: 'MONITOR',
        message: 'Continue monitoring. Educate child about online safety.'
      });
    }

    // Add specific recommendations based on threat types
    const threatTypes = [...new Set(threats.map(t => t.type))];
    
    if (threatTypes.includes('off_platform_pressure')) {
      recommendations.push({
        priority: 'HIGH',
        action: 'PLATFORM_EDUCATION',
        message: 'Educate child about staying on safe platforms and not sharing contact information.'
      });
    }

    if (threatTypes.includes('personal_info_request')) {
      recommendations.push({
        priority: 'HIGH',
        action: 'PRIVACY_EDUCATION',
        message: 'Remind child never to share personal information online.'
      });
    }

    return recommendations;
  }

  /**
   * Get description for predatory language categories
   */
  getPredatoryDescription(category) {
    const descriptions = {
      trustBuilding: 'Attempting to build inappropriate trust and isolate the child',
      inappropriateCompliments: 'Making inappropriate comments about appearance or development',
      giftManipulation: 'Offering gifts or rewards to manipulate the child',
      emotionalManipulation: 'Using emotional manipulation to create dependency'
    };
    return descriptions[category] || 'Predatory language detected';
  }

  /**
   * Get description for personal info categories
   */
  getPersonalInfoDescription(category) {
    const descriptions = {
      directRequests: 'Directly requesting personal identifying information',
      indirectGathering: 'Indirectly gathering location or schedule information',
      mediaRequests: 'Requesting photos, videos, or visual contact'
    };
    return descriptions[category] || 'Personal information request detected';
  }

  /**
   * Get description for off-platform categories
   */
  getOffPlatformDescription(category) {
    const descriptions = {
      discordPressure: 'Pressuring to move conversation to Discord',
      socialPlatforms: 'Requesting contact on other social platforms',
      meetingRequests: 'Attempting to arrange in-person meetings',
      platformSwitching: 'Justifying need to switch communication platforms'
    };
    return descriptions[category] || 'Off-platform pressure detected';
  }

  /**
   * Batch analyze multiple messages for pattern detection
   */
  batchAnalyze(messages, context = {}) {
    return messages.map(message => ({
      message: message.text || message,
      timestamp: message.timestamp || new Date(),
      analysis: this.detectThreats(message.text || message, context)
    }));
  }

  /**
   * Get threat statistics for reporting
   */
  getThreatStatistics(analyses) {
    const stats = {
      totalMessages: analyses.length,
      threatsDetected: 0,
      highRiskMessages: 0,
      threatTypes: {},
      averageRisk: 0
    };

    let totalRisk = 0;

    analyses.forEach(analysis => {
      if (analysis.analysis.threats.length > 0) {
        stats.threatsDetected++;
        totalRisk += analysis.analysis.overallRisk;

        if (analysis.analysis.overallRisk >= 7) {
          stats.highRiskMessages++;
        }

        analysis.analysis.threats.forEach(threat => {
          stats.threatTypes[threat.type] = (stats.threatTypes[threat.type] || 0) + 1;
        });
      }
    });

    stats.averageRisk = stats.threatsDetected > 0 ? totalRisk / stats.threatsDetected : 0;

    return stats;
  }
}

module.exports = AlertDetectionService;