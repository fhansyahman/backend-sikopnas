const express = require('express');
const router = express.Router();
const cronManager = require('../schedules/cronManager');
const { getCronStatus, manualTriggerToday, manualTriggerDate } = require('../schedules/autoPresensi');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * @route GET /api/cron/status
 * @desc Get status cron jobs
 * @access Private (Admin only)
 */
router.get('/status', authenticate, authorize('admin'), async (req, res) => {
  try {
    const status = await getCronStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get cron status error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mendapatkan status cron'
    });
  }
});

/**
 * @route POST /api/cron/trigger/today
 * @desc Manual trigger generate untuk hari ini
 * @access Private (Admin only)
 */
router.post('/trigger/today', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await manualTriggerToday();
    res.json({
      success: true,
      message: 'Berhasil trigger generate untuk hari ini',
      data: result
    });
  } catch (error) {
    console.error('Trigger today error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal trigger generate hari ini'
    });
  }
});

/**
 * @route POST /api/cron/trigger/date
 * @desc Manual trigger generate untuk tanggal tertentu
 * @access Private (Admin only)
 */
router.post('/trigger/date', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { tanggal } = req.body;
    
    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal wajib diisi'
      });
    }

    const result = await manualTriggerDate(tanggal);
    res.json({
      success: true,
      message: `Berhasil trigger generate untuk tanggal ${tanggal}`,
      data: result
    });
  } catch (error) {
    console.error('Trigger date error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal trigger generate untuk tanggal tersebut'
    });
  }
});

/**
 * @route POST /api/cron/restart
 * @desc Restart semua cron jobs
 * @access Private (Admin only)
 */
router.post('/restart', authenticate, authorize('admin'), (req, res) => {
  try {
    cronManager.restart();
    res.json({
      success: true,
      message: 'Berhasil restart semua cron jobs'
    });
  } catch (error) {
    console.error('Restart cron error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal restart cron jobs'
    });
  }
});

/**
 * @route GET /api/cron/jobs
 * @desc List semua cron jobs
 * @access Private (Admin only)
 */
router.get('/jobs', authenticate, authorize('admin'), (req, res) => {
  try {
    const jobs = cronManager.listJobs();
    res.json({
      success: true,
      data: jobs
    });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mendapatkan list jobs'
    });
  }
});

module.exports = router;