const express = require('express');
const { 
  getAllIzin,
  getIzinById,
  getMyIzin,
  createIzin,
  updateIzinStatus,
  deleteIzin,
  createIzinByAdmin // Tambahkan ini

} = require('../controllers/izinController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk pegawai
router.get('/saya', authenticate, getMyIzin);
router.post('/ajukan', authenticate, createIzin);
router.delete('/:id', authenticate, deleteIzin);

// Admin routes
router.get('/all', authenticate, authorize('admin'), getAllIzin);
router.get('/:id', authenticate, authorize('admin'), getIzinById);
router.patch('/:id/status', authenticate, authorize('admin'), updateIzinStatus);
router.post('/admin-create', authenticate, authorize('admin'), createIzinByAdmin);
module.exports = router;