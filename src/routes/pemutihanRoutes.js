// routes/pemutihan.js
const express = require('express');
const { 
  getDataForPemutihan,
  prosesPemutihan,
  batalkanPemutihan,
  getRiwayatPemutihan
} = require('../controllers/pemutihanController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Routes untuk pemutihan
router.get('/data', authenticate, authorize('admin'), getDataForPemutihan);
router.post('/proses', authenticate, authorize('admin'), prosesPemutihan);
router.post('/batal', authenticate, authorize('admin'), batalkanPemutihan);
router.get('/riwayat', authenticate, authorize('admin'), getRiwayatPemutihan);

module.exports = router;