const cron = require('node-cron');
const { DateTime } = require('luxon');
const { pool } = require('./database');
const { generatePresensiHarian } = require('../controllers/presensiController');

console.log('⏰ Initializing Cron Jobs...');

// ==================== JOB 1: GENERATE PRESENSI HARIAN JAM 23:00 ====================
cron.schedule('0 23 * * *', async () => {
  const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
  console.log(`\n🔄 [CRON JOB 1] Running auto-presensi generation for ${today} at 23:00...`);
  
  try {
    // Log start
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_START', `Auto-generate presensi started for ${today}`]
    );

    const result = await generatePresensiHarian();
    
    // Log success
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_SUCCESS', `Auto-generate presensi completed: ${result.generated_count} generated, ${result.izin_count} izin, ${result.skipped_count} skipped`]
    );

    console.log(`✅ [CRON JOB 1] Success: ${result.generated_count} generated, ${result.izin_count} izin, ${result.skipped_count} skipped`);
    
  } catch (error) {
    console.error('❌ [CRON JOB 1] Error:', error);
    
    // Log error
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_ERROR', `Auto-generate presensi failed: ${error.message}`]
    );
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'auto_presensi_sore'
});

// ==================== JOB 2: GENERATE PRESENSI BACKUP JAM 08:00 ====================
cron.schedule('0 8 * * *', async () => {
  const yesterday = DateTime.now().setZone('Asia/Jakarta').minus({ days: 1 }).toISODate();
  console.log(`\n🔄 [CRON JOB 2] Running backup presensi generation for ${yesterday} at 08:00...`);
  
  try {
    // Cek apakah sudah ada generate untuk hari sebelumnya
    const [existingLog] = await pool.execute(
      `SELECT * FROM system_log 
       WHERE event_type IN ('CRON_SUCCESS', 'AUTO_GENERATE_PRESENSI') 
       AND description LIKE ? 
       AND DATE(created_at) = ?`,
      [`%${yesterday}%`, DateTime.now().setZone('Asia/Jakarta').toISODate()]
    );

    if (existingLog.length > 0) {
      console.log(`⏭️ [CRON JOB 2] Skip: Already generated for ${yesterday}`);
      return;
    }

    // Log start
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_BACKUP_START', `Backup generate presensi started for ${yesterday}`]
    );

    const result = await generatePresensiHarian(yesterday);
    
    // Log success
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_BACKUP_SUCCESS', `Backup generate presensi completed: ${result.generated_count} generated, ${result.izin_count} izin, ${result.skipped_count} skipped`]
    );

    console.log(`✅ [CRON JOB 2] Backup Success: ${result.generated_count} generated, ${result.izin_count} izin, ${result.skipped_count} skipped`);
    
  } catch (error) {
    console.error('❌ [CRON JOB 2] Backup Error:', error);
    
    // Log error
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_BACKUP_ERROR', `Backup generate presensi failed for ${yesterday}: ${error.message}`]
    );
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'backup_presensi_pagi'
});

// ==================== JOB 3: CLEANUP PRESENSI TANPA KETERANGAN UNTUK HARI LIBUR ====================
cron.schedule('0 2 * * *', async () => {
  console.log(`\n🧹 [CRON JOB 3] Running cleanup presensi for non-working days...`);
  
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const sevenDaysAgo = DateTime.now().setZone('Asia/Jakarta').minus({ days: 7 }).toISODate();

    // Cari presensi dengan status "Tanpa Keterangan" yang seharusnya hari libur
    const [presensiToCleanup] = await pool.execute(
      `SELECT p.id, p.tanggal, p.user_id, u.nama 
       FROM presensi p
       JOIN users u ON p.user_id = u.id
       WHERE p.tanggal BETWEEN ? AND ?
       AND p.status_masuk = 'Tanpa Keterangan'
       AND p.is_system_generated = 1
       AND p.izin_id IS NULL
       AND p.jam_masuk IS NULL`,
      [sevenDaysAgo, today]
    );

    let deletedCount = 0;

    for (const presensi of presensiToCleanup) {
      // Cek apakah tanggal tersebut memang hari libur
      const hariKerjaInfo = await require('../utils/hariKerja').checkHariKerja(presensi.tanggal);
      
      if (!hariKerjaInfo.is_hari_kerja) {
        // Hapus presensi karena seharusnya tidak ada generate untuk hari libur
        await pool.execute(
          'DELETE FROM presensi WHERE id = ?',
          [presensi.id]
        );
        deletedCount++;
        console.log(`🧹 Deleted presensi for ${presensi.nama} on ${presensi.tanggal} (${hariKerjaInfo.keterangan})`);
      }
    }

    // Log cleanup
    if (deletedCount > 0) {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['CRON_CLEANUP', `Cleanup completed: ${deletedCount} presensi deleted for non-working days`]
      );
    }

    console.log(`✅ [CRON JOB 3] Cleanup completed: ${deletedCount} presensi deleted`);
    
  } catch (error) {
    console.error('❌ [CRON JOB 3] Cleanup Error:', error);
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'cleanup_presensi'
});

// ==================== JOB 4: UPDATE STATUS BELUM PULANG ====================
cron.schedule('0 22 * * *', async () => {
  console.log(`\n🔄 [CRON JOB 4] Updating status belum pulang...`);
  
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    
    // Update status pulang untuk yang belum pulang
    const [result] = await pool.execute(
      `UPDATE presensi 
       SET status_pulang = 'Tidak Pulang',
           keterangan = COALESCE(CONCAT(keterangan, ' | Auto-updated: Tidak melakukan presensi pulang'), 'Auto-updated: Tidak melakukan presensi pulang'),
           updated_at = NOW()
       WHERE tanggal = ? 
       AND jam_pulang IS NULL 
       AND status_pulang = 'Belum Pulang'
       AND izin_id IS NULL`,
      [today]
    );

    if (result.affectedRows > 0) {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['CRON_UPDATE_STATUS', `Updated ${result.affectedRows} presensi dengan status "Tidak Pulang"`]
      );
      
      console.log(`✅ [CRON JOB 4] Updated ${result.affectedRows} presensi dengan status "Tidak Pulang"`);
    } else {
      console.log(`⏭️ [CRON JOB 4] No presensi need status update`);
    }
    
  } catch (error) {
    console.error('❌ [CRON JOB 4] Update Status Error:', error);
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'update_status_pulang'
});

// ==================== JOB 5: WEEKLY REPORT GENERATION ====================
cron.schedule('0 9 * * 1', async () => {
  console.log(`\n📊 [CRON JOB 5] Generating weekly report...`);
  
  try {
    const lastWeekStart = DateTime.now().setZone('Asia/Jakarta').minus({ weeks: 1 }).startOf('week').toISODate();
    const lastWeekEnd = DateTime.now().setZone('Asia/Jakarta').minus({ weeks: 1 }).endOf('week').toISODate();

    // Generate rekap mingguan
    const [weeklyReport] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT u.id) as total_pegawai,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL AND p.izin_id IS NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as total_izin,
        SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_alpha,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal BETWEEN ? AND ?
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`,
      [lastWeekStart, lastWeekEnd]
    );

    // Simpan weekly report
    await pool.execute(
      `INSERT INTO weekly_reports 
       (periode_start, periode_end, total_pegawai, total_hadir, total_izin, total_alpha, total_lembur, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        lastWeekStart,
        lastWeekEnd,
        weeklyReport[0].total_pegawai,
        weeklyReport[0].total_hadir,
        weeklyReport[0].total_izin,
        weeklyReport[0].total_alpha,
        weeklyReport[0].total_lembur
      ]
    );

    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_WEEKLY_REPORT', `Weekly report generated for ${lastWeekStart} to ${lastWeekEnd}`]
    );

    console.log(`✅ [CRON JOB 5] Weekly report generated for ${lastWeekStart} to ${lastWeekEnd}`);
    
  } catch (error) {
    console.error('❌ [CRON JOB 5] Weekly Report Error:', error);
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'weekly_report'
});

// ==================== JOB 6: MONTHLY DATA CLEANUP ====================
cron.schedule('0 3 1 * *', async () => {
  console.log(`\n🗑️ [CRON JOB 6] Running monthly data cleanup...`);
  
  try {
    const threeMonthsAgo = DateTime.now().setZone('Asia/Jakarta').minus({ months: 3 }).toISODate();
    
    // Backup log lama ke tabel archive (opsional)
    const [oldLogs] = await pool.execute(
      'SELECT COUNT(*) as count FROM system_log WHERE created_at < ?',
      [threeMonthsAgo]
    );

    // Hapus log yang lebih dari 3 bulan
    const [deleteResult] = await pool.execute(
      'DELETE FROM system_log WHERE created_at < ?',
      [threeMonthsAgo]
    );

    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['CRON_CLEANUP', `Monthly cleanup: ${deleteResult.affectedRows} old logs deleted`]
    );

    console.log(`✅ [CRON JOB 6] Monthly cleanup completed: ${deleteResult.affectedRows} logs deleted`);
    
  } catch (error) {
    console.error('❌ [CRON JOB 6] Monthly Cleanup Error:', error);
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'monthly_cleanup'
});

// ==================== JOB 7: CHECK IZIN EXPIRY (OPTIONAL) ====================
cron.schedule('0 7 * * *', async () => {
  console.log(`\n📋 [CRON JOB 7] Checking izin expiry...`);
  
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    
    // Cari izin yang sudah melewati tanggal selesai tapi status masih "Pending"
    const [expiredIzin] = await pool.execute(
      `UPDATE izin 
       SET status = 'Kadaluarsa',
           keterangan = COALESCE(CONCAT(keterangan, ' | Auto-expired: Melewati batas waktu'), 'Auto-expired: Melewati batas waktu')
       WHERE status = 'Pending' 
       AND tanggal_selesai < ?`,
      [today]
    );

    if (expiredIzin.affectedRows > 0) {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['CRON_IZIN_EXPIRY', `Updated ${expiredIzin.affectedRows} izin status to "Kadaluarsa"`]
      );
      
      console.log(`✅ [CRON JOB 7] Updated ${expiredIzin.affectedRows} izin status to "Kadaluarsa"`);
    } else {
      console.log(`⏭️ [CRON JOB 7] No expired izin found`);
    }
    
  } catch (error) {
    console.error('❌ [CRON JOB 7] Izin Expiry Check Error:', error);
  }
}, {
  timezone: "Asia/Jakarta",
  scheduled: true,
  name: 'check_izin_expiry'
});

// ==================== MANUAL TEST FUNCTION ====================
const manualTest = async (jobName = 'all') => {
  console.log(`\n🧪 MANUAL TEST: ${jobName}`);
  
  const testJobs = {
    'generate_today': async () => {
      console.log('Testing Job 1: Generate Today');
      await require('../controllers/presensiController').generatePresensiHarian();
    },
    
    'generate_yesterday': async () => {
      console.log('Testing Job 2: Generate Yesterday');
      const yesterday = DateTime.now().setZone('Asia/Jakarta').minus({ days: 1 }).toISODate();
      await require('../controllers/presensiController').generatePresensiHarian(yesterday);
    },
    
    'cleanup': async () => {
      console.log('Testing Job 3: Cleanup');
      // Trigger cleanup job manually
      const job = cron.getTasks().get('cleanup_presensi');
      if (job) job.now();
    },
    
    'update_status': async () => {
      console.log('Testing Job 4: Update Status');
      const job = cron.getTasks().get('update_status_pulang');
      if (job) job.now();
    }
  };

  try {
    if (jobName === 'all') {
      for (const [name, job] of Object.entries(testJobs)) {
        await job();
      }
    } else if (testJobs[jobName]) {
      await testJobs[jobName]();
    } else {
      console.log(`❌ Unknown job: ${jobName}`);
      console.log(`Available jobs: ${Object.keys(testJobs).join(', ')}`);
    }
  } catch (error) {
    console.error(`❌ Manual test error:`, error);
  }
};

// ==================== CRON STATUS CHECK ====================
const getCronStatus = () => {
  const tasks = cron.getTasks();
  console.log('\n📋 CRON JOBS STATUS:');
  
  if (tasks.size === 0) {
    console.log('❌ No cron jobs running');
    return;
  }

  tasks.forEach((task, name) => {
    console.log(`✅ ${name}: ${task.getStatus()}`);
  });
};

// ==================== EXPORT FUNCTIONS ====================
module.exports = {
  manualTest,
  getCronStatus,
  
  // Individual job controllers untuk manual execution
  runGenerateToday: () => {
    const job = cron.getTasks().get('auto_presensi_sore');
    if (job) job.now();
  },
  
  runBackupGenerate: () => {
    const job = cron.getTasks().get('backup_presensi_pagi');
    if (job) job.now();
  },
  
  runCleanup: () => {
    const job = cron.getTasks().get('cleanup_presensi');
    if (job) job.now();
  }
};

// ==================== INITIALIZATION ====================
console.log('✅ All cron jobs scheduled:');
console.log('   🕰️  Job 1: Auto Generate Presensi - 23:00 daily');
console.log('   🕰️  Job 2: Backup Generate - 08:00 daily');  
console.log('   🕰️  Job 3: Cleanup Presensi - 02:00 daily');
console.log('   🕰️  Job 4: Update Status Pulang - 22:00 daily');
console.log('   🕰️  Job 5: Weekly Report - 09:00 every Monday');
console.log('   🕰️  Job 6: Monthly Cleanup - 03:00 on 1st of month');
console.log('   🕰️  Job 7: Izin Expiry Check - 07:00 daily');

// Test run untuk development
if (process.env.NODE_ENV === 'development') {
  console.log('\n🔧 Development mode: Ready for manual testing');
  console.log('   Use: manualTest("generate_today")');
  console.log('   Use: manualTest("all")');
  console.log('   Use: getCronStatus()');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down cron jobs...');
  const tasks = cron.getTasks();
  tasks.forEach((task, name) => {
    console.log(`   Stopping: ${name}`);
    task.stop();
  });
  process.exit(0);
});