const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const socketIO = require('socket.io');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

// Load environment variables
dotenv.config();

const dashboardRoutes = require('./routes/dashboard');
const authRoutes = require('./routes/auth');
const User = require('./models/User');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIO(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parser middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// HTTP request logger
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ============================================
// MONGODB CONNECTION
// ============================================

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kidverse';
    
    await mongoose.connect(mongoURI);
    
    console.log('✅ MongoDB connected successfully');
    
    // MongoDB connection event listeners
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected');
    });
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

const JWT_SECRET = process.env.JWT_SECRET;
const MIN_SECRET_LENGTH = 32;

// Fail fast: never run with a missing/weak signing secret outside of tests
if (process.env.NODE_ENV !== 'test') {
  if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET is not set. Refusing to start.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < MIN_SECRET_LENGTH) {
    console.error(`❌ JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`);
    process.exit(1);
  }
}

// Pin the algorithm to prevent algorithm-confusion attacks
const verifyToken = (token) => jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

const extractBearer = (header) => {
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

const authenticateToken = (req, res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
  const token = extractBearer(req.headers.authorization);
  try {
    req.user = token ? verifyToken(token) : null;
  } catch (error) {
    req.user = null;
  }
  next();
};

// ============================================
// SOCKET.IO CONFIGURATION
// ============================================

const activeUsers = new Map();

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MESSAGE_LENGTH = 1000;
const CHAT_WINDOW_MS = 10 * 1000;
const CHAT_MAX_PER_WINDOW = 20;

// Escape on output rather than trying to strip markup with a regex
const escapeHtml = (str) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || extractBearer(socket.handshake.headers.authorization);
  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded.userId) {
      return next(new Error('Invalid authentication token'));
    }
    // A valid signature isn't enough: the account must still be active and the token current
    const account = await User.findById(decoded.userId).select('isActive tokenVersion').lean();
    if (!account || !account.isActive || (decoded.tv || 0) !== (account.tokenVersion || 0)) {
      return next(new Error('Invalid authentication token'));
    }
    socket.user = decoded;
    socket.data.userId = String(decoded.userId); // lets the API find and drop this user's sockets
    next();
  } catch (error) {
    return next(new Error('Invalid authentication token'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  const displayName = user.username || user.email || 'user';
  const publicUser = { id: user.userId, username: displayName, role: user.role };

  // Every user lives in a private scope: their family room, or a personal room.
  // Nothing is ever broadcast globally, so users can't see other families' traffic.
  const scope = user.familyId ? `family_${user.familyId}` : `user_${user.userId}`;
  socket.join(scope);

  activeUsers.set(socket.id, publicUser);
  socket.to(scope).emit('user:online', publicUser);

  // Simple per-socket chat flood control
  let windowStart = Date.now();
  let sentInWindow = 0;

  socket.on('chat:message', (data) => {
    if (!data || typeof data.message !== 'string') {
      socket.emit('error', { message: 'Invalid message format' });
      return;
    }

    const now = Date.now();
    if (now - windowStart > CHAT_WINDOW_MS) {
      windowStart = now;
      sentInWindow = 0;
    }
    if (++sentInWindow > CHAT_MAX_PER_WINDOW) {
      socket.emit('error', { message: 'You are sending messages too quickly' });
      return;
    }

    const message = data.message.trim().substring(0, MAX_MESSAGE_LENGTH);
    if (!message) {
      socket.emit('error', { message: 'Message cannot be empty' });
      return;
    }

    io.to(scope).emit('chat:message', {
      message: escapeHtml(message),
      senderId: user.userId,
      senderName: escapeHtml(String(displayName)),
      timestamp: new Date().toISOString()
    });
  });

  socket.on('game:join', (gameData) => {
    const roomId = gameData && gameData.roomId;
    if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
      socket.emit('error', { message: 'Invalid room ID' });
      return;
    }
    // Namespaced so clients can't join internal family_/user_ rooms by name
    const room = `game_${roomId}`;
    socket.join(room);
    io.to(room).emit('game:player-joined', {
      userId: user.userId,
      username: displayName
    });
  });

  socket.on('game:action', (actionData) => {
    const roomId = actionData && actionData.roomId;
    if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) return;
    const room = `game_${roomId}`;
    // Only members can emit into a room
    if (!socket.rooms.has(room)) return;
    socket.to(room).emit('game:action', {
      action: actionData.action,
      payload: actionData.payload,
      roomId,
      userId: user.userId
    });
  });

  socket.on('disconnect', () => {
    const userData = activeUsers.get(socket.id);
    if (userData) {
      socket.to(scope).emit('user:offline', userData);
      activeUsers.delete(socket.id);
    }
  });
});

// Make io accessible in routes
app.set('io', io);

// ============================================
// API ROUTES
// ============================================

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Kidverse API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API base route
app.get('/api', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Kidverse API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      games: '/api/games',
      content: '/api/content',
      parents: '/api/parents'
    }
  });
});

// Import route modules (to be created)
// const authRoutes = require('./routes/auth.routes');
// const userRoutes = require('./routes/user.routes');
// const gameRoutes = require('./routes/game.routes');
// const contentRoutes = require('./routes/content.routes');
// const parentRoutes = require('./routes/parent.routes');

// Register API routes
// app.use('/api/auth', authRoutes);
// app.use('/api/users', authenticateToken, userRoutes);
// app.use('/api/games', authenticateToken, gameRoutes);
// app.use('/api/content', optionalAuth, contentRoutes);
// app.use('/api/parents', authenticateToken, parentRoutes);

// Placeholder routes (remove when actual routes are implemented)
app.use('/api/auth', authRoutes);

app.use('/api/users', authenticateToken, (req, res) => {
  // SECURITY FIX: Don't expose full user object, only safe fields
  res.status(200).json({
    message: 'User routes - authenticated',
    user: {
      id: req.user.userId,
      role: req.user.role
    }
  });
});

app.use('/api/games', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'Game routes - to be implemented' });
});

app.use('/api/content', optionalAuth, (req, res) => {
  res.status(200).json({ message: 'Content routes - to be implemented' });
});

app.use('/api/parents', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'Parent routes - to be implemented' });
});

// Dashboard routes (status, interactions, alerts, config) - each route enforces its own auth
app.use('/api', dashboardRoutes);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Resource not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error details server-side only
  console.error('❌ Error:', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors
    });
  }

  // Mongoose duplicate key error - SECURITY: Don't reveal field names in production
  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      message: process.env.NODE_ENV === 'development'
        ? `${Object.keys(err.keyPattern)[0]} already exists`
        : 'A record with this value already exists'
    });
  }

  // JWT errors - SECURITY: Generic messages to prevent enumeration
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }

  // SECURITY FIX: Never expose internal error details to clients
  // Default error response - generic message for production
  const isDev = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : 'An error occurred processing your request',
    // Only include error ID for tracking, never stack traces
    errorId: Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
  });
});

// ============================================
// SERVER STARTUP
// ============================================

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start server
    server.listen(PORT, () => {
      console.log('🚀 ========================================');
      console.log(`🚀 Kidverse MVP Server`);
      console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🚀 API available at http://localhost:${PORT}/api`);
      console.log(`🚀 Socket.io ready for connections`);
      console.log('🚀 ========================================');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

// Start the server (not when imported by tests)
if (require.main === module) {
  startServer();
}

// Export for testing
module.exports = { app, server, io };
