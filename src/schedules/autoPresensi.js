const cron = require('node-cron');
const { generatePresensiHarian } = require('../controllers/presensiController');
const { DateTime } = require('luxon');
const { pool } = require('../config/database');

console.log('⏰ Scheduler presensi otomatis dijalankan...');

/**
 * Generate presensi untuk hari ini
 */
const generateHariIni = async () => {
  try {
    console.log('🔄 Running auto-presensi generation for today...');
    const result = await generatePresensiHarian();
    console.log('✅ Auto-presensi result:', result);
    
    // Log ke database
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CRON_AUTO_GENERATE', `Cron job generate presensi: ${result.generated_count} generated (${result.izin_count} izin), ${result.skipped_count} skipped`, 1]
    );
    
    return result;
  } catch (error) {
    console.error('❌ Auto-presensi cron job error:', error);
    
    // Log error ke database
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CRON_ERROR', `Cron job error: ${error.message}`, 1]
    );
    
    throw error;
  }
};

/**
 * Generate presensi untuk hari sebelumnya (backup)
 */
const generateKemarin = async () => {
  try {
    console.log('🔄 Running auto-presensi generation for previous day...');
    const yesterday = DateTime.now().setZone('Asia/Jakarta').minus({ days: 1 }).toISODate();
    const result = await generatePresensiHarian(yesterday);
    console.log('✅ Auto-presensi yesterday result:', result);
    
    // Log ke database
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CRON_BACKUP_GENERATE', `Cron job backup generate presensi: ${result.generated_count} generated (${result.izin_count} izin) untuk ${yesterday}`, 1]
    );
    
    return result;
  } catch (error) {
    console.error('❌ Auto-presensi backup cron job error:', error);
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CRON_ERROR', `Cron job backup error: ${error.message}`, 1]
    );
    
    throw error;
  }
};

/**
 * Generate untuk hari Senin minggu sebelumnya (untuk weekend)
 */
const generateWeekendBackup = async () => {
  try {
    console.log('🔄 Running weekend backup generation...');
    const now = DateTime.now().setZone('Asia/Jakarta');
    
    // Jika hari Senin, generate untuk Sabtu dan Minggu
    if (now.weekday === 1) { // 1 = Senin
      const sabtu = now.minus({ days: 2 }).toISODate();
      const minggu = now.minus({ days: 1 }).toISODate();
      
      console.log(`📅 Generating backup untuk weekend: ${sabtu} dan ${minggu}`);
      
      const resultSabtu = await generatePresensiHarian(sabtu);
      const resultMinggu = await generatePresensiHarian(minggu);
      
      console.log('✅ Weekend backup result:', { sabtu: resultSabtu, minggu: resultMinggu });
      
      await pool.execute(
        'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
        ['CRON_WEEKEND_BACKUP', `Weekend backup: Sabtu ${resultSabtu.generated_count} generated, Minggu ${resultMinggu.generated_count} generated`, 1]
      );
      
      return { sabtu: resultSabtu, minggu: resultMinggu };
    } else {
      console.log('⏭️  Bukan hari Senin, skip weekend backup');
      return { message: 'Bukan hari Senin, skip weekend backup' };
    }
  } catch (error) {
    console.error('❌ Weekend backup cron job error:', error);
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CRON_ERROR', `Weekend backup error: ${error.message}`, 1]
    );
    
    throw error;
  }
};

/**
 * Cleanup log lama (menjaga database tidak penuh)
 */
const cleanupOldLogs = async () => {
  try {
    console.log('🧹 Running cleanup old logs...');
    const threeMonthsAgo = DateTime.now().setZone('Asia/Jakarta').minus({ months: 3 }).toISODate();
    
    const [result] = await pool.execute(
      'DELETE FROM system_log WHERE created_at < ? AND event_type LIKE "CRON_%"',
      [threeMonthsAgo]
    );
    
    console.log(`✅ Cleanup completed: ${result.affectedRows} logs deleted`);
    
    if (result.affectedRows > 0) {
      await pool.execute(
        'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
        ['CRON_CLEANUP', `Cleanup old logs: ${result.affectedRows} logs deleted`, 1]
      );
    }
    
    return result;
  } catch (error) {
    console.error('❌ Cleanup cron job error:', error);
    throw error;
  }
};

// ==================== CRON SCHEDULES ====================

// 1. Generate presensi hari ini - setiap hari jam 23:00
cron.schedule('0 23 * * *', generateHariIni, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'generate_hari_ini'
});

// 2. Backup generate untuk hari sebelumnya - setiap hari jam 08:00
cron.schedule('0 8 * * *', generateKemarin, {
  timezone: "Asia/Jakarta", 
  scheduled: true,
  name: 'generate_kemarin'
});

// 3. Weekend backup - setiap Senin jam 09:00
cron.schedule('0 9 * * 1', generateWeekendBackup, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'weekend_backup'
});

// 4. Cleanup logs - setiap bulan pertama jam 02:00
cron.schedule('0 2 1 * *', cleanupOldLogs, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'cleanup_logs'
});

// ==================== MANUAL TRIGGER FUNCTIONS ====================

/**
 * Manual trigger untuk testing
 */
const manualTriggerToday = async () => {
  console.log('🧪 Manual trigger for today...');
  return await generateHariIni();
};

const manualTriggerYesterday = async () => {
  console.log('🧪 Manual trigger for yesterday...');
  return await generateKemarin();
};

const manualTriggerDate = async (date) => {
  try {
    if (!DateTime.fromISO(date).isValid) {
      throw new Error('Format tanggal tidak valid. Gunakan YYYY-MM-DD');
    }
    
    console.log(`🧪 Manual trigger for date: ${date}`);
    const result = await generatePresensiHarian(date);
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['MANUAL_TRIGGER', `Manual generate untuk ${date}: ${result.generated_count} generated`, 1]
    );
    
    return result;
  } catch (error) {
    console.error('❌ Manual trigger error:', error);
    throw error;
  }
};

// ==================== STATUS & HEALTH CHECK ====================

const getCronStatus = async () => {
  try {
    const [recentLogs] = await pool.execute(
      `SELECT event_type, description, created_at 
       FROM system_log 
       WHERE event_type LIKE 'CRON_%' OR event_type = 'MANUAL_TRIGGER'
       ORDER BY created_at DESC 
       LIMIT 10`
    );

    const [todayStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_presensi_hari_ini,
        SUM(CASE WHEN is_system_generated = 1 THEN 1 ELSE 0 END) as system_generated_today,
        SUM(CASE WHEN izin_id IS NOT NULL THEN 1 ELSE 0 END) as dengan_izin_today
       FROM presensi 
       WHERE tanggal = ?`,
      [DateTime.now().setZone('Asia/Jakarta').toISODate()]
    );

    const [userStats] = await pool.execute(
      `SELECT COUNT(*) as total_users FROM users WHERE is_active = 1 AND roles = 'pegawai'`
    );

    return {
      status: 'active',
      server_time: DateTime.now().setZone('Asia/Jakarta').toISO(),
      schedules: [
        { name: 'generate_hari_ini', schedule: '0 23 * * *', description: 'Generate presensi hari ini jam 23:00' },
        { name: 'generate_kemarin', schedule: '0 8 * * *', description: 'Backup generate hari sebelumnya jam 08:00' },
        { name: 'weekend_backup', schedule: '0 9 * * 1', description: 'Weekend backup setiap Senin jam 09:00' },
        { name: 'cleanup_logs', schedule: '0 2 1 * *', description: 'Cleanup logs setiap tanggal 1 jam 02:00' }
      ],
      stats: {
        total_users: userStats[0]?.total_users || 0,
        today_presensi: todayStats[0] || {}
      },
      recent_activities: recentLogs
    };
  } catch (error) {
    console.error('Get cron status error:', error);
    return { status: 'error', error: error.message };
  }
};

// ==================== EXPORT MODULES ====================

module.exports = {
  // Cron jobs
  // generateHariIni,
  // generateKemarin,
  generateWeekendBackup,
  cleanupOldLogs,
  
  // Manual triggers
  manualTriggerToday,
  manualTriggerYesterday,
  manualTriggerDate,
  
  // Status & monitoring
  getCronStatus,
  
  // Initialize function
  initialize: () => {
    console.log('✅ All cron jobs initialized successfully');
    console.log('📅 Scheduled jobs:');
    console.log('   - Generate hari ini: 23:00 setiap hari');
    console.log('   - Backup kemarin: 08:00 setiap hari'); 
    console.log('   - Weekend backup: 09:00 setiap Senin');
    console.log('   - Cleanup logs: 02:00 setiap tanggal 1');
  }
};

// ==================== RUN MANUAL TEST IF EXECUTED DIRECTLY ====================

if (require.main === module) {
  console.log('🚀 Running manual test...');
  
  // Test manual trigger untuk hari ini
  manualTriggerToday()
    .then(result => {
      console.log('✅ Manual test completed:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Manual test failed:', error);
      process.exit(1);
    });
}