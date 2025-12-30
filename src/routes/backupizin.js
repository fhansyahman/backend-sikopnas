const express = require('express');
const { 
  ajukanIzin, 
  getIzinSaya, 
  getAllIzin, 
  updateStatusIzin 
} = require('../controllers/izinController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/ajukan', ajukanIzin);
router.get('/saya', getIzinSaya);
router.get('/all', authorize('admin', 'atasan'), getAllIzin);
router.patch('/:id/status', authorize('admin', 'atasan'), updateStatusIzin);

module.exports = router;