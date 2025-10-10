const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const socketIO = require('socket.io');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
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

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
      req.user = decoded;
    } catch (error) {
      // Token invalid but we don't fail the request
      req.user = null;
    }
  }
  next();
};

// ============================================
// SOCKET.IO CONFIGURATION
// ============================================

const activeUsers = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // User joins
  socket.on('user:join', (userData) => {
    activeUsers.set(socket.id, userData);
    socket.broadcast.emit('user:online', userData);
    console.log(`👤 User joined: ${userData.username}`);
  });

  // Handle chat messages
  socket.on('chat:message', (data) => {
    io.emit('chat:message', {
      ...data,
      timestamp: new Date().toISOString()
    });
  });

  // Handle game events
  socket.on('game:join', (gameData) => {
    socket.join(gameData.roomId);
    io.to(gameData.roomId).emit('game:player-joined', {
      userId: gameData.userId,
      username: gameData.username
    });
  });

  socket.on('game:action', (actionData) => {
    socket.to(actionData.roomId).emit('game:action', actionData);
  });

  // User disconnects
  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      socket.broadcast.emit('user:offline', user);
      activeUsers.delete(socket.id);
      console.log(`👤 User disconnected: ${user.username}`);
    }
    console.log(`🔌 Client disconnected: ${socket.id}`);
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
app.use('/api/auth', (req, res) => {
  res.status(200).json({ message: 'Auth routes - to be implemented' });
});

app.use('/api/users', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'User routes - authenticated', user: req.user });
});

app.use('/api/games', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'Game routes - to be implemented' });
});

app.use('/api/content', (req, res) => {
  res.status(200).json({ message: 'Content routes - to be implemented' });
});

app.use('/api/parents', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'Parent routes - to be implemented' });
});

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

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
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

// Start the server
startServer();

// Export for testing
module.exports = { app, server, io };
