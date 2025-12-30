// routes/pegawaiAktivitasRoutes.js
const express = require('express');
const router = express.Router();
const {
  getAllAktivitasPegawai,
  getAktivitasDetailPegawai,
  createAktivitasPegawai,
  updateAktivitasPegawai,
  deleteAktivitasPegawai,
  getAktivitasStatsPegawai,
  getProfilePegawai,
  updateProfilePegawai
} = require('../controllers/pegawaiAktivitasController');
const { authenticate, authorize } = require('../middleware/auth');

// Apply authentication to all routes
router.use(authenticate);

// Profile routes
router.get('/profile', getProfilePegawai);
router.put('/profile', updateProfilePegawai);

// Aktivitas routes
router.get('/aktivitas', getAllAktivitasPegawai);
router.get('/aktivitas/stats', getAktivitasStatsPegawai);
router.get('/aktivitas/:id', getAktivitasDetailPegawai);
router.post('/aktivitas', createAktivitasPegawai);
router.put('/aktivitas/:id', updateAktivitasPegawai);
router.delete('/aktivitas/:id', deleteAktivitasPegawai);

module.exports = router;