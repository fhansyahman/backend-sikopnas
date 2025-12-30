const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const { DateTime } = require('luxon');

// IMPORT CRON DI SINI (PENTING!)
const cron = require('node-cron');

// Import controllers untuk setup cron jobs
const { 
  setupPresensiCronJobs, 
  generatePresensiForDate,
  checkAndUpdateIzinPresensi,
  updatePresensiStatusAkhirHari,
  checkHariKerja
} = require('./controllers/presensiController');

const { pool } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const izinRoutes = require('./routes/izinRoutes');
const adminPresensiRoutes = require('./routes/adminPresensi');
const presensiRoutes = require('./routes/presensiRoutes');
const rekapRoutes = require('./routes/rekapRoutes');
const jamKerjaRoutes = require('./routes/jamKerjaRoutes');
const userJamKerjaRoutes = require('./routes/userJamKerjaRoutes');
const kinerjaharianRoutes = require('./routes/kinerjaRoutes');
const ManajemenWilayahRoutes = require('./routes/wilayahRoutes');
const ManajemenHariRoutes = require('./routes/hariRoutes');
const aktifuserRoutes = require('./routes/aktifuserRoutes');
const adminAktivitasRoutes = require('./routes/AdminAktivitasRoutes');
const pemutihanRoutes = require('./routes/pemutihanRoutes');
const pegawaiAktivitasRoutes = require('./routes/pegawaiAktivitasRoutes');

// Import middleware
const { notFoundHandler, errorHandler } = require('./middleware/errorhandler');

const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ 
  limit: '50mb',
  extended: true 
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '50mb',
  parameterLimit: 100000 
}));

// ==================== ROUTES ====================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin/presensi', adminPresensiRoutes);
app.use('/api/izin', izinRoutes);
app.use('/api/presensi', presensiRoutes);
app.use('/api/rekap', rekapRoutes);
app.use('/api/jam-kerja', jamKerjaRoutes);
app.use('/api/user-jam-kerja', userJamKerjaRoutes);
app.use('/api/kinerja', kinerjaharianRoutes);
app.use('/api/wilayah', ManajemenWilayahRoutes);
app.use('/api/hari', ManajemenHariRoutes);
app.use('/api/aktifuser', aktifuserRoutes);
app.use('/api/pemutihan', pemutihanRoutes);
app.use('/api/admin/aktivitas', adminAktivitasRoutes);
app.use('/api/pegawai', pegawaiAktivitasRoutes);

// Static files untuk uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ==================== SYSTEM FUNCTIONS ====================

/**
 * Fungsi untuk mendapatkan status ENUM dari database
 */
const getStatusEnums = async () => {
  try {
    // Ambil definisi ENUM untuk status_masuk
    const [statusMasukRows] = await pool.execute(
      `SHOW COLUMNS FROM presensi LIKE 'status_masuk'`
    );
    
    // Ambil definisi ENUM untuk status_pulang
    const [statusPulangRows] = await pool.execute(
      `SHOW COLUMNS FROM presensi LIKE 'status_pulang'`
    );
    
    let statusMasukEnum = [];
    let statusPulangEnum = [];
    
    // Parse ENUM values untuk status_masuk
    if (statusMasukRows.length > 0) {
      const enumStr = statusMasukRows[0].Type;
      statusMasukEnum = enumStr.replace(/^enum\(|\)$/g, '')
        .split(',')
        .map(val => val.replace(/^'|'$/g, ''));
    }
    
    // Parse ENUM values untuk status_pulang
    if (statusPulangRows.length > 0) {
      const enumStr = statusPulangRows[0].Type;
      statusPulangEnum = enumStr.replace(/^enum\(|\)$/g, '')
        .split(',')
        .map(val => val.replace(/^'|'$/g, ''));
    }
    
    console.log('📋 Status Masuk ENUM:', statusMasukEnum);
    console.log('📋 Status Pulang ENUM:', statusPulangEnum);
    
    return {
      status_masuk: statusMasukEnum,
      status_pulang: statusPulangEnum
    };
  } catch (error) {
    console.error('❌ Error getting ENUM definitions:', error.message);
    return {
      status_masuk: ['Tepat Waktu', 'Terlambat', 'Tanpa Keterangan', 'Izin Sakit', 'Izin Cuti', 'Izin Lainnya', 'Izin'],
      status_pulang: ['Tepat Waktu', 'Cepat Pulang', 'Lembur', 'Belum Pulang', 'Izin Sakit', 'Izin Cuti', 'Izin Lainnya', 'Izin']
    };
  }
};

/**
 * Fungsi untuk memetakan jenis izin ke status ENUM yang valid
 */
const mapIzinToStatus = (jenisIzin) => {
  const izinMap = {
    'sakit': 'Izin Sakit',
    'cuti': 'Izin Cuti',
    'izin': 'Izin',
    'lainnya': 'Izin Lainnya',
    'Sakit': 'Izin Sakit',
    'Cuti': 'Izin Cuti',
    'Izin': 'Izin',
    'Lainnya': 'Izin Lainnya'
  };
  
  // Cek jika ada di mapping
  if (jenisIzin && izinMap[jenisIzin]) {
    return izinMap[jenisIzin];
  }
  
  // Default ke 'Izin' jika tidak dikenali
  return 'Izin';
};

/**
 * Fungsi untuk cek dan generate presensi untuk tanggal tertentu
 */
const generatePresensiForTargetDate = async (targetDate) => {
  try {
    console.log(`\n🔄 Generating presensi for ${targetDate}...`);
    
    // Dapatkan ENUM definitions
    const enumDefs = await getStatusEnums();
    
    // Cek hari kerja
    const hariKerjaInfo = await checkHariKerja(targetDate);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`⏭️ Skip ${targetDate}: ${hariKerjaInfo.keterangan}`);
      return {
        success: true,
        message: `Bukan hari kerja: ${hariKerjaInfo.keterangan}`,
        skipped: true
      };
    }

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY u.nama`
    );

    console.log(`📊 Total active users: ${users.length}`);
    
    let generatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi
        const [existingPresensi] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, targetDate]
        );

        if (existingPresensi.length > 0) {
          skippedCount++;
          console.log(`⏭️ User ${user.id} (${user.nama}) already has presensi for ${targetDate}`);
          continue;
        }

        // Cek apakah user memiliki izin
        const [izin] = await pool.execute(
          `SELECT i.id, i.jenis 
           FROM izin i 
           WHERE i.user_id = ? 
             AND i.status = 'Disetujui'
             AND DATE(?) BETWEEN DATE(i.tanggal_mulai) AND DATE(i.tanggal_selesai)`,
          [user.id, targetDate]
        );

        if (izin.length > 0) {
          // Map jenis izin ke status yang valid
          const statusIzin = mapIzinToStatus(izin[0].jenis);
          
          // Validasi status
          const statusMasukValid = enumDefs.status_masuk.includes(statusIzin) ? statusIzin : 'Izin';
          const statusPulangValid = enumDefs.status_pulang.includes(statusIzin) ? statusIzin : 'Izin';
          
          console.log(`📝 User ${user.id} (${user.nama}) has izin: ${izin[0].jenis} -> ${statusIzin}`);
          
          // Buat presensi dengan izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              targetDate,
              izin[0].id,
              statusMasukValid,
              statusPulangValid,
              `Auto-generated: Izin ${izin[0].jenis}`
            ]
          );
        } else {
          // Buat presensi dengan status default 'Belum Presensi'
          // Jika 'Belum Presensi' tidak ada di ENUM, gunakan NULL atau default lain
          const defaultStatus = enumDefs.status_masuk.includes('Belum Presensi') 
            ? 'Belum Presensi' 
            : null;
          
          console.log(`📝 User ${user.id} (${user.nama}) - no izin, using default status: ${defaultStatus || 'NULL'}`);
          
          if (defaultStatus) {
            // Gunakan 'Belum Presensi' jika ada di ENUM
            await pool.execute(
              `INSERT INTO presensi 
               (user_id, tanggal, status_masuk, is_system_generated, created_at, updated_at) 
               VALUES (?, ?, ?, 1, NOW(), NOW())`,
              [user.id, targetDate, defaultStatus]
            );
          } else {
            // Gunakan NULL untuk status jika 'Belum Presensi' tidak ada di ENUM
            await pool.execute(
              `INSERT INTO presensi 
               (user_id, tanggal, is_system_generated, created_at, updated_at) 
               VALUES (?, ?, 1, NOW(), NOW())`,
              [user.id, targetDate]
            );
          }
        }
        
        generatedCount++;
        console.log(`✅ Generated presensi for user ${user.id} (${user.nama})`);
        
      } catch (userError) {
        console.error(`❌ Error generating presensi for user ${user.id} (${user.nama}):`, userError.message);
        console.error(`🔍 Error details:`, userError);
        
        // Coba dengan metode fallback
        try {
          console.log(`🔄 Trying fallback method for user ${user.id}...`);
          
          // Fallback: Coba insert dengan status NULL
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, is_system_generated, created_at, updated_at) 
             VALUES (?, ?, 1, NOW(), NOW())`,
            [user.id, targetDate]
          );
          
          generatedCount++;
          console.log(`✅ Fallback successful for user ${user.id}`);
        } catch (fallbackError) {
          console.error(`❌ Fallback also failed for user ${user.id}:`, fallbackError.message);
          errorCount++;
          
          // Log detailed error
          await pool.execute(
            'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
            ['PRESENSI_GENERATION_ERROR', `Failed to generate for user ${user.id} on ${targetDate}: ${userError.message}`]
          );
        }
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['GENERATE_PRESENSI', `Generated ${generatedCount} presensi for ${targetDate} (${skippedCount} skipped, ${errorCount} errors)`]
    );

    console.log(`\n✅ SUMMARY for ${targetDate}:`);
    console.log(`   Generated: ${generatedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Total users: ${users.length}`);
    
    return {
      success: true,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      error_count: errorCount,
      total_users: users.length,
      tanggal: targetDate,
      is_hari_kerja: true
    };

  } catch (error) {
    console.error(`❌ Error generating presensi for ${targetDate}:`, error.message);
    
    // Log error
    try {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['GENERATE_PRESENSI_ERROR', `Failed to generate presensi for ${targetDate}: ${error.message}`]
      );
    } catch (logError) {
      console.error('❌ Failed to log error:', logError.message);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Fungsi untuk cek dan generate ulang presensi jika hari ini tidak ada data
 */
const checkAndGenerateTodayPresensi = async () => {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 CHECKING TODAY\'S PRESENSI STATUS');
    console.log('='.repeat(60));
    
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log(`📅 Today's date: ${today}`);
    
    // Cek apakah hari ini adalah hari kerja
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`ℹ️ Today (${today}) is not a working day: ${hariKerjaInfo.keterangan}`);
      return {
        success: true,
        needs_generate: false,
        reason: hariKerjaInfo.keterangan
      };
    }
    
    // Hitung jumlah presensi hari ini
    const [todayCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [today]
    );
    
    // Hitung jumlah user aktif
    const [userCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND roles = 'pegawai'`
    );
    
    const currentCount = todayCount[0].total;
    const expectedCount = userCount[0].total;
    
    console.log(`📊 Current presensi count: ${currentCount}`);
    console.log(`👥 Expected count (active users): ${expectedCount}`);
    
    if (currentCount === 0 || currentCount < expectedCount) {
      console.log(`⚠️ Presensi data incomplete! Expected ${expectedCount}, found ${currentCount}`);
      console.log(`🔄 Generating missing presensi data...`);
      
      const result = await generatePresensiForTargetDate(today);
      
      // Log aktivitas
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['AUTO_FIX_PRESENSI', `Auto-generated ${result.generated_count || 0} presensi for ${today} (was ${currentCount}, expected ${expectedCount})`]
      );
      
      return {
        success: true,
        needs_generate: true,
        was_generated: true,
        previous_count: currentCount,
        generated_count: result.generated_count || 0,
        message: `Generated ${result.generated_count || 0} presensi records for today`
      };
    }
    
    console.log(`✅ Today's presensi data is complete (${currentCount}/${expectedCount})`);
    return {
      success: true,
      needs_generate: false,
      current_count: currentCount,
      expected_count: expectedCount,
      is_complete: true
    };
    
  } catch (error) {
    console.error('❌ Error checking today\'s presensi:', error.message);
    
    try {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['CHECK_PRESENSI_ERROR', `Error checking today's presensi: ${error.message}`]
      );
    } catch (logError) {
      console.error('❌ Failed to log error:', logError.message);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Setup cron jobs langsung di app.js (LEBIH RELIABLE)
 */
const setupDirectCronJobs = () => {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('⏰ SETTING UP DIRECT CRON JOBS WITH AUTO-FIX');
    console.log('='.repeat(60));
    
    // DEBUG: Log waktu server
    const now = new Date();
    console.log(`🕐 Server Time: ${now.toString()}`);
    console.log(`🌐 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    console.log(`📅 UTC Time: ${now.toUTCString()}`);
    
    // 1. CRON UNTUK HARI INI (SETIAP JAM 00:01 WIB) - Dengan backup check
    cron.schedule('1 0 * * *', async () => {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('⏰ [CRON 00:01] Generating presensi for TODAY...');
        console.log(`🕐 Triggered at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
        console.log(`📅 Today's date (Asia/Jakarta): ${today}`);
        
        const result = await generatePresensiForTargetDate(today);
        console.log(`✅ [CRON 00:01] Result: ${JSON.stringify(result)}`);
        
      } catch (error) {
        console.error('❌ [CRON 00:01] Error:', error.message);
      }
    });
    
    // 2. BACKUP CHECK SETIAP JAM 08:00 WIB - Untuk memastikan presensi hari ini ada
    cron.schedule('0 8 * * *', async () => {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('⏰ [CRON 08:00] Backup check for TODAY\'S presensi...');
        console.log(`🕐 Triggered at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        const checkResult = await checkAndGenerateTodayPresensi();
        console.log(`✅ [CRON 08:00] Check result: ${JSON.stringify(checkResult)}`);
        
      } catch (error) {
        console.error('❌ [CRON 08:00] Error:', error.message);
      }
    });
    
    // 3. BACKUP CHECK SETIAP JAM 12:00 WIB - Double check
    cron.schedule('0 12 * * *', async () => {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('⏰ [CRON 12:00] Midday check for TODAY\'S presensi...');
        console.log(`🕐 Triggered at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        const checkResult = await checkAndGenerateTodayPresensi();
        console.log(`✅ [CRON 12:00] Check result: ${JSON.stringify(checkResult)}`);
        
      } catch (error) {
        console.error('❌ [CRON 12:00] Error:', error.message);
      }
    });
    
    // 4. CRON UNTUK HARI BESOK (SETIAP JAM 23:30 WIB)
    cron.schedule('30 23 * * *', async () => {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('⏰ [CRON 23:30] Generating presensi for TOMORROW...');
        console.log(`🕐 Triggered at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        const tomorrow = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).toISODate();
        console.log(`📅 Tomorrow's date (Asia/Jakarta): ${tomorrow}`);
        
        const result = await generatePresensiForTargetDate(tomorrow);
        console.log(`✅ [CRON 23:30] Result: ${JSON.stringify(result)}`);
        
      } catch (error) {
        console.error('❌ [CRON 23:30] Error:', error.message);
      }
    });
    
    // 5. CRON UNTUK UPDATE AKHIR HARI (SETIAP JAM 23:59 WIB)
    cron.schedule('59 23 * * *', async () => {
      try {
        console.log('\n' + '='.repeat(60));
        console.log('⏰ [CRON 23:59] Updating end of day status...');
        console.log(`🕐 Triggered at: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
        
        const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
        
        // Update semua presensi hari ini yang belum ada jam masuk
        const [presensiList] = await pool.execute(
          `SELECT p.id, p.user_id, p.izin_id, p.jam_masuk 
           FROM presensi p
           JOIN users u ON p.user_id = u.id
           WHERE p.tanggal = ? 
             AND u.is_active = 1
             AND p.jam_masuk IS NULL`,
          [today]
        );
        
        let updatedCount = 0;
        
        for (const presensi of presensiList) {
          try {
            // Cek apakah ada izin
            const [izin] = await pool.execute(
              `SELECT i.id, i.jenis 
               FROM izin i 
               WHERE i.user_id = ? 
                 AND i.status = 'Disetujui'
                 AND DATE(?) BETWEEN DATE(i.tanggal_mulai) AND DATE(i.tanggal_selesai)`,
              [presensi.user_id, today]
            );
            
            if (izin.length > 0) {
              // Map jenis izin ke status yang valid
              const statusIzin = mapIzinToStatus(izin[0].jenis);
              
              // Update dengan status izin
              await pool.execute(
                `UPDATE presensi SET 
                  izin_id = ?,
                  status_masuk = ?,
                  status_pulang = ?,
                  keterangan = COALESCE(CONCAT(keterangan, ' | End-of-day: Izin ${izin[0].jenis}'), 'End-of-day: Izin ${izin[0].jenis}'),
                  updated_at = NOW()
                 WHERE id = ?`,
                [
                  izin[0].id,
                  statusIzin,
                  statusIzin,
                  presensi.id
                ]
              );
            } else {
              // Update sebagai tanpa keterangan
              await pool.execute(
                `UPDATE presensi SET 
                  status_masuk = 'Tanpa Keterangan',
                  status_pulang = 'Tanpa Keterangan',
                  keterangan = COALESCE(CONCAT(keterangan, ' | End-of-day: Tanpa Keterangan'), 'End-of-day: Tanpa Keterangan'),
                  updated_at = NOW()
                 WHERE id = ?`,
                [presensi.id]
              );
            }
            
            updatedCount++;
          } catch (updateError) {
            console.error(`❌ Error updating presensi ${presensi.id}:`, updateError.message);
            
            // Fallback: Set ke 'Tanpa Keterangan' jika error
            try {
              await pool.execute(
                `UPDATE presensi SET 
                  status_masuk = 'Tanpa Keterangan',
                  status_pulang = 'Tanpa Keterangan',
                  keterangan = COALESCE(CONCAT(keterangan, ' | End-of-day update error'), 'End-of-day update error'),
                  updated_at = NOW()
                 WHERE id = ?`,
                [presensi.id]
              );
              updatedCount++;
            } catch (fallbackError) {
              console.error(`❌ Fallback update also failed for presensi ${presensi.id}:`, fallbackError.message);
            }
          }
        }
        
        console.log(`✅ [CRON 23:59] Updated ${updatedCount} presensi records`);
        
      } catch (error) {
        console.error('❌ [CRON 23:59] Error:', error.message);
      }
    });
    
    // 6. TEST CRON - SETIAP 30 MENIT (UNTUK DEBUG)
    if (process.env.NODE_ENV === 'development') {
      cron.schedule('*/30 * * * *', async () => {
        console.log(`\n⏰ [TEST CRON] Running every 30 minutes - Server time: ${new Date().toLocaleString('id-ID')}`);
        
        // Cek status presensi hari ini
        const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
        const [count] = await pool.execute(
          'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
          [today]
        );
        
        console.log(`📊 [TEST CRON] Today's presensi count: ${count[0].total}`);
      });
    }
    
    console.log('✅ DIRECT CRON JOBS WITH AUTO-FIX SETUP COMPLETE');
    console.log('   • 00:01 - Generate presensi hari ini');
    console.log('   • 08:00 - Backup check today\'s presensi');
    console.log('   • 12:00 - Midday check today\'s presensi');
    console.log('   • 23:30 - Generate presensi besok');
    console.log('   • 23:59 - Update end of day status');
    if (process.env.NODE_ENV === 'development') {
      console.log('   • */30 * - Test cron (development only)');
    }
    console.log('='.repeat(60));
    
    return {
      success: true,
      message: 'Direct cron jobs with auto-fix setup successfully'
    };
    
  } catch (error) {
    console.error('❌ Failed to setup direct cron jobs:', error);
    return {
      success: false,
      message: 'Failed to setup cron jobs',
      error: error.message
    };
  }
};

/**
 * Fungsi untuk initialize sistem dengan cron jobs langsung
 */
const initializePresensiSystem = async () => {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 INITIALIZING PRESENSI SYSTEM v2.2 WITH ENUM FIX');
    console.log('='.repeat(60));
    
    // 1. GET ENUM DEFINITIONS FIRST
    console.log('\n📋 Getting ENUM definitions from database...');
    const enumDefs = await getStatusEnums();
    console.log('✅ ENUM definitions loaded');
    
    // 2. SETUP DIRECT CRON JOBS
    const cronResult = setupDirectCronJobs();
    
    if (!cronResult.success) {
      throw new Error(`Failed to setup cron jobs: ${cronResult.message}`);
    }
    
    // 3. CHECK AND GENERATE TODAY'S PRESENSI
    console.log(`\n🔍 Checking today's presensi data...`);
    const checkResult = await checkAndGenerateTodayPresensi();
    
    if (checkResult.success && checkResult.was_generated) {
      console.log(`✅ Auto-generated ${checkResult.generated_count} presensi for today`);
    } else if (checkResult.success && checkResult.is_complete) {
      console.log(`✅ Today's presensi data is complete`);
    } else if (!checkResult.success) {
      console.log(`⚠️ Warning: Today's presensi check had issues: ${checkResult.error}`);
    }
    
    // 4. GENERATE PRESENSI BESOK (jika belum ada)
    const tomorrow = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).toISODate();
    const [tomorrowCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [tomorrow]
    );
    
    if (tomorrowCount[0].total === 0) {
      console.log(`\n📅 Generating presensi for tomorrow (${tomorrow})...`);
      const tomorrowResult = await generatePresensiForTargetDate(tomorrow);
      console.log(`✅ Tomorrow result: ${JSON.stringify(tomorrowResult)}`);
    } else {
      console.log(`\n📅 Tomorrow's presensi already exists: ${tomorrowCount[0].total} records`);
    }
    
    // 5. LOG STARTUP
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['SYSTEM_STARTUP_V2_2', `Presensi system v2.2 with ENUM fix initialized at ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}. ENUMs: ${JSON.stringify(enumDefs)}`]
    );
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 PRESENSI SYSTEM v2.2 WITH ENUM FIX INITIALIZED SUCCESSFULLY!');
    console.log('='.repeat(60));
    
    return {
      success: true,
      message: 'Presensi system initialized',
      cron_jobs_active: true,
      auto_fix_active: true,
      enum_definitions: enumDefs,
      today_check: checkResult,
      tomorrow_generated: tomorrowCount[0].total === 0,
      server_time: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    };
    
  } catch (error) {
    console.error('\n❌ FAILED TO INITIALIZE PRESENSI SYSTEM:', error);
    
    try {
      await pool.execute(
        'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
        ['SYSTEM_ERROR', `Failed to initialize presensi system: ${error.message}`]
      );
    } catch (logError) {
      console.error('❌ Failed to log error:', logError);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
};

// ==================== API ENDPOINTS ====================

// Health check dengan info cron
app.get('/api/health', async (req, res) => {
  try {
    const now = new Date();
    const jakartaTime = DateTime.now().setZone('Asia/Jakarta');
    const today = jakartaTime.toISODate();
    
    // Cek status presensi hari ini
    const [todayCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [today]
    );
    
    // Get ENUM definitions
    const enumDefs = await getStatusEnums();
    
    res.json({ 
      success: true, 
      message: 'SIKOPNAS API v2.2 with ENUM Fix',
      data: {
        app: process.env.APP_NAME || 'SIKOPNAS',
        version: '2.2.0',
        environment: process.env.NODE_ENV || 'development',
        server_time: {
          iso: now.toISOString(),
          local: now.toLocaleString('id-ID'),
          jakarta: jakartaTime.toFormat('yyyy-MM-dd HH:mm:ss')
        },
        presensi_system: {
          status: 'Active',
          cron_jobs: 'Direct setup with auto-fix',
          auto_generate: true,
          enum_fix: true,
          features: ['presensi-otomatis', 'cron-direct', 'auto-fix-today', 'enum-validation', 'fallback-mechanism']
        },
        enum_definitions: enumDefs,
        today_presensi: {
          date: today,
          count: todayCount[0].total,
          needs_check: todayCount[0].total === 0
        },
        endpoints: {
          health: '/api/health',
          check_today: '/api/system/check-today',
          fix_today: '/api/system/fix-today-presensi',
          test_cron: '/api/system/test-cron',
          manual_generate: '/api/system/generate-for-date',
          initialize: '/api/system/initialize-presensi',
          cron_status: '/api/system/cron-status',
          enum_status: '/api/system/enum-status'
        }
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Check today's presensi status
app.get('/api/system/check-today', async (req, res) => {
  try {
    const result = await checkAndGenerateTodayPresensi();
    
    res.json({
      success: true,
      message: 'Today\'s presensi check completed',
      data: result
    });
  } catch (error) {
    console.error('Check today error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check today\'s presensi'
    });
  }
});

// Check ENUM status
app.get('/api/system/enum-status', async (req, res) => {
  try {
    const enumDefs = await getStatusEnums();
    
    // Coba insert test untuk melihat valid ENUM values
    const testValues = [
      'Tepat Waktu',
      'Terlambat',
      'Tanpa Keterangan',
      'Izin Sakit',
      'Izin Cuti',
      'Izin Lainnya',
      'Izin',
      'Belum Presensi'
    ];
    
    const validStatusMasuk = [];
    const invalidStatusMasuk = [];
    
    for (const value of testValues) {
      if (enumDefs.status_masuk.includes(value)) {
        validStatusMasuk.push(value);
      } else {
        invalidStatusMasuk.push(value);
      }
    }
    
    res.json({
      success: true,
      data: {
        enum_definitions: enumDefs,
        validation: {
          status_masuk: {
            valid: validStatusMasuk,
            invalid: invalidStatusMasuk,
            total_valid: validStatusMasuk.length,
            total_invalid: invalidStatusMasuk.length
          }
        },
        recommended_values: {
          for_izin: ['Izin Sakit', 'Izin Cuti', 'Izin Lainnya', 'Izin'],
          for_default: enumDefs.status_masuk.includes('Tanpa Keterangan') ? 'Tanpa Keterangan' : 
                      enumDefs.status_masuk.includes('Belum Presensi') ? 'Belum Presensi' :
                      null
        }
      }
    });
  } catch (error) {
    console.error('Enum status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get ENUM status'
    });
  }
});

// Manual fix today's presensi
app.post('/api/system/fix-today-presensi', async (req, res) => {
  try {
    console.log('🔄 Manual fix today\'s presensi requested...');
    
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log(`📅 Fixing presensi for: ${today}`);
    
    // Pertama, cek status
    const checkResult = await checkAndGenerateTodayPresensi();
    
    if (checkResult.was_generated) {
      res.json({
        success: true,
        message: `Fixed today's presensi. Generated ${checkResult.generated_count} records.`,
        data: checkResult
      });
    } else {
      res.json({
        success: true,
        message: 'Today\'s presensi data is already complete.',
        data: checkResult
      });
    }
  } catch (error) {
    console.error('Fix today error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix today\'s presensi'
    });
  }
});

// Manual initialize endpoint
app.post('/api/system/initialize-presensi', async (req, res) => {
  try {
    console.log('🔄 Manual initialize presensi system requested...');
    const result = await initializePresensiSystem();
    
    res.json({
      success: true,
      message: 'Presensi system initialization completed',
      data: result
    });
  } catch (error) {
    console.error('Manual initialize error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize presensi system'
    });
  }
});

// Test cron endpoint
app.get('/api/system/test-cron', async (req, res) => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    
    console.log(`\n🧪 TESTING CRON MANUALLY for ${today}...`);
    
    // Generate presensi untuk hari ini
    const result = await generatePresensiForTargetDate(today);
    
    res.json({
      success: true,
      message: 'Manual cron test completed',
      data: {
        test_date: today,
        result: result,
        server_time: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
      }
    });
  } catch (error) {
    console.error('Test cron error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to test cron'
    });
  }
});

// Generate untuk tanggal tertentu
app.post('/api/system/generate-for-date', async (req, res) => {
  try {
    const { tanggal } = req.body;
    
    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal wajib diisi (format: YYYY-MM-DD)'
      });
    }
    
    console.log(`\n📅 MANUAL GENERATE for ${tanggal}...`);
    
    const result = await generatePresensiForTargetDate(tanggal);
    
    res.json({
      success: true,
      message: `Manual generate for ${tanggal} completed`,
      data: result
    });
  } catch (error) {
    console.error('Generate for date error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate presensi'
    });
  }
});

// Cek status cron
app.get('/api/system/cron-status', async (req, res) => {
  try {
    const now = new Date();
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const tomorrow = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).toISODate();
    
    // Cek presensi counts
    const [todayCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [today]
    );
    
    const [tomorrowCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [tomorrow]
    );
    
    // Get total active users
    const [userCount] = await pool.execute(
      `SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND roles = 'pegawai'`
    );
    
    // Get ENUM definitions
    const enumDefs = await getStatusEnums();
    
    // Get last 10 system activities
    const [lastActivities] = await pool.execute(
      `SELECT event_type, description, created_at 
       FROM system_log 
       WHERE event_type LIKE '%CRON%' OR event_type LIKE '%GENERATE%' OR event_type LIKE '%SYSTEM%' OR event_type LIKE '%FIX%' OR event_type LIKE '%CHECK%' OR event_type LIKE '%ENUM%'
       ORDER BY created_at DESC LIMIT 10`
    );
    
    res.json({
      success: true,
      data: {
        system_info: {
          server_time: now.toISOString(),
          jakarta_time: DateTime.now().setZone('Asia/Jakarta').toFormat('yyyy-MM-dd HH:mm:ss'),
          timezone: 'Asia/Jakarta',
          node_env: process.env.NODE_ENV || 'development',
          version: '2.2.0'
        },
        presensi_status: {
          today: {
            date: today,
            current_count: todayCount[0].total,
            expected_count: userCount[0].total,
            needs_generate: todayCount[0].total < userCount[0].total,
            completeness_percentage: userCount[0].total > 0 
              ? Math.round((todayCount[0].total / userCount[0].total) * 100) 
              : 0
          },
          tomorrow: {
            date: tomorrow,
            count: tomorrowCount[0].total,
            needs_generate: tomorrowCount[0].total === 0
          }
        },
        enum_status: {
          status_masuk_values: enumDefs.status_masuk,
          status_pulang_values: enumDefs.status_pulang,
          has_belum_presensi: enumDefs.status_masuk.includes('Belum Presensi')
        },
        cron_jobs: {
          status: 'Active (Direct Setup with Auto-Fix)',
          schedule: {
            '00:01 WIB': 'Generate presensi hari ini',
            '08:00 WIB': 'Backup check today\'s presensi',
            '12:00 WIB': 'Midday check today\'s presensi',
            '23:30 WIB': 'Generate presensi besok',
            '23:59 WIB': 'Update end of day status'
          }
        },
        recent_activities: lastActivities,
        endpoints: {
          health: '/api/health',
          check_today: '/api/system/check-today',
          enum_status: '/api/system/enum-status',
          fix_today: '/api/system/fix-today-presensi',
          test_cron: '/api/system/test-cron',
          manual_generate: '/api/system/generate-for-date',
          initialize: '/api/system/initialize-presensi'
        }
      }
    });
  } catch (error) {
    console.error('Cron status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cron status'
    });
  }
});

// Fix presensi dengan status invalid
app.post('/api/system/fix-invalid-status', async (req, res) => {
  try {
    const { tanggal } = req.body;
    const targetDate = tanggal || DateTime.now().setZone('Asia/Jakarta').toISODate();
    
    console.log(`\n🔧 Fixing invalid status for ${targetDate}...`);
    
    // Get ENUM definitions
    const enumDefs = await getStatusEnums();
    
    // Cari presensi dengan status yang tidak valid
    const [invalidPresensi] = await pool.execute(
      `SELECT p.id, p.user_id, p.status_masuk, p.status_pulang, p.izin_id
       FROM presensi p
       WHERE p.tanggal = ? 
         AND (p.status_masuk NOT IN (?) OR p.status_pulang NOT IN (?))`,
      [targetDate, enumDefs.status_masuk, enumDefs.status_pulang]
    );
    
    console.log(`📊 Found ${invalidPresensi.length} presensi with invalid status`);
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const presensi of invalidPresensi) {
      try {
        let newStatusMasuk = 'Tanpa Keterangan';
        let newStatusPulang = 'Tanpa Keterangan';
        
        // Cek jika ada izin
        if (presensi.izin_id) {
          const [izin] = await pool.execute(
            'SELECT jenis FROM izin WHERE id = ?',
            [presensi.izin_id]
          );
          
          if (izin.length > 0) {
            const statusIzin = mapIzinToStatus(izin[0].jenis);
            newStatusMasuk = statusIzin;
            newStatusPulang = statusIzin;
          }
        }
        
        // Validasi bahwa status baru ada di ENUM
        if (!enumDefs.status_masuk.includes(newStatusMasuk)) {
          newStatusMasuk = 'Izin';
        }
        if (!enumDefs.status_pulang.includes(newStatusPulang)) {
          newStatusPulang = 'Izin';
        }
        
        // Update presensi
        await pool.execute(
          `UPDATE presensi SET 
            status_masuk = ?,
            status_pulang = ?,
            keterangan = COALESCE(CONCAT(keterangan, ' | Fixed invalid status'), 'Fixed invalid status'),
            updated_at = NOW()
           WHERE id = ?`,
          [newStatusMasuk, newStatusPulang, presensi.id]
        );
        
        fixedCount++;
        console.log(`✅ Fixed presensi ${presensi.id}: ${presensi.status_masuk} -> ${newStatusMasuk}`);
        
      } catch (updateError) {
        console.error(`❌ Error fixing presensi ${presensi.id}:`, updateError.message);
        errorCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Fixed ${fixedCount} invalid presensi statuses (${errorCount} errors)`,
      data: {
        tanggal: targetDate,
        total_invalid: invalidPresensi.length,
        fixed: fixedCount,
        errors: errorCount,
        enum_values: enumDefs
      }
    });
    
  } catch (error) {
    console.error('Fix invalid status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fix invalid status'
    });
  }
});

// Test endpoint
app.post('/api/test-upload', (req, res) => {
  const bodySize = req.body ? JSON.stringify(req.body).length : 0;
  
  res.json({
    success: true,
    message: 'Upload test successful',
    data: {
      body_size_mb: (bodySize / 1024 / 1024).toFixed(2),
      max_limit: '50MB',
      server_time: new Date().toISOString()
    }
  });
});

// ==================== ERROR HANDLING ====================
app.use(notFoundHandler);
app.use(errorHandler);

// ==================== START SERVER ====================
const startServer = async () => {
  try {
    // Jalankan initialize saat server start
    console.log('\n' + '='.repeat(60));
    console.log('🚀 STARTING SIKOPNAS SERVER v2.2');
    console.log('='.repeat(60));
    
    const initResult = await initializePresensiSystem();
    
    if (!initResult.success) {
      console.error('❌ Failed to initialize system, but continuing...');
    }
    
    const PORT = process.env.PORT || 5000;
    
    app.listen(PORT, () => {
      console.log(`\n✅ Server running on port ${PORT}`);
      console.log(`🌐 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`🔍 Check Today: http://localhost:${PORT}/api/system/check-today`);
      console.log(`📋 ENUM Status: http://localhost:${PORT}/api/system/enum-status`);
      console.log(`🔧 Fix Invalid: POST http://localhost:${PORT}/api/system/fix-invalid-status`);
      console.log(`🔄 Fix Today: POST http://localhost:${PORT}/api/system/fix-today-presensi`);
      console.log(`⏰ Cron Status: http://localhost:${PORT}/api/system/cron-status`);
      console.log(`🕐 Server Time: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
      console.log('\n' + '='.repeat(60));
      console.log('📢 SYSTEM READY FOR PRESENSI AUTOMATION WITH ENUM FIX');
      console.log('='.repeat(60));
    });
    
  } catch (error) {
    console.error('❌ FATAL ERROR starting server:', error);
    process.exit(1);
  }
};

// ==================== EXPORT ====================
module.exports = {
  app, 
  initializePresensiSystem,
  startServer,
  generatePresensiForTargetDate,
  checkAndGenerateTodayPresensi,
  getStatusEnums,
  mapIzinToStatus
};

// Jika file ini dijalankan langsung, start server
if (require.main === module) {
  startServer();
}