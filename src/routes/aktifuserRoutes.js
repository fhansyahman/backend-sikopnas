// routes/aktifuser.js
const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const {
  getAllUsers,
  getUserById,
  deactivateUser,
  activateUser,
  updateUserStatus,
  getActiveUsers,
  getInactiveUsers
} = require('../controllers/aktifuser');

// Apply authentication middleware to all routes
router.use(authenticate);

// Routes
router.get('/all', getAllUsers);
router.get('/active', getActiveUsers);
router.get('/inactive', getInactiveUsers);
router.get('/:id', getUserById);
router.patch('/:id/deactivate', deactivateUser);
router.patch('/:id/activate', activateUser);
router.patch('/:id/status', updateUserStatus);

module.exports = router;