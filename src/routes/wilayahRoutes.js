const express = require('express');
const {
  getAllWilayah,
  getWilayahById,
  createWilayah,
  updateWilayah,
  deleteWilayah,
  getUsersByWilayah,
  assignWilayahToUser,
  getWilayahStats,
  getAllPegawai
} = require('../controllers/wilayahController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk wilayah management
router.get('/', authenticate, authorize('admin'), getAllWilayah);
router.get('/userswilayah', authenticate, authorize('admin'), getAllWilayah);
router.get('/stats', authenticate, authorize('admin'), getWilayahStats);
router.get('/pegawai', authenticate, authorize('admin'), getAllPegawai);
router.get('/:id', authenticate, authorize('admin'), getWilayahById);
router.post('/', authenticate, authorize('admin'), createWilayah);
router.put('/:id', authenticate, authorize('admin'), updateWilayah);
router.delete('/:id', authenticate, authorize('admin'), deleteWilayah);

// Routes untuk user wilayah assignment
router.get('/:wilayah_id/users', authenticate, authorize('admin'), getUsersByWilayah);
router.put('/user/:user_id/assign', authenticate, authorize('admin'), assignWilayahToUser);

module.exports = router;