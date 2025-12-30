const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    console.log('🔐 === AUTH MIDDLEWARE START ===');
    console.log('URL:', req.originalUrl);
    console.log('Method:', req.method);
    console.log('Headers:', {
      authorization: req.headers.authorization ? 'PRESENT' : 'MISSING',
      origin: req.headers.origin,
      host: req.headers.host
    });

    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    console.log('Token extracted:', token ? `YES (length: ${token.length})` : 'NO');
    
    if (!token) {
      console.log('🚫 No token provided');
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    console.log('🔍 Verifying token...');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ Token decoded - User ID:', decoded.userId);
    
    console.log('🔍 Checking user in database...');
    const [users] = await pool.execute(
      `SELECT id, nama, username, roles, is_active, jabatan, foto, 
              wilayah_penugasan, telegram_id, created_at
       FROM users WHERE id = ? AND is_active = 1`,
      [decoded.userId]
    );

    console.log('📊 Database result:', users.length > 0 ? 'USER FOUND' : 'USER NOT FOUND');

    if (users.length === 0) {
      console.log('🚫 User not found or inactive');
      return res.status(401).json({ 
        success: false, 
        message: 'User not found or inactive.' 
      });
    }

    req.user = users[0];
    console.log('✅ Authentication successful - User:', users[0].username);
    console.log('🔐 === AUTH MIDDLEWARE END ===');
    next();
  } catch (error) {
    console.error('❌ Auth error:', error);
    
    if (error.name === 'TokenExpiredError') {
      console.log('🚫 Token expired');
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired. Please login again.' 
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      console.log('🚫 Invalid token format');
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token format.' 
      });
    }
    
    console.log('🚫 Generic token error');
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    console.log('🔐 Authorization check - User role:', req.user.roles);
    console.log('🔐 Required roles:', roles);
    
    if (!roles.includes(req.user.roles)) {
      console.log('🚫 Insufficient permissions');
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Insufficient permissions.' 
      });
    }
    
    console.log('✅ Authorization granted');
    next();
  };
};

module.exports = { authenticate, authorize };