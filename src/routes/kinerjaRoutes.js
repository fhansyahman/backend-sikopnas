const express = require('express');
const {
  createKinerja,
  getKinerjaUser,
  getKinerjaById,
  updateKinerja,
  deleteKinerja,
  getAllKinerja,
  getKinerjaStatistik
} = require('../controllers/kinerjaController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk user
router.post('/', authenticate, createKinerja);
router.get('/my', authenticate, getKinerjaUser);
router.get('/:id', authenticate, getKinerjaById);
router.put('/:id', authenticate, updateKinerja);
router.delete('/:id', authenticate, deleteKinerja);

// Routes untuk admin
router.get('/admin/all', authenticate, authorize('admin'), getAllKinerja);
router.get('/admin/statistik', authenticate, authorize('admin'), getKinerjaStatistik);

module.exports = router;