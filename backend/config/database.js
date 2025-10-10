const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * Database configuration and connection management
 */
class DatabaseConfig {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
    this.mongoMemoryServer = null;
  }

  /**
   * Get MongoDB connection URI
   */
  getConnectionURI() {
    const environment = process.env.NODE_ENV || 'development';
    
    switch (environment) {
      case 'production':
        return process.env.MONGODB_URI || process.env.DATABASE_URL;
      case 'test':
        return process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/kidverse_test';
      case 'development':
      default:
        return process.env.MONGODB_DEV_URI || 'mongodb://localhost:27017/kidverse_dev';
    }
  }

  /**
   * Get MongoDB connection options
   */
  getConnectionOptions() {
    return {
      // Connection settings
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE) || 2,
      maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME) || 30000,
      serverSelectionTimeoutMS: parseInt(process.env.DB_SERVER_SELECTION_TIMEOUT) || 5000,
      socketTimeoutMS: parseInt(process.env.DB_SOCKET_TIMEOUT) || 45000,
      connectTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT) || 10000,
      
      // Resilience settings
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      retryReads: true,
      
      // Buffer settings
      bufferMaxEntries: 0,
      bufferCommands: false,
      
      // Authentication
      authSource: process.env.DB_AUTH_SOURCE || 'admin',
      
      // SSL/TLS settings for production
      ...(process.env.NODE_ENV === 'production' && {
        ssl: true,
        sslValidate: true,
        sslCA: process.env.DB_SSL_CA,
        sslCert: process.env.DB_SSL_CERT,
        sslKey: process.env.DB_SSL_KEY
      })
    };
  }

  /**
   * Connect to MongoDB with retry logic
   */
  async connect() {
    try {
      // For testing environment, optionally use in-memory MongoDB
      if (process.env.NODE_ENV === 'test' && process.env.USE_MEMORY_DB === 'true') {
        await this.connectToMemoryDB();
        return;
      }

      const uri = this.getConnectionURI();
      if (!uri) {
        throw new Error('MongoDB connection URI is not defined');
      }

      const options = this.getConnectionOptions();
      
      console.log(`Connecting to MongoDB (attempt ${this.retryCount + 1}/${this.maxRetries})...`);
      
      this.connection = await mongoose.connect(uri, options);
      this.isConnected = true;
      this.retryCount = 0;
      
      console.log(`✅ Connected to MongoDB: ${this.connection.connection.name}`);
      console.log(`📊 Database host: ${this.connection.connection.host}:${this.connection.connection.port}`);
      
      // Setup connection event listeners
      this.setupEventListeners();
      
    } catch (error) {
      console.error(`❌ MongoDB connection failed:`, error.message);
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`⏳ Retrying connection in ${this.retryDelay / 1000} seconds...`);
        
        setTimeout(() => {
          this.connect();
        }, this.retryDelay);
      } else {
        console.error(`💥 Max retry attempts (${this.maxRetries}) reached. Exiting...`);
        process.exit(1);
      }
    }
  }

  /**
   * Connect to in-memory MongoDB for testing
   */
  async connectToMemoryDB() {
    try {
      this.mongoMemoryServer = await MongoMemoryServer.create({
        instance: {
          dbName: 'kidverse_test_memory'
        }
      });
      
      const uri = this.mongoMemoryServer.getUri();
      const options = {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferMaxEntries: 0
      };
      
      this.connection = await mongoose.connect(uri, options);
      this.isConnected = true;
      
      console.log('✅ Connected to in-memory MongoDB for testing');
      
    } catch (error) {
      console.error('❌ Failed to connect to in-memory MongoDB:', error.message);
      throw error;
    }
  }

  /**
   * Setup MongoDB connection event listeners
   */
  setupEventListeners() {
    const db = mongoose.connection;
    
    db.on('error', (error) => {
      console.error('❌ MongoDB connection error:', error);
      this.isConnected = false;
    });
    
    db.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected');
      this.isConnected = false;
      
      // Attempt to reconnect
      if (this.retryCount < this.maxRetries) {
        setTimeout(() => {
          this.connect();
        }, this.retryDelay);
      }
    });
    
    db.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      this.isConnected = true;
      this.retryCount = 0;
    });
    
    db.on('close', () => {
      console.log('🔒 MongoDB connection closed');
      this.isConnected = false;
    });
    
    // Handle application termination
    process.on('SIGINT', () => {
      this.disconnect();
    });
    
    process.on('SIGTERM', () => {
      this.disconnect();
    });
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
      }
      
      if (this.mongoMemoryServer) {
        await this.mongoMemoryServer.stop();
        console.log('🛑 In-memory MongoDB server stopped');
      }
      
      this.isConnected = false;
      this.connection = null;
      
    } catch (error) {
      console.error('❌ Error disconnecting from MongoDB:', error.message);
    }
  }

  /**
   * Check if database is connected
   */
  isHealthy() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  /**
   * Get database health status
   */
  getHealthStatus() {
    const readyState = mongoose.connection.readyState;
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    return {
      isHealthy: this.isHealthy(),
      state: states[readyState] || 'unknown',
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections),
      uptime: process.uptime()
    };
  }

  /**
   * Setup database indexes for optimal performance
   */
  async setupIndexes() {
    try {
      console.log('🔍 Setting up database indexes...');
      
      // User indexes
      await mongoose.connection.collection('users').createIndex({ email: 1 }, { unique: true });
      await mongoose.connection.collection('users').createIndex({ familyId: 1 });
      await mongoose.connection.collection('users').createIndex({ role: 1 });
      
      // Activity indexes
      await mongoose.connection.collection('activities').createIndex({ category: 1 });
      await mongoose.connection.collection('activities').createIndex({ 'ageRange.min': 1, 'ageRange.max': 1 });
      await mongoose.connection.collection('activities').createIndex({ difficulty: 1 });
      await mongoose.connection.collection('activities').createIndex({ createdAt: -1 });
      
      // Progress indexes
      await mongoose.connection.collection('progresses').createIndex({ childId: 1, activityId: 1 });
      await mongoose.connection.collection('progresses').createIndex({ childId: 1, updatedAt: -1 });
      await mongoose.connection.collection('progresses').createIndex({ status: 1 });
      
      // Family indexes
      await mongoose.connection.collection('families').createIndex({ createdBy: 1 });
      
      console.log('✅ Database indexes created successfully');
      
    } catch (error) {
      console.error('❌ Error creating database indexes:', error.message);
    }
  }

  /**
   * Clean up old data (for maintenance)
   */
  async cleanup() {
    try {
      console.log('🧹 Starting database cleanup...');
      
      // Remove old progress records (older than 1 year)
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      const result = await mongoose.connection.collection('progresses')
        .deleteMany({ 
          updatedAt: { $lt: oneYearAgo },
          status: { $in: ['abandoned', 'completed'] }
        });
      
      console.log(`🗑️ Cleaned up ${result.deletedCount} old progress records`);
      
    } catch (error) {
      console.error('❌ Error during database cleanup:', error.message);
    }
  }
}

// Create singleton instance
const databaseConfig = new DatabaseConfig();

// Export both the class and instance
module.exports = {
  DatabaseConfig,
  database: databaseConfig,
  connect: () => databaseConfig.connect(),
  disconnect: () => databaseConfig.disconnect(),
  isHealthy: () => databaseConfig.isHealthy(),
  getHealthStatus: () => databaseConfig.getHealthStatus(),
  setupIndexes: () => databaseConfig.setupIndexes(),
  cleanup: () => databaseConfig.cleanup()
};