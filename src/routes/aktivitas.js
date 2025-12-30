const express = require('express');
const { 
  tambahAktivitas, 
  getAktivitasSaya
} = require('../controllers/adminAktivitasController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/tambah', tambahAktivitas);
router.get('/saya', getAktivitasSaya);

module.exports = router;