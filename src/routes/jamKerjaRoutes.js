const express = require('express');
const { 
  getAllJamKerja,
  getJamKerjaById,
  getJamKerjaAktif,
  createJamKerja,
  updateJamKerja,
  deleteJamKerja, // ✅ PERBAIKI: setJamKerjaAktif bukan setJamKerjaAktif
  assignJamKerjaToUser
} = require('../controllers/jamKerjaController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes public - bisa diakses semua user yang login
router.get('/aktif', authenticate, getJamKerjaAktif);

// Routes admin only
router.get('/', authenticate, authorize('admin'), getAllJamKerja);
router.get('/:id', authenticate, authorize('admin'), getJamKerjaById);
router.post('/', authenticate, authorize('admin'), createJamKerja);
router.put('/:id', authenticate, authorize('admin'), updateJamKerja);
router.delete('/:id', authenticate, authorize('admin'), deleteJamKerja);
router.post('/assign', authenticate, authorize('admin'), assignJamKerjaToUser);

module.exports = router;