const express = require('express');
const {
  getUsersWithJamKerja,
  getAvailableJamKerja,
  assignJamKerjaToUser,
  assignJamKerjaBulk,
  removeJamKerjaFromUser,
  getUserJamKerja
} = require('../controllers/userJamKerjaController');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin'));

// Routes
router.get('/users', getUsersWithJamKerja);
router.get('/available', getAvailableJamKerja);
router.get('/user/:user_id', getUserJamKerja);
router.post('/assign', assignJamKerjaToUser);
router.post('/assign-bulk', assignJamKerjaBulk);
router.post('/remove', removeJamKerjaFromUser);

module.exports = router;