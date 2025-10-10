const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { promisify } = require('util');

/**
 * Socket.IO handler for real-time dashboard updates
 */
class SocketHandler {
  constructor(io) {
    this.io = io;
    this.connectedUsers = new Map(); // userId -> socketId mapping
    this.familyRooms = new Map(); // familyId -> Set of socketIds
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  /**
   * Setup Socket.IO middleware for authentication
   */
  setupMiddleware() {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
        
        // Get user from database
        const user = await User.findById(decoded.userId).select('-password');
        if (!user || !user.isActive) {
          return next(new Error('Invalid user or account deactivated'));
        }

        // Attach user to socket
        socket.user = user;
        next();
      } catch (error) {
        console.error('Socket authentication error:', error);
        next(new Error('Authentication failed'));
      }
    });
  }

  /**
   * Setup event handlers for socket connections
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
      
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });

      socket.on('join_family_room', () => {
        this.handleJoinFamilyRoom(socket);
      });

      socket.on('leave_family_room', () => {
        this.handleLeaveFamilyRoom(socket);
      });

      socket.on('activity_started', (data) => {
        this.handleActivityStarted(socket, data);
      });

      socket.on('activity_progress', (data) => {
        this.handleActivityProgress(socket, data);
      });

      socket.on('activity_completed', (data) => {
        this.handleActivityCompleted(socket, data);
      });

      socket.on('child_online_status', (data) => {
        this.handleChildOnlineStatus(socket, data);
      });

      socket.on('error', (error) => {
        console.error(`Socket error for user ${socket.user._id}:`, error);
      });
    });
  }

  /**
   * Handle new socket connection
   */
  handleConnection(socket) {
    const userId = socket.user._id.toString();
    const familyId = socket.user.familyId.toString();

    console.log(`User ${socket.user.firstName} (${userId}) connected`);

    // Store user connection
    this.connectedUsers.set(userId, socket.id);

    // Join family room automatically
    socket.join(`family_${familyId}`);
    
    // Add to family room tracking
    if (!this.familyRooms.has(familyId)) {
      this.familyRooms.set(familyId, new Set());
    }
    this.familyRooms.get(familyId).add(socket.id);

    // Notify family members about user coming online
    socket.to(`family_${familyId}`).emit('user_online', {
      userId: userId,
      userName: socket.user.firstName,
      role: socket.user.role,
      timestamp: new Date()
    });

    // Send current online family members to the newly connected user
    this.sendOnlineFamilyMembers(socket, familyId);
  }

  /**
   * Handle socket disconnection
   */
  handleDisconnection(socket) {
    const userId = socket.user._id.toString();
    const familyId = socket.user.familyId.toString();

    console.log(`User ${socket.user.firstName} (${userId}) disconnected`);

    // Remove from connected users
    this.connectedUsers.delete(userId);

    // Remove from family room tracking
    if (this.familyRooms.has(familyId)) {
      this.familyRooms.get(familyId).delete(socket.id);
      if (this.familyRooms.get(familyId).size === 0) {
        this.familyRooms.delete(familyId);
      }
    }

    // Notify family members about user going offline
    socket.to(`family_${familyId}`).emit('user_offline', {
      userId: userId,
      userName: socket.user.firstName,
      role: socket.user.role,
      timestamp: new Date()
    });
  }

  /**
   * Handle joining family room
   */
  handleJoinFamilyRoom(socket) {
    const familyId = socket.user.familyId.toString();
    socket.join(`family_${familyId}`);
    
    socket.emit('joined_family_room', {
      familyId: familyId,
      message: 'Successfully joined family room'
    });
  }

  /**
   * Handle leaving family room
   */
  handleLeaveFamilyRoom(socket) {
    const familyId = socket.user.familyId.toString();
    socket.leave(`family_${familyId}`);
    
    socket.emit('left_family_room', {
      familyId: familyId,
      message: 'Successfully left family room'
    });
  }

  /**
   * Handle activity started event
   */
  handleActivityStarted(socket, data) {
    try {
      const familyId = socket.user.familyId.toString();
      
      // Validate data
      if (!data.activityId || !data.childId) {
        socket.emit('error', { message: 'Missing required activity data' });
        return;
      }

      // Broadcast to family members
      socket.to(`family_${familyId}`).emit('activity_started', {
        activityId: data.activityId,
        childId: data.childId,
        childName: data.childName,
        activityTitle: data.activityTitle,
        startTime: new Date(),
        initiatedBy: socket.user._id
      });

      console.log(`Activity started: ${data.activityTitle} by child ${data.childId}`);
    } catch (error) {
      console.error('Error handling activity started:', error);
      socket.emit('error', { message: 'Failed to process activity start' });
    }
  }

  /**
   * Handle activity progress update
   */
  handleActivityProgress(socket, data) {
    try {
      const familyId = socket.user.familyId.toString();
      
      // Validate data
      if (!data.activityId || !data.childId || typeof data.progress !== 'number') {
        socket.emit('error', { message: 'Invalid progress data' });
        return;
      }

      // Broadcast progress update to family members
      socket.to(`family_${familyId}`).emit('activity_progress_update', {
        activityId: data.activityId,
        childId: data.childId,
        progress: Math.min(100, Math.max(0, data.progress)), // Clamp between 0-100
        timeSpent: data.timeSpent,
        timestamp: new Date()
      });

      console.log(`Activity progress: ${data.progress}% for activity ${data.activityId}`);
    } catch (error) {
      console.error('Error handling activity progress:', error);
      socket.emit('error', { message: 'Failed to process progress update' });
    }
  }

  /**
   * Handle activity completion
   */
  handleActivityCompleted(socket, data) {
    try {
      const familyId = socket.user.familyId.toString();
      
      // Validate data
      if (!data.activityId || !data.childId) {
        socket.emit('error', { message: 'Missing required completion data' });
        return;
      }

      // Broadcast completion to family members
      socket.to(`family_${familyId}`).emit('activity_completed', {
        activityId: data.activityId,
        childId: data.childId,
        childName: data.childName,
        activityTitle: data.activityTitle,
        completionTime: new Date(),
        totalTimeSpent: data.totalTimeSpent,
        score: data.score,
        achievements: data.achievements || []
      });

      console.log(`Activity completed: ${data.activityTitle} by child ${data.childId}`);
    } catch (error) {
      console.error('Error handling activity completion:', error);
      socket.emit('error', { message: 'Failed to process activity completion' });
    }
  }

  /**
   * Handle child online status update
   */
  handleChildOnlineStatus(socket, data) {
    try {
      const familyId = socket.user.familyId.toString();
      
      // Only parents can update child status, or children can update their own status
      if (socket.user.role === 'child' && socket.user._id.toString() !== data.childId) {
        socket.emit('error', { message: 'Unauthorized to update this child\'s status' });
        return;
      }

      // Broadcast status update to family members
      socket.to(`family_${familyId}`).emit('child_status_update', {
        childId: data.childId,
        status: data.status, // 'online', 'offline', 'busy', 'away'
        activity: data.currentActivity,
        timestamp: new Date()
      });

      console.log(`Child status update: ${data.childId} is now ${data.status}`);
    } catch (error) {
      console.error('Error handling child status update:', error);
      socket.emit('error', { message: 'Failed to update child status' });
    }
  }

  /**
   * Send list of online family members to a socket
   */
  async sendOnlineFamilyMembers(socket, familyId) {
    try {
      const familySocketIds = this.familyRooms.get(familyId) || new Set();
      const onlineMembers = [];

      for (const [userId, socketId] of this.connectedUsers.entries()) {
        if (familySocketIds.has(socketId)) {
          const userSocket = this.io.sockets.sockets.get(socketId);
          if (userSocket && userSocket.user) {
            onlineMembers.push({
              userId: userId,
              name: userSocket.user.firstName,
              role: userSocket.user.role
            });
          }
        }
      }

      socket.emit('online_family_members', onlineMembers);
    } catch (error) {
      console.error('Error sending online family members:', error);
    }
  }

  /**
   * Broadcast notification to specific user
   */
  notifyUser(userId, event, data) {
    const socketId = this.connectedUsers.get(userId.toString());
    if (socketId) {
      this.io.to(socketId).emit(event, data);
      return true;
    }
    return false;
  }

  /**
   * Broadcast notification to all family members
   */
  notifyFamily(familyId, event, data, excludeUserId = null) {
    const room = `family_${familyId}`;
    if (excludeUserId) {
      const excludeSocketId = this.connectedUsers.get(excludeUserId.toString());
      if (excludeSocketId) {
        this.io.to(room).except(excludeSocketId).emit(event, data);
      } else {
        this.io.to(room).emit(event, data);
      }
    } else {
      this.io.to(room).emit(event, data);
    }
  }

  /**
   * Get online status for a family
   */
  getFamilyOnlineStatus(familyId) {
    const familySocketIds = this.familyRooms.get(familyId.toString()) || new Set();
    const onlineMembers = [];

    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (familySocketIds.has(socketId)) {
        const userSocket = this.io.sockets.sockets.get(socketId);
        if (userSocket && userSocket.user) {
          onlineMembers.push({
            userId: userId,
            name: userSocket.user.firstName,
            role: userSocket.user.role,
            lastSeen: new Date()
          });
        }
      }
    }

    return onlineMembers;
  }

  /**
   * Cleanup disconnected sockets
   */
  cleanup() {
    // Remove any stale connections
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        this.connectedUsers.delete(userId);
      }
    }

    // Clean up empty family rooms
    for (const [familyId, socketIds] of this.familyRooms.entries()) {
      const validSocketIds = new Set();
      for (const socketId of socketIds) {
        if (this.io.sockets.sockets.has(socketId)) {
          validSocketIds.add(socketId);
        }
      }
      
      if (validSocketIds.size === 0) {
        this.familyRooms.delete(familyId);
      } else {
        this.familyRooms.set(familyId, validSocketIds);
      }
    }
  }
}

module.exports = SocketHandler;