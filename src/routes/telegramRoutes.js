// routes/telegramRoutes.js
const express = require('express');
const router = express.Router();
const {
  handleTelegramWebhook,
  getTelegramStatus,
  disconnectTelegram
} = require('../controllers/telegramController');
const { authenticate } = require('../middleware/auth');

// Webhook route (tanpa authentication)
router.post('/webhook', handleTelegramWebhook);

// User routes (dengan authentication)
router.get('/status', authenticate, getTelegramStatus);
router.post('/disconnect', authenticate, disconnectTelegram);

module.exports = router;