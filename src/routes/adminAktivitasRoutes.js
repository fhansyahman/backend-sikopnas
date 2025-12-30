// routes/adminAktivitas.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  getAllAktivitasAdmin,
  getAktivitasDetailAdmin,
  createAktivitasAdmin,
  updateAktivitasAdmin,
  deleteAktivitasAdmin,
  bulkDeleteAktivitas,
  getAktivitasStatsAdmin,
  exportAktivitas
} = require('../controllers/adminAktivitasController');

// Apply authentication and authorization middleware
router.use(authenticate);
// router.use(authorize(['admin'])); // Uncomment jika perlu authorization khusus admin

// Admin routes
router.get('/', getAllAktivitasAdmin);
router.get('/stats', getAktivitasStatsAdmin);
router.get('/export', exportAktivitas);
router.get('/:id', getAktivitasDetailAdmin);
router.post('/', createAktivitasAdmin);
router.put('/:id', updateAktivitasAdmin);
router.delete('/:id', deleteAktivitasAdmin);
router.delete('/bulk/delete', bulkDeleteAktivitas);

module.exports = router;