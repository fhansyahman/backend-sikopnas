const express = require('express');
const {
  getRekapKehadiran,
  getDetailKehadiranUser,
  getRekapHarian
} = require('../controllers/rekapController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk semua user
router.get('/detail-user', authenticate, getDetailKehadiranUser);

// Routes untuk admin
router.get('/kehadiran', authenticate, authorize('admin'), getRekapKehadiran);
router.get('/harian', authenticate, authorize('admin'), getRekapHarian);

module.exports = router;