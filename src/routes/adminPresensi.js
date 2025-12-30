const express = require('express');
const { 
  getAllPresensi,
  getPresensiById,
  updatePresensi,
  deletePresensi,
  generatePresensiHariIni,
  getStatistikPresensi
} = require('../controllers/adminPresensiController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);
router.use(authorize('admin'));

router.get('/', getAllPresensi);
router.get('/statistik', getStatistikPresensi);
router.get('/:id', getPresensiById);
router.put('/:id', updatePresensi);
router.delete('/:id', deletePresensi);
router.post('/generate-hari-ini', generatePresensiHariIni);

module.exports = router;