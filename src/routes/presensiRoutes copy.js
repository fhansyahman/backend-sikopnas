const express = require('express');
const { 
  presensiMasuk,
  presensiPulang,
  getPresensiHariIni,
  getPresensiUser,
  getAllPresensi,
  generatePresensiOtomatis,
  getRekapPresensi,
  // Fungsi baru yang ditambahkan
  generatePresensiManual,
  fixPresensiData,
  getGenerateStats
} = require('../controllers/presensiController');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();

// ==================== ROUTES UNTUK SEMUA USER ====================

// Presensi manual
router.post('/masuk', authenticate, presensiMasuk);
router.post('/pulang', authenticate, presensiPulang);

// Get data presensi
router.get('/hari-ini', authenticate, getPresensiHariIni);
router.get('/user', authenticate, getPresensiUser);

// ==================== ROUTES UNTUK ADMIN SAJA ====================

// Get data
router.get('/all', authenticate, authorize('admin'), getAllPresensi);
router.get('/rekap', authenticate, authorize('admin'), getRekapPresensi);

// Generate presensi
router.post('/generate', authenticate, authorize('admin'), generatePresensiOtomatis);
router.post('/generate-manual', authenticate, authorize('admin'), generatePresensiManual);

// Maintenance & stats
router.post('/fix-data', authenticate, authorize('admin'), fixPresensiData);
router.get('/generate-stats', authenticate, authorize('admin'), getGenerateStats);

module.exports = router;