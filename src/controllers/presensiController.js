const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
const { pool } = require('../config/database');

// ============ KONFIGURASI SISTEM ============
const SYSTEM_CONFIG = {
  AUTO_GENERATE_HOUR: 0,        // Jam 00:00
  AUTO_UPDATE_HOUR: 23,         // Jam 23:00
  MORNING_CHECK_HOUR: 8,        // Jam 08:00
  TANPA_KETERANGAN_UPDATE_HOUR: 20, // Jam 20:00 untuk update "Tanpa Keterangan"
  TIMEZONE: 'Asia/Jakarta'
};

// ============ FUNGSI HELPER ============

/**
 * Fungsi untuk cek hari kerja
 */
const checkHariKerja = async (tanggal) => {
  try {
    // Cek di tabel hari_kerja dulu (override)
    const [hariKerja] = await pool.execute(
      'SELECT * FROM hari_kerja WHERE tanggal = ?',
      [tanggal]
    );

    if (hariKerja.length > 0) {
      return {
        is_hari_kerja: hariKerja[0].is_hari_kerja === 1,
        keterangan: hariKerja[0].keterangan,
        source: 'hari_kerja'
      };
    }

    // Cek di tabel hari_libur
    const [hariLibur] = await pool.execute(
      'SELECT * FROM hari_libur WHERE tanggal = ?',
      [tanggal]
    );

    if (hariLibur.length > 0) {
      return {
        is_hari_kerja: false,
        keterangan: `Libur: ${hariLibur[0].nama_libur}`,
        source: 'hari_libur'
      };
    }

    // Default: Senin-Jumat adalah hari kerja
    const dayOfWeek = new Date(tanggal).getDay(); // 0 = Minggu, 1 = Senin, etc
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Senin-Jumat

    return {
      is_hari_kerja: isWeekday,
      keterangan: isWeekday ? 'Hari kerja normal' : 'Weekend',
      source: 'default'
    };
  } catch (error) {
    console.error('Error in checkHariKerja:', error);
    return {
      is_hari_kerja: false,
      keterangan: 'Error menentukan hari kerja',
      source: 'error'
    };
  }
};

/**
 * Fungsi untuk cek izin user di tanggal tertentu
 */
const checkUserIzin = async (userId, tanggal) => {
  try {
    // Gunakan DATE() function untuk memastikan perbandingan tanggal yang tepat
    const [izin] = await pool.execute(
      `SELECT i.id, i.jenis, i.status 
       FROM izin i 
       WHERE i.user_id = ? 
         AND i.status = 'Disetujui'
         AND DATE(?) BETWEEN DATE(i.tanggal_mulai) AND DATE(i.tanggal_selesai)`,
      [userId, tanggal]
    );

    return izin.length > 0 ? izin[0] : null;
  } catch (error) {
    console.error('Error in checkUserIzin:', error);
    return null;
  }
};

/**
 * Fungsi untuk mendapatkan jam kerja user
 */
const getJamKerjaUser = async (userId) => {
  try {
    const [jamKerja] = await pool.execute(
      `SELECT jk.* FROM jam_kerja jk
       JOIN users u ON u.jam_kerja_id = jk.id
       WHERE u.id = ?`,
      [userId]
    );

    return jamKerja.length > 0 ? jamKerja[0] : null;
  } catch (error) {
    console.error('Error in getJamKerjaUser:', error);
    return null;
  }
};

// ============ FUNGSI GENERATE PRESENSI OTOMATIS ============

/**
 * Fungsi utama untuk generate presensi untuk tanggal tertentu
 */
const generatePresensiForDate = async (targetDate) => {
  try {
    console.log('🔄 Starting generate presensi for date:', targetDate);
    console.log('='.repeat(60));

    // Cek apakah hari kerja
    const hariKerjaInfo = await checkHariKerja(targetDate);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`⏭️ Skip ${targetDate}: ${hariKerjaInfo.keterangan}`);
      console.log('='.repeat(60));
      return {
        success: true,
        message: `Bukan hari kerja: ${hariKerjaInfo.keterangan}`,
        generated_count: 0,
        updated_count: 0,
        izin_count: 0,
        skipped_count: 0,
        total_users: 0,
        tanggal: targetDate,
        is_hari_kerja: false,
        keterangan: hariKerjaInfo.keterangan
      };
    }

    console.log(`✅ Hari kerja: ${hariKerjaInfo.keterangan}`);

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY u.nama`
    );

    console.log(`📊 Total active users: ${users.length}`);
    
    let generatedCount = 0;
    let updatedCount = 0;
    let izinCount = 0;
    let skippedCount = 0;
    let tanpaKeteranganCount = 0;

    console.log('\n' + '─'.repeat(60));
    console.log('👥 PROCESSING EACH USER:');
    console.log('─'.repeat(60));

    for (const user of users) {
      console.log(`\n👤 [${user.id}] ${user.nama}:`);
      
      try {
        // Cek apakah sudah ada presensi untuk tanggal tersebut
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id, status_masuk, jam_masuk, keterangan FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, targetDate]
        );

        // Cek apakah user memiliki izin yang disetujui untuk tanggal ini
        const izin = await checkUserIzin(user.id, targetDate);
        
        if (izin) {
          console.log(`  📋 User has approved izin: ${izin.jenis}`);
        }

        if (existingPresensi.length > 0) {
          const presensi = existingPresensi[0];
          console.log(`  📅 Existing presensi found: ID ${presensi.id}`);
          
          let actionTaken = false;

          // SCENARIO 1: Ada izin tapi presensi belum mencatat izin
          if (izin && !presensi.izin_id) {
            console.log(`  🔄 Updating: Adding izin ${izin.jenis}`);
            
            // Gunakan status yang lebih pendek untuk menghindari error
            const statusIzin = `Izin ${izin.jenis}`.substring(0, 20);
            
            await pool.execute(
              `UPDATE presensi SET 
                izin_id = ?, 
                status_masuk = ?, 
                status_pulang = ?, 
                keterangan = ?,
                updated_at = NOW()
               WHERE id = ?`,
              [
                izin.id,
                statusIzin,
                statusIzin,
                presensi.keterangan 
                  ? `${presensi.keterangan} | Auto-updated: Izin ${izin.jenis}`
                  : `Auto-updated: Izin ${izin.jenis}`,
                presensi.id
              ]
            );
            updatedCount++;
            izinCount++;
            actionTaken = true;
            console.log(`  ✅ Updated with izin: ${izin.jenis}`);
          }
          
          // SCENARIO 2: Tidak ada izin tapi status masih kosong/null
          else if (!izin && (!presensi.status_masuk || presensi.status_masuk === '' || presensi.status_masuk === 'Belum Presensi') && !presensi.jam_masuk) {
            console.log(`  ⏳ Status: Empty, will be updated to 'Tanpa Keterangan' at end of day`);
          }
          
          // SCENARIO 3: Sudah ada izin di presensi
          else if (presensi.izin_id) {
            console.log(`  ✓ Already has izin recorded: ${presensi.status_masuk}`);
            izinCount++;
          }
          
          if (!actionTaken) {
            skippedCount++;
            console.log(`  ⏭️ Skipped (no action needed)`);
          }
          
          continue;
        }

        // BUAT PRESENSI BARU (jika belum ada)
        console.log(`  ➕ Creating new presensi record`);
        
        if (izin) {
          // SCENARIO 4: Buat presensi baru dengan izin
          console.log(`  📋 Creating new presensi with izin: ${izin.jenis}`);
          
          // Gunakan status yang lebih pendek
          const statusIzin = `Izin ${izin.jenis}`.substring(0, 20);
          
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              targetDate,
              izin.id,
              statusIzin,
              statusIzin,
              `Auto-generated: Izin ${izin.jenis}`
            ]
          );
          generatedCount++;
          izinCount++;
          console.log(`  ✅ Created with izin: ${izin.jenis}`);
        } else {
          // SCENARIO 5: Buat presensi dengan status default "Belum Presensi"
          // Ini akan diupdate menjadi "Tanpa Keterangan" di akhir hari jika tidak ada presensi
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, is_system_generated, created_at, updated_at) 
             VALUES (?, ?, 'Belum Presensi', 1, NOW(), NOW())`,
            [user.id, targetDate]
          );
          generatedCount++;
          tanpaKeteranganCount++;
          console.log(`  📝 Created presensi with default status 'Belum Presensi'`);
        }
      } catch (error) {
        console.error(`  ❌ ERROR:`, error.message);
        
        // Jika error karena data truncated, coba alternatif
        if (error.code === 'ER_DATA_TOO_LONG' || error.errno === 1406) {
          console.log(`  ⚠️ Data truncated error, trying fallback...`);
          try {
            const izin = await checkUserIzin(user.id, targetDate);
            if (izin) {
              // Fallback: Gunakan status yang lebih pendek
              await pool.execute(
                `INSERT INTO presensi 
                 (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
                 VALUES (?, ?, ?, 'Izin', 'Izin', 1, ?, NOW(), NOW())`,
                [
                  user.id,
                  targetDate,
                  izin.id,
                  `Auto-generated: Izin ${izin.jenis}`
                ]
              );
              generatedCount++;
              izinCount++;
              console.log(`  ✅ Created with fallback status 'Izin'`);
            }
          } catch (fallbackError) {
            console.error(`  ❌ Fallback also failed:`, fallbackError.message);
          }
        }
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['GENERATE_PRESENSI', `Generated presensi ${targetDate}: ${generatedCount} new, ${updatedCount} updated, ${izinCount} izin, ${skippedCount} skipped`]
    );

    console.log('\n' + '='.repeat(60));
    console.log('🎉 GENERATION COMPLETED');
    console.log('='.repeat(60));
    console.log(`📈 SUMMARY FOR ${targetDate}:`);
    console.log(`  ✅ New records: ${generatedCount}`);
    console.log(`  🔄 Updated records: ${updatedCount}`);
    console.log(`  📋 With izin: ${izinCount}`);
    console.log(`  ⏭️ Skipped: ${skippedCount}`);
    console.log(`  👥 Total users: ${users.length}`);
    console.log('='.repeat(60));
    
    return {
      success: true,
      generated_count: generatedCount,
      updated_count: updatedCount,
      izin_count: izinCount,
      skipped_count: skippedCount,
      total_users: users.length,
      tanggal: targetDate,
      is_hari_kerja: true,
      keterangan: hariKerjaInfo.keterangan
    };

  } catch (error) {
    console.error('\n❌ GENERATE PRESENSI ERROR:', error);
    throw error;
  }
};

/**
 * Fungsi untuk generate presensi hari ini saat aplikasi start
 */
const generatePresensiHariIniOnStartup = async () => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log('🚀 Application startup: Checking presensi for today:', today);
    
    // Cek apakah sudah ada data presensi hari ini
    const [count] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [today]
    );
    
    const totalPresensiHariIni = count[0].total;
    
    if (totalPresensiHariIni === 0) {
      console.log('⚠️ No presensi found for today, generating now...');
      const result = await generatePresensiForDate(today);
      return {
        type: 'hari_ini',
        action: 'generated',
        message: 'Generated presensi for today on startup',
        data: result
      };
    } else {
      console.log(`✅ Found ${totalPresensiHariIni} presensi records for today`);
      return {
        type: 'hari_ini',
        action: 'skipped',
        message: 'Presensi for today already exists',
        data: { total: totalPresensiHariIni }
      };
    }
  } catch (error) {
    console.error('❌ Error generating presensi hari ini on startup:', error);
    return {
      type: 'error',
      action: 'failed',
      message: 'Failed to generate presensi for today',
      error: error.message
    };
  }
};

/**
 * Fungsi untuk update status akhir hari
 */
const updatePresensiStatusAkhirHari = async () => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log('🌙 Starting end of day update for:', today);
    console.log('='.repeat(60));

    // Cek apakah hari ini hari kerja
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`⏭️ Skip update for ${today}: ${hariKerjaInfo.keterangan}`);
      console.log('='.repeat(60));
      return {
        success: true,
        message: `Bukan hari kerja: ${hariKerjaInfo.keterangan}`,
        updated_count: 0,
        izin_count: 0,
        tanpa_keterangan_count: 0,
        tanggal: today
      };
    }

    console.log(`✅ Hari kerja: ${hariKerjaInfo.keterangan}`);

    // Ambil semua presensi hari ini yang belum melakukan presensi masuk
    const [presensiList] = await pool.execute(
      `SELECT p.id, p.user_id, p.izin_id, p.jam_masuk, p.status_masuk, p.keterangan, u.nama
       FROM presensi p
       JOIN users u ON p.user_id = u.id
       WHERE p.tanggal = ? 
         AND u.is_active = 1
         AND p.jam_masuk IS NULL`,  // Hanya yang belum melakukan presensi masuk
      [today]
    );

    console.log(`📊 Found ${presensiList.length} presensi records without check-in`);

    let updatedCount = 0;
    let izinCount = 0;
    let tanpaKeteranganCount = 0;

    console.log('\n' + '─'.repeat(60));
    console.log('🔄 PROCESSING RECORDS:');
    console.log('─'.repeat(60));

    for (const presensi of presensiList) {
      try {
        console.log(`\n👤 ${presensi.nama}:`);
        
        // Cek apakah user memiliki izin yang disetujui untuk hari ini
        const izin = await checkUserIzin(presensi.user_id, today);

        // Jika ada izin_id di presensi, tapi perlu verifikasi
        if (presensi.izin_id) {
          const [izinDetail] = await pool.execute(
            'SELECT jenis, status FROM izin WHERE id = ?',
            [presensi.izin_id]
          );
          
          if (izinDetail.length > 0 && izinDetail[0].status === 'Disetujui') {
            const newKeterangan = presensi.keterangan 
              ? `${presensi.keterangan} | End-of-day: Izin ${izinDetail[0].jenis}`
              : `End-of-day: Izin ${izinDetail[0].jenis}`;
              
            await pool.execute(
              `UPDATE presensi SET 
                status_masuk = ?, 
                status_pulang = ?,
                keterangan = ?,
                updated_at = NOW()
               WHERE id = ?`,
              [
                `Izin ${izinDetail[0].jenis}`.substring(0, 20),
                `Izin ${izinDetail[0].jenis}`.substring(0, 20),
                newKeterangan,
                presensi.id
              ]
            );
            updatedCount++;
            izinCount++;
            console.log(`  ✅ Updated: Izin ${izinDetail[0].jenis}`);
          }
        } 
        // Jika ditemukan izin yang disetujui melalui fungsi checkUserIzin
        else if (izin) {
          const newKeterangan = presensi.keterangan 
            ? `${presensi.keterangan} | End-of-day: Izin ${izin.jenis}`
            : `End-of-day: Izin ${izin.jenis}`;
            
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?,
              status_masuk = ?, 
              status_pulang = ?,
              keterangan = ?,
              updated_at = NOW()
             WHERE id = ?`,
            [
              izin.id,
              `Izin ${izin.jenis}`.substring(0, 20),
              `Izin ${izin.jenis}`.substring(0, 20),
              newKeterangan,
              presensi.id
            ]
          );
          updatedCount++;
          izinCount++;
          console.log(`  ✅ Updated with izin: ${izin.jenis}`);
        }
        // Jika tidak ada izin dan tidak ada jam_masuk, set sebagai tanpa keterangan
        else if (!presensi.jam_masuk) {
          const newKeterangan = presensi.keterangan 
            ? `${presensi.keterangan} | End-of-day: Tanpa Keterangan`
            : 'End-of-day: Tanpa Keterangan';
            
          await pool.execute(
            `UPDATE presensi SET 
              status_masuk = 'Tanpa Keterangan',
              status_pulang = 'Tanpa Keterangan',
              keterangan = ?,
              updated_at = NOW()
             WHERE id = ?`,
            [newKeterangan, presensi.id]
          );
          updatedCount++;
          tanpaKeteranganCount++;
          console.log(`  ❌ Updated: Tanpa Keterangan`);
        }
      } catch (error) {
        console.error(`  ❌ Error updating presensi ${presensi.id}:`, error.message);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['UPDATE_PRESENSI_END_DAY', `Updated ${updatedCount} presensi untuk ${today} (${izinCount} izin, ${tanpaKeteranganCount} tanpa keterangan)`]
    );

    console.log('\n' + '='.repeat(60));
    console.log('🌙 END OF DAY UPDATE COMPLETED');
    console.log('='.repeat(60));
    console.log(`📈 SUMMARY:`);
    console.log(`  🔄 Updated records: ${updatedCount}`);
    console.log(`  📋 With izin: ${izinCount}`);
    console.log(`  ❌ Tanpa Keterangan: ${tanpaKeteranganCount}`);
    console.log('='.repeat(60));
    
    return {
      success: true,
      updated_count: updatedCount,
      izin_count: izinCount,
      tanpa_keterangan_count: tanpaKeteranganCount,
      tanggal: today
    };

  } catch (error) {
    console.error('\n❌ Update presensi status akhir hari error:', error);
    throw error;
  }
};

/**
 * Fungsi untuk mengecek dan update presensi izin untuk semua user
 * Digunakan untuk memastikan semua user dengan izin tercatat dengan benar
 */
const checkAndUpdateIzinPresensi = async (tanggal) => {
  try {
    console.log(`🔍 Checking and updating izin presensi for: ${tanggal}`);
    
    // Cek hari kerja
    const hariKerjaInfo = await checkHariKerja(tanggal);
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`⏭️ Skip: ${hariKerjaInfo.keterangan}`);
      return { success: true, skipped: true, reason: hariKerjaInfo.keterangan };
    }

    // Cari semua user yang memiliki izin disetujui untuk tanggal tersebut
    const [usersWithIzin] = await pool.execute(
      `SELECT DISTINCT u.id, u.nama, i.id as izin_id, i.jenis
       FROM users u
       JOIN izin i ON u.id = i.user_id
       WHERE u.is_active = 1 
         AND u.roles = 'pegawai'
         AND i.status = 'Disetujui'
         AND DATE(?) BETWEEN DATE(i.tanggal_mulai) AND DATE(i.tanggal_selesai)`,
      [tanggal]
    );

    console.log(`📋 Found ${usersWithIzin.length} users with approved izin`);

    let updatedCount = 0;
    let createdCount = 0;

    for (const user of usersWithIzin) {
      try {
        // Cek apakah sudah ada presensi
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id, status_masuk FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, tanggal]
        );

        const statusIzin = `Izin ${user.jenis}`.substring(0, 20);

        if (existingPresensi.length > 0) {
          // Update existing jika belum ada izin
          const presensi = existingPresensi[0];
          if (!presensi.izin_id || presensi.status_masuk !== statusIzin) {
            await pool.execute(
              `UPDATE presensi SET 
                izin_id = ?,
                status_masuk = ?,
                status_pulang = ?,
                keterangan = COALESCE(CONCAT(keterangan, ' | Auto: Izin ${user.jenis}'), 'Auto: Izin ${user.jenis}'),
                updated_at = NOW()
               WHERE id = ?`,
              [user.izin_id, statusIzin, statusIzin, presensi.id]
            );
            updatedCount++;
            console.log(`  🔄 Updated ${user.nama}: ${user.jenis}`);
          }
        } else {
          // Buat presensi baru
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [user.id, tanggal, user.izin_id, statusIzin, statusIzin, `Auto: Izin ${user.jenis}`]
          );
          createdCount++;
          console.log(`  ➕ Created for ${user.nama}: ${user.jenis}`);
        }
      } catch (error) {
        console.error(`  ❌ Error processing ${user.nama}:`, error.message);
      }
    }

    console.log(`\n✅ Completed: ${updatedCount} updated, ${createdCount} created`);
    
    return {
      success: true,
      updated_count: updatedCount,
      created_count: createdCount,
      total_users_with_izin: usersWithIzin.length
    };
  } catch (error) {
    console.error('❌ Check and update izin error:', error);
    return { success: false, error: error.message };
  }
};

// ============ FUNGSI BARU UNTUK GENERATE OTOMATIS ============

/**
 * Fungsi untuk generate presensi untuk rentang tanggal (FUNGSI BARU)
 */
const generatePresensiForDateRange = async (startDate, endDate) => {
  try {
    console.log(`📅 Generating presensi from ${startDate} to ${endDate}`);
    
    const start = DateTime.fromISO(startDate);
    const end = DateTime.fromISO(endDate);
    
    if (!start.isValid || !end.isValid) {
      throw new Error('Format tanggal tidak valid');
    }
    
    if (start > end) {
      throw new Error('Start date harus sebelum end date');
    }
    
    const results = [];
    let currentDate = start;
    
    while (currentDate <= end) {
      const dateStr = currentDate.toISODate();
      console.log(`\n📆 Processing date: ${dateStr}`);
      
      try {
        const result = await generatePresensiForDate(dateStr);
        results.push(result);
        
        console.log(`✅ Completed: ${dateStr} - Generated: ${result.generated_count}, Updated: ${result.updated_count}`);
      } catch (error) {
        console.error(`❌ Failed for ${dateStr}:`, error.message);
        results.push({
          tanggal: dateStr,
          success: false,
          error: error.message
        });
      }
      
      currentDate = currentDate.plus({ days: 1 });
    }
    
    // Summary
    const totalGenerated = results.filter(r => r.success).reduce((sum, r) => sum + r.generated_count, 0);
    const totalUpdated = results.filter(r => r.success).reduce((sum, r) => sum + r.updated_count, 0);
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 RANGE GENERATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`📅 Period: ${startDate} to ${endDate}`);
    console.log(`✅ Successful dates: ${successCount}`);
    console.log(`❌ Failed dates: ${failedCount}`);
    console.log(`📈 Total generated: ${totalGenerated}`);
    console.log(`🔄 Total updated: ${totalUpdated}`);
    console.log('='.repeat(60));
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['GENERATE_PRESENSI_RANGE', `Generated presensi for range ${startDate} to ${endDate}: ${successCount} success, ${failedCount} failed`]
    );
    
    return {
      success: true,
      total_dates: results.length,
      success_count: successCount,
      failed_count: failedCount,
      total_generated: totalGenerated,
      total_updated: totalUpdated,
      results: results
    };
    
  } catch (error) {
    console.error('❌ Generate presensi range error:', error);
    throw error;
  }
};

/**
 * Fungsi untuk update "Tanpa Keterangan" lebih awal (jam 20:00) (FUNGSI BARU)
 */
const updateTanpaKeteranganEarly = async () => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const now = DateTime.now().setZone('Asia/Jakarta');
    
    console.log('🕗 Early update for "Tanpa Keterangan" at 20:00');
    
    // Cek apakah hari ini hari kerja
    const hariKerjaInfo = await checkHariKerja(today);
    if (!hariKerjaInfo.is_hari_kerja) {
      console.log(`⏭️ Skip: ${hariKerjaInfo.keterangan}`);
      return { success: true, skipped: true, reason: hariKerjaInfo.keterangan };
    }
    
    // Update hanya untuk user yang belum presensi dan tidak ada izin
    const [presensiList] = await pool.execute(
      `SELECT p.id, p.user_id, p.keterangan, u.nama
       FROM presensi p
       JOIN users u ON p.user_id = u.id
       WHERE p.tanggal = ? 
         AND u.is_active = 1
         AND p.jam_masuk IS NULL
         AND p.izin_id IS NULL
         AND p.status_masuk = 'Belum Presensi'`,
      [today]
    );
    
    console.log(`📊 Found ${presensiList.length} records for early update`);
    
    let updatedCount = 0;
    
    for (const presensi of presensiList) {
      try {
        // Cek apakah user punya izin (double check)
        const izin = await checkUserIzin(presensi.user_id, today);
        
        if (!izin) {
          const newKeterangan = presensi.keterangan 
            ? `${presensi.keterangan} | Early-update: Tanpa Keterangan`
            : 'Early-update: Tanpa Keterangan';
          
          await pool.execute(
            `UPDATE presensi SET 
              status_masuk = 'Tanpa Keterangan',
              status_pulang = 'Tanpa Keterangan',
              keterangan = ?,
              updated_at = NOW()
             WHERE id = ?`,
            [newKeterangan, presensi.id]
          );
          updatedCount++;
          console.log(`  ✅ Updated ${presensi.id} to Tanpa Keterangan`);
        }
      } catch (error) {
        console.error(`  ❌ Error updating ${presensi.id}:`, error.message);
      }
    }
    
    console.log(`✅ Early update completed: ${updatedCount} records updated`);
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description) VALUES (?, ?)',
      ['UPDATE_TANPA_KETERANGAN_EARLY', `Early update at 20:00: ${updatedCount} records marked as Tanpa Keterangan`]
    );
    
    return {
      success: true,
      updated_count: updatedCount,
      tanggal: today
    };
    
  } catch (error) {
    console.error('❌ Early update error:', error);
    return { success: false, error: error.message };
  }
};

// ============ SETUP CRON JOB OTOMATIS YANG DITINGKATKAN ============

const setupPresensiCronJobs = () => {
  try {
    const cron = require('node-cron');
    
    console.log('⏰ Setting up presensi cron jobs...');
    
    // 1. SETIAP JAM 00:01 - GENERATE PRESENSI UNTUK HARI INI
    cron.schedule('1 0 * * *', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('⏰ Cron job 00:01: Generating presensi for TODAY...');
      console.log('='.repeat(60));
      try {
        const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
        
        // Pertama, generate presensi untuk semua user
        const generateResult = await generatePresensiForDate(today);
        
        // Kedua, khusus cek dan update izin presensi
        const izinResult = await checkAndUpdateIzinPresensi(today);
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Cron job 00:01 completed:');
        console.log(`   📅 Date: ${generateResult.tanggal}`);
        console.log(`   ➕ Generated: ${generateResult.generated_count}`);
        console.log(`   🔄 Updated: ${generateResult.updated_count}`);
        console.log(`   📋 Izin: ${generateResult.izin_count}`);
        if (izinResult.success && !izinResult.skipped) {
          console.log(`   🔍 Izin check: ${izinResult.updated_count} updated, ${izinResult.created_count} created`);
        }
        console.log('='.repeat(60));
        
      } catch (error) {
        console.error('❌ Cron job 00:01 error:', error.message);
      }
    });
    
    // 2. SETIAP JAM 08:00 - CHECK AND UPDATE MORNING STATUS
    cron.schedule('0 8 * * *', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('⏰ Cron job 08:00: Morning status check...');
      console.log('='.repeat(60));
      try {
        const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
        
        // Cek izin untuk memastikan semua user dengan izin sudah tercatat
        const izinResult = await checkAndUpdateIzinPresensi(today);
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Cron job 08:00 completed:');
        if (izinResult.skipped) {
          console.log(`   ⏭️ Skipped: ${izinResult.reason}`);
        } else {
          console.log(`   🔍 Izin check: ${izinResult.updated_count} updated, ${izinResult.created_count} created`);
        }
        console.log('='.repeat(60));
        
      } catch (error) {
        console.error('❌ Cron job 08:00 error:', error.message);
      }
    });
    
    // 3. SETIAP JAM 20:00 - EARLY UPDATE TANPA KETERANGAN (CRON JOB BARU)
    cron.schedule('0 20 * * *', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('⏰ Cron job 20:00: Early update for Tanpa Keterangan...');
      console.log('='.repeat(60));
      try {
        const result = await updateTanpaKeteranganEarly();
        console.log('='.repeat(60));
      } catch (error) {
        console.error('❌ Cron job 20:00 error:', error.message);
      }
    });
    
    // 4. SETIAP JAM 23:59 - UPDATE STATUS AKHIR HARI
    cron.schedule('59 23 * * *', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('⏰ Cron job 23:59: Final update for today...');
      console.log('='.repeat(60));
      try {
        const result = await updatePresensiStatusAkhirHari();
        console.log('='.repeat(60));
      } catch (error) {
        console.error('❌ Cron job 23:59 error:', error.message);
      }
    });
    
    // 5. SETIAP HARI SENIN JAM 01:00 - GENERATE PRESENSI UNTUK SEMINGGU KE DEPAN (CRON JOB BARU)
    cron.schedule('0 1 * * 1', async () => {
      console.log('\n' + '='.repeat(60));
      console.log('⏰ Cron job 01:00 Monday: Generate presensi for next week...');
      console.log('='.repeat(60));
      try {
        const today = DateTime.now().setZone('Asia/Jakarta');
        const nextWeekStart = today.plus({ days: 1 });
        const nextWeekEnd = today.plus({ days: 7 });
        
        const result = await generatePresensiForDateRange(
          nextWeekStart.toISODate(),
          nextWeekEnd.toISODate()
        );
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Cron job 01:00 Monday completed:');
        console.log(`   📅 Period: ${nextWeekStart.toISODate()} to ${nextWeekEnd.toISODate()}`);
        console.log(`   ✅ Successful dates: ${result.success_count}`);
        console.log(`   📈 Total generated: ${result.total_generated}`);
        console.log('='.repeat(60));
        
      } catch (error) {
        console.error('❌ Cron job 01:00 Monday error:', error.message);
      }
    });
    
    console.log('✅ Presensi cron jobs setup complete - 5 jobs scheduled');
    console.log('   • 00:01 - Generate presensi hari ini');
    console.log('   • 08:00 - Morning izin check');
    console.log('   • 20:00 - Early update Tanpa Keterangan');
    console.log('   • 23:59 - End of day update');
    console.log('   • 01:00 Monday - Generate for next week');
    
    return {
      success: true,
      message: 'Cron jobs setup successfully',
      jobs: [
        '00:01 - Generate today',
        '08:00 - Morning check', 
        '20:00 - Early Tanpa Keterangan',
        '23:59 - End of day update',
        '01:00 Monday - Generate next week'
      ]
    };
  } catch (error) {
    console.error('❌ Failed to setup cron jobs:', error);
    return {
      success: false,
      message: 'Failed to setup cron jobs',
      error: error.message
    };
  }
};

// ============ FUNGSI PRESENSI MASUK ============

const presensiMasuk = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_masuk, latitude_masuk, longitude_masuk, keterangan } = req.body;

    console.log('📱 Presensi masuk attempt - User ID:', userId);

    // Validasi required fields
    if (!foto_masuk) {
      return res.status(400).json({
        success: false,
        message: 'Foto wajib diambil'
      });
    }

    if (latitude_masuk === undefined || longitude_masuk === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Lokasi wajib diisi'
      });
    }

    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const now = DateTime.now().setZone('Asia/Jakarta');

    console.log('📅 Tanggal:', today, '⏰ Waktu sekarang:', now.toFormat('HH:mm:ss'));

    // CEK HARI KERJA
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.status(400).json({
        success: false,
        message: `Hari ini bukan hari kerja: ${hariKerjaInfo.keterangan}`
      });
    }

    // CEK APAKAH USER MEMILIKI IZIN YANG DISETUJUI
    const izin = await checkUserIzin(userId, today);
    if (izin) {
      return res.status(400).json({
        success: false,
        message: `Anda memiliki izin ${izin.jenis} hari ini. Tidak perlu melakukan presensi.`
      });
    }

    // Cek apakah sudah ada presensi hari ini
    const [existingPresensi] = await pool.execute(
      'SELECT id, izin_id, jam_masuk, status_masuk FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (existingPresensi.length === 0) {
      // Jika belum ada presensi record untuk hari ini, buat dulu
      console.log('⚠️ No presensi record found for today, creating one...');
      await generatePresensiForDate(today);
      
      // Cek lagi setelah generate
      const [newPresensi] = await pool.execute(
        'SELECT id, izin_id, jam_masuk, status_masuk FROM presensi WHERE user_id = ? AND tanggal = ?',
        [userId, today]
      );
      
      if (newPresensi.length === 0) {
        return res.status(500).json({
          success: false,
          message: 'Gagal membuat record presensi. Silakan hubungi administrator.'
        });
      }
      
      console.log('✅ Created presensi record for user');
      existingPresensi[0] = newPresensi[0];
    }

    // Jika sudah ada status izin (tidak boleh presensi)
    if (existingPresensi[0].izin_id) {
      return res.status(400).json({
        success: false,
        message: 'Anda memiliki izin hari ini. Tidak perlu melakukan presensi.'
      });
    }

    if (existingPresensi[0].jam_masuk) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan presensi masuk hari ini'
      });
    }

    // JIKA TIDAK ADA IZIN, LANJUT DENGAN PRESENSI NORMAL
    // Get jam kerja user
    const jamKerjaAktif = await getJamKerjaUser(userId);
    if (!jamKerjaAktif) {
      return res.status(400).json({
        success: false,
        message: 'Jam kerja tidak ditemukan untuk user ini'
      });
    }

    // VALIDASI WAKTU PRESENSI MASUK
    const jamMasukStandar = DateTime.fromFormat(jamKerjaAktif.jam_masuk_standar, 'HH:mm:ss');
    const batasAwalPresensi = jamMasukStandar.minus({ hours: 1 });
    const batasTerlambat = DateTime.fromFormat(jamKerjaAktif.batas_terlambat, 'HH:mm:ss');
    const batasAkhirPresensi = batasTerlambat.plus({ hours: 2 });

    // Set waktu validasi dengan tanggal hari ini
    const jamMasukStandarToday = now.set({
      hour: jamMasukStandar.hour,
      minute: jamMasukStandar.minute,
      second: jamMasukStandar.second
    });
    
    const batasAwalPresensiToday = now.set({
      hour: batasAwalPresensi.hour,
      minute: batasAwalPresensi.minute,
      second: batasAwalPresensi.second
    });
    
    const batasTerlambatToday = now.set({
      hour: batasTerlambat.hour,
      minute: batasTerlambat.minute,
      second: batasTerlambat.second
    });
    
    const batasAkhirPresensiToday = now.set({
      hour: batasAkhirPresensi.hour,
      minute: batasAkhirPresensi.minute,
      second: batasAkhirPresensi.second
    });

    // Cek apakah terlalu awal untuk presensi
    if (now < batasAwalPresensiToday) {
      return res.status(400).json({
        success: false,
        message: `Presensi masuk hanya bisa dilakukan mulai ${batasAwalPresensi.toFormat('HH:mm')}`
      });
    }

    // Cek apakah terlalu telat untuk presensi
    if (now > batasAkhirPresensiToday) {
      return res.status(400).json({
        success: false,
        message: `Presensi masuk hanya bisa dilakukan hingga ${batasAkhirPresensi.toFormat('HH:mm')}`
      });
    }

    // Tentukan status masuk
    const toleransi = DateTime.fromFormat(jamKerjaAktif.toleransi_keterlambatan, 'HH:mm:ss');
    
    let statusMasuk = 'Tepat Waktu';
    
    if (now > batasTerlambatToday) {
      statusMasuk = 'Terlambat Berat';
    } else if (now > jamMasukStandarToday.plus({ minutes: toleransi.minute })) {
      statusMasuk = 'Terlambat';
    }

    console.log('✅ Status masuk determined:', statusMasuk);

    // GENERATE FILENAME DAN SIMPAN FILE
    const fotoFileName = `masuk_${userId}_${today}_${Date.now()}.jpg`;
    const filePath = path.join(__dirname, '../uploads/presensi', fotoFileName);
    
    // Convert base64 to file dan simpan
    const base64Data = foto_masuk.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Pastikan folder uploads exists
    const uploadDir = path.join(__dirname, '../uploads/presensi');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    console.log('📸 Foto disimpan sebagai:', fotoFileName);

    // Update presensi yang sudah ada
    await pool.execute(
      `UPDATE presensi SET 
        jam_masuk = ?, 
        foto_masuk = ?, 
        latitude_masuk = ?, 
        longitude_masuk = ?,
        status_masuk = ?,
        keterangan = COALESCE(?, keterangan),
        updated_at = NOW()
       WHERE id = ?`,
      [
        now.toFormat('HH:mm:ss'),
        fotoFileName,
        parseFloat(latitude_masuk),
        parseFloat(longitude_masuk),
        statusMasuk,
        keterangan || null,
        existingPresensi[0].id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PRESENSI_MASUK', `User melakukan presensi masuk - Status: ${statusMasuk}`, userId]
    );

    console.log('🎉 Presensi masuk berhasil - Presensi ID:', existingPresensi[0].id);

    res.json({
      success: true,
      message: 'Presensi masuk berhasil',
      data: {
        id: existingPresensi[0].id,
        tanggal: today,
        jam_masuk: now.toFormat('HH:mm:ss'),
        status_masuk: statusMasuk,
        foto_masuk: fotoFileName,
        latitude_masuk: parseFloat(latitude_masuk),
        longitude_masuk: parseFloat(longitude_masuk)
      }
    });

  } catch (error) {
    console.error('❌ Presensi masuk error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============ FUNGSI PRESENSI PULANG ============

const presensiPulang = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_pulang, latitude_pulang, longitude_pulang, keterangan } = req.body;

    console.log('📱 Presensi pulang attempt - User ID:', userId);

    // Validasi required fields
    if (!foto_pulang) {
      return res.status(400).json({
        success: false,
        message: 'Foto wajib diambil'
      });
    }

    if (latitude_pulang === undefined || longitude_pulang === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Lokasi wajib diisi'
      });
    }

    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const now = DateTime.now().setZone('Asia/Jakarta');

    console.log('📅 Tanggal pulang:', today, '⏰ Waktu sekarang:', now.toFormat('HH:mm:ss'));

    // CEK HARI KERJA
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.status(400).json({
        success: false,
        message: `Hari ini bukan hari kerja: ${hariKerjaInfo.keterangan}`
      });
    }

    // Cek presensi masuk
    const [presensi] = await pool.execute(
      'SELECT * FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (presensi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Anda belum melakukan presensi masuk hari ini'
      });
    }

    // CEK APAKAH USER MEMILIKI IZIN YANG DISETUJUI
    const izin = await checkUserIzin(userId, today);
    if (izin) {
      return res.status(400).json({
        success: false,
        message: `Anda memiliki izin ${izin.jenis} hari ini. Tidak perlu melakukan presensi pulang.`
      });
    }

    if (presensi[0].jam_pulang) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan presensi pulang hari ini'
      });
    }

    // Jika ada izin di record presensi, tidak perlu presensi pulang
    if (presensi[0].izin_id) {
      return res.status(400).json({
        success: false,
        message: 'Anda memiliki izin hari ini. Tidak perlu melakukan presensi pulang.'
      });
    }

    // Get jam kerja user (hanya untuk yang tidak izin)
    const jamKerjaAktif = await getJamKerjaUser(userId);
    if (!jamKerjaAktif) {
      return res.status(400).json({
        success: false,
        message: 'Jam kerja tidak ditemukan untuk user ini'
      });
    }

    const jamPulangStandar = DateTime.fromFormat(jamKerjaAktif.jam_pulang_standar, 'HH:mm:ss');
    
    // Set waktu validasi dengan tanggal hari ini
    const jamPulangStandarToday = now.set({
      hour: jamPulangStandar.hour,
      minute: jamPulangStandar.minute,
      second: jamPulangStandar.second
    });

    // Batas awal presensi pulang (1 jam sebelum jam pulang standar)
    const batasAwalPulang = jamPulangStandarToday.minus({ hours: 1 });

    // Cek apakah terlalu awal untuk presensi pulang
    if (now < batasAwalPulang) {
      return res.status(400).json({
        success: false,
        message: `Presensi pulang hanya bisa dilakukan mulai ${batasAwalPulang.toFormat('HH:mm')}`
      });
    }

    // Tentukan status pulang
    let statusPulang = 'Tepat Waktu';
    let isLembur = 0;
    let jamLembur = null;

    // Cek apakah pulang lebih cepat
    if (now < jamPulangStandarToday) {
      statusPulang = 'Cepat Pulang';
    } 
    // Cek lembur (lebih dari jam pulang standar)
    else if (now > jamPulangStandarToday) {
      statusPulang = 'Lembur';
      isLembur = 1;
      
      // Hitung jam lembur
      const diffMinutes = Math.floor(now.diff(jamPulangStandarToday, 'minutes').minutes);
      
      // Format jam lembur sebagai TIME (HH:mm:ss)
      const lemburHours = Math.floor(diffMinutes / 60);
      const lemburMinutes = diffMinutes % 60;
      jamLembur = `${lemburHours.toString().padStart(2, '0')}:${lemburMinutes.toString().padStart(2, '0')}:00`;
      
      console.log('⏰ Lembur detected:', jamLembur, 'Total minutes:', diffMinutes);
    }

    // GENERATE FILENAME DAN SIMPAN FILE
    const fotoFileName = `pulang_${userId}_${today}_${Date.now()}.jpg`;
    const filePath = path.join(__dirname, '../uploads/presensi', fotoFileName);
    
    // Convert base64 to file dan simpan
    const base64Data = foto_pulang.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Pastikan folder uploads exists
    const uploadDir = path.join(__dirname, '../uploads/presensi');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, buffer);
    console.log('📸 Foto pulang disimpan sebagai:', fotoFileName);

    // Update presensi pulang
    const updateData = [
      now.toFormat('HH:mm:ss'),
      fotoFileName,
      parseFloat(latitude_pulang),
      parseFloat(longitude_pulang),
      statusPulang,
      isLembur,
      jamLembur,
      keterangan || null,
      presensi[0].id
    ];

    console.log('📝 Update data for pulang:', updateData);

    await pool.execute(
      `UPDATE presensi SET 
        jam_pulang = ?, 
        foto_pulang = ?, 
        latitude_pulang = ?, 
        longitude_pulang = ?,
        status_pulang = ?, 
        is_lembur = ?, 
        jam_lembur = ?, 
        keterangan = COALESCE(?, keterangan),
        updated_at = NOW()
       WHERE id = ?`,
      updateData
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PRESENSI_PULANG', `User melakukan presensi pulang - Status: ${statusPulang}${isLembur ? ' dengan lembur ' + jamLembur : ''}`, userId]
    );

    console.log('🎉 Presensi pulang berhasil - Presensi ID:', presensi[0].id);

    res.json({
      success: true,
      message: 'Presensi pulang berhasil',
      data: {
        id: presensi[0].id,
        jam_pulang: now.toFormat('HH:mm:ss'),
        status_pulang: statusPulang,
        is_lembur: isLembur,
        jam_lembur: jamLembur,
        foto_pulang: fotoFileName,
        latitude_pulang: parseFloat(latitude_pulang),
        longitude_pulang: parseFloat(longitude_pulang)
      }
    });

  } catch (error) {
    console.error('❌ Presensi pulang error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ============ FUNGSI GET PRESENSI HARI INI ============

const getPresensiHariIni = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan, i.jenis as jenis_izin
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       LEFT JOIN izin i ON p.izin_id = i.id
       WHERE p.user_id = ? AND p.tanggal = ?`,
      [userId, today]
    );

    // Jika tidak ada presensi untuk hari ini, cek apakah ada izin
    if (presensi.length === 0) {
      const izin = await checkUserIzin(userId, today);
      if (izin) {
        return res.json({
          success: true,
          data: {
            tanggal: today,
            izin_id: izin.id,
            jenis_izin: izin.jenis,
            status_masuk: `Izin ${izin.jenis}`,
            status_pulang: `Izin ${izin.jenis}`,
            keterangan: 'Izin (belum ada presensi record)'
          }
        });
      }
      
      // Cek apakah hari ini hari kerja
      const hariKerjaInfo = await checkHariKerja(today);
      if (hariKerjaInfo.is_hari_kerja) {
        return res.json({
          success: true,
          data: {
            tanggal: today,
            status_masuk: 'Belum Presensi',
            status_pulang: 'Belum Presensi',
            keterangan: 'Belum melakukan presensi',
            is_hari_kerja: true
          }
        });
      } else {
        return res.json({
          success: true,
          data: {
            tanggal: today,
            status_masuk: 'Libur',
            status_pulang: 'Libur',
            keterangan: hariKerjaInfo.keterangan,
            is_hari_kerja: false
          }
        });
      }
    }

    res.json({
      success: true,
      data: presensi[0]
    });

  } catch (error) {
    console.error('Get presensi hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ============ FUNGSI GET PRESENSI USER ============

const getPresensiUser = async (req, res) => {
  try {
    const userId = req.user.id;

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
              i.jenis as jenis_izin, i.status as status_izin,
              jk.jam_masuk_standar, jk.jam_pulang_standar
       FROM presensi p 
       LEFT JOIN users u ON p.user_id = u.id 
       LEFT JOIN izin i ON p.izin_id = i.id
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE p.user_id = ?
       ORDER BY p.tanggal DESC`,
      [userId]
    );

    // Fungsi untuk menentukan status akhir (sama dengan frontend)
    const getStatusAkhir = (presensiItem) => {
      // Jika ada keterangan PEMUTIHAN
      if (presensiItem.keterangan && (
          presensiItem.keterangan.includes('PEMUTIHAN') || 
          presensiItem.keterangan.includes('pemutihan') ||
          presensiItem.keterangan.includes('Jangan lupa presensi'))) {
        return 'Hadir (Pemutihan)';
      }
      
      if (presensiItem.izin_id) {
        return presensiItem.jenis_izin === 'sakit' ? 'Sakit' : 'Izin';
      } else if (presensiItem.status_masuk === 'Tanpa Keterangan' || presensiItem.status_pulang === 'Tanpa Keterangan') {
        return 'Tanpa Keterangan';
      } else if (presensiItem.status_masuk === 'Tepat Waktu' && presensiItem.jam_pulang) {
        return 'Hadir';
      } else if (presensiItem.status_masuk && presensiItem.status_masuk.includes('Terlambat')) {
        return 'Terlambat';
      } else if (presensiItem.jam_masuk && !presensiItem.jam_pulang) {
        return 'Belum Pulang';
      } else if (!presensiItem.jam_masuk && !presensiItem.jam_pulang) {
        return 'Tanpa Keterangan';
      }
      return 'Tidak Diketahui';
    };

    // Hitung statistik keseluruhan
    const stats = {
      total: presensi.length,
      hadir: 0,
      hadir_pemutihan: 0,
      tepat_waktu: 0,
      terlambat: 0,
      terlambat_berat: 0,
      izin: 0,
      sakit: 0,
      tanpa_keterangan: 0,
      lembur: 0,
      belum_pulang: 0,
      presentase_kehadiran: 0
    };

    // Proses setiap data presensi
    const processedPresensi = presensi.map(presensiItem => {
      const processed = { ...presensiItem };
      
      // Ubah status_pulang "Cepat Pulang" menjadi "Tanpa Keterangan"
      if (processed.status_pulang === 'Cepat Pulang') {
        processed.status_pulang = 'Tanpa Keterangan';
      }
      
      // Tentukan status akhir
      const statusAkhir = getStatusAkhir(processed);
      processed.status_akhir = statusAkhir;
      
      // Tandai jika ada pemutihan
      processed.isPemutihan = processed.keterangan && (
        processed.keterangan.includes('PEMUTIHAN') || 
        processed.keterangan.includes('pemutihan') ||
        processed.keterangan.includes('Jangan lupa presensi')
      );
      
      // Update statistik
      switch (statusAkhir) {
        case 'Hadir':
          stats.hadir++;
          if (processed.status_masuk === 'Tepat Waktu') {
            stats.tepat_waktu++;
          }
          if (processed.is_lembur) {
            stats.lembur++;
          }
          break;
        case 'Hadir (Pemutihan)':
          stats.hadir++;
          stats.hadir_pemutihan++;
          if (processed.status_masuk === 'Tepat Waktu') {
            stats.tepat_waktu++;
          }
          break;
        case 'Terlambat':
          stats.hadir++;
          stats.terlambat++;
          if (processed.status_masuk === 'Terlambat Berat') {
            stats.terlambat_berat++;
          }
          break;
        case 'Izin':
          stats.izin++;
          break;
        case 'Sakit':
          stats.sakit++;
          break;
        case 'Tanpa Keterangan':
          stats.tanpa_keterangan++;
          break;
        case 'Belum Pulang':
          stats.belum_pulang++;
          stats.hadir++; // Dianggap hadir karena sudah presensi masuk
          break;
      }
      
      // Ekstrak bulan dan tahun untuk filter
      if (processed.tanggal) {
        const date = new Date(processed.tanggal);
        processed.bulan = (date.getMonth() + 1).toString().padStart(2, '0');
        processed.tahun = date.getFullYear().toString();
        processed.tanggal_formatted = date.toLocaleDateString('id-ID', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric'
        });
        processed.hari_only = date.getDate();
      }
      
      // Format waktu
      processed.jam_masuk_formatted = processed.jam_masuk ? 
        processed.jam_masuk.split(':').slice(0, 2).join(':') : null;
      processed.jam_pulang_formatted = processed.jam_pulang ? 
        processed.jam_pulang.split(':').slice(0, 2).join(':') : null;
      
      return processed;
    });

    // Hitung presentase kehadiran
    if (stats.total > 0) {
      stats.presentase_kehadiran = Math.round((stats.hadir / stats.total) * 100);
    }

    // Data untuk filter bulan dan tahun
    const monthsData = [
      { value: "", label: "Semua Bulan" },
      { value: "01", label: "Januari" },
      { value: "02", label: "Februari" },
      { value: "03", label: "Maret" },
      { value: "04", label: "April" },
      { value: "05", label: "Mei" },
      { value: "06", label: "Juni" },
      { value: "07", label: "Juli" },
      { value: "08", label: "Agustus" },
      { value: "09", label: "September" },
      { value: "10", label: "Oktober" },
      { value: "11", label: "November" },
      { value: "12", label: "Desember" }
    ];

    // Ambil tahun-tahun yang tersedia dari data
    const availableYearsSet = new Set();
    processedPresensi.forEach(p => {
      if (p.tahun) {
        availableYearsSet.add(p.tahun);
      }
    });
    
    const availableYears = [
      { value: "", label: "Semua Tahun" },
      ...Array.from(availableYearsSet)
        .sort((a, b) => b - a)
        .map(year => ({ value: year, label: year }))
    ];

    // Data untuk bulan ini (sebagai default filter)
    const currentDate = new Date();
    const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    const currentYear = currentDate.getFullYear().toString();
    
    // Filter data untuk bulan ini
    const currentMonthData = processedPresensi.filter(p => 
      p.bulan === currentMonth && p.tahun === currentYear
    );

    // Statistik untuk bulan ini
    const currentMonthStats = {
      total: currentMonthData.length,
      hadir: 0,
      hadir_pemutihan: 0,
      tepat_waktu: 0,
      terlambat: 0,
      terlambat_berat: 0,
      izin: 0,
      sakit: 0,
      tanpa_keterangan: 0,
      lembur: 0,
      belum_pulang: 0
    };

    currentMonthData.forEach(p => {
      switch (p.status_akhir) {
        case 'Hadir':
          currentMonthStats.hadir++;
          if (p.status_masuk === 'Tepat Waktu') {
            currentMonthStats.tepat_waktu++;
          }
          if (p.is_lembur) {
            currentMonthStats.lembur++;
          }
          break;
        case 'Hadir (Pemutihan)':
          currentMonthStats.hadir++;
          currentMonthStats.hadir_pemutihan++;
          if (p.status_masuk === 'Tepat Waktu') {
            currentMonthStats.tepat_waktu++;
          }
          break;
        case 'Terlambat':
          currentMonthStats.hadir++;
          currentMonthStats.terlambat++;
          if (p.status_masuk === 'Terlambat Berat') {
            currentMonthStats.terlambat_berat++;
          }
          break;
        case 'Izin':
          currentMonthStats.izin++;
          break;
        case 'Sakit':
          currentMonthStats.sakit++;
          break;
        case 'Tanpa Keterangan':
          currentMonthStats.tanpa_keterangan++;
          break;
        case 'Belum Pulang':
          currentMonthStats.belum_pulang++;
          currentMonthStats.hadir++;
          break;
      }
    });

    res.json({
      success: true,
      data: {
        all_presensi: processedPresensi,
        stats: {
          overall: stats,
          current_month: currentMonthStats
        },
        filters: {
          months: monthsData,
          years: availableYears,
          current_month: currentMonth,
          current_year: currentYear
        },
        current_month_data: currentMonthData
      }
    });

  } catch (error) {
    console.error('Get presensi user error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ============ FUNGSI GET ALL PRESENSI ============

const getAllPresensi = async (req, res) => {
  try {
    const { user_id } = req.query;

    // Validasi user_id wajib
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID wajib diisi'
      });
    }

    let query = `
      SELECT 
        p.*, 
        u.nama, 
        u.jabatan, 
        u.wilayah_penugasan,
        i.jenis as jenis_izin, 
        i.status as status_izin,
        jk.jam_masuk_standar, 
        jk.jam_pulang_standar
      FROM presensi p 
      LEFT JOIN users u ON p.user_id = u.id 
      LEFT JOIN izin i ON p.izin_id = i.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE u.is_active = 1
      AND p.user_id = ?
      ORDER BY p.tanggal DESC
    `;
    
    const params = [user_id];

    const [presensi] = await pool.execute(query, params);

    res.json({
      success: true,
      data: presensi
    });

  } catch (error) {
    console.error('Get all presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ============ FUNGSI GET REKAP PRESENSI ============

const getRekapPresensi = async (req, res) => {
  try {
    const { bulan, tahun, wilayah } = req.query;

    // Default ke bulan dan tahun saat ini jika tidak disediakan
    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    const targetBulan = bulan || currentDate.month;
    const targetTahun = tahun || currentDate.year;

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromISO(startDate).endOf('month').toISODate();

    let query = `
      SELECT 
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        
        -- Hitung hari kerja
        (
          SELECT COUNT(*) 
          FROM (
            SELECT DATE_ADD(?, INTERVAL seq.seq DAY) as tanggal
            FROM (
              SELECT 0 as seq UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
              UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
              UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14
              UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19
              UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24
              UNION SELECT 25 UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29
              UNION SELECT 30
            ) seq
            WHERE DATE_ADD(?, INTERVAL seq.seq DAY) <= ?
          ) dates
          LEFT JOIN hari_libur hl ON dates.tanggal = hl.tanggal
          LEFT JOIN hari_kerja hk ON dates.tanggal = hk.tanggal
          WHERE 
            (hk.id IS NULL AND DAYOFWEEK(dates.tanggal) BETWEEN 2 AND 6)
            OR 
            (hk.id IS NOT NULL AND hk.is_hari_kerja = 1)
            AND hl.id IS NULL
        ) as total_hari_kerja,
        
        COUNT(p.id) as total_presensi,
        SUM(CASE WHEN p.status_masuk = 'Tepat Waktu' THEN 1 ELSE 0 END) as tepat_waktu,
        SUM(CASE WHEN p.status_masuk LIKE 'Terlambat%' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as tanpa_keterangan,
        SUM(CASE WHEN p.izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur
      FROM users u
      LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal BETWEEN ? AND ?
      WHERE u.is_active = 1 AND u.roles = 'pegawai'
    `;
    const params = [startDate, startDate, endDate, startDate, endDate];

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    query += ' GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan ORDER BY u.nama';

    const [rekap] = await pool.execute(query, params);

    res.json({
      success: true,
      data: {
        rekap,
        periode: {
          bulan: targetBulan,
          tahun: targetTahun,
          start_date: startDate,
          end_date: endDate,
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM')
        }
      }
    });

  } catch (error) {
    console.error('Get rekap presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ============ FUNGSI UNTUK ADMIN ============

/**
 * API untuk generate presensi manual dari admin
 */
const generatePresensiManualAPI = async (req, res) => {
  try {
    const { tanggal, force_update = false } = req.body;
    const targetDate = tanggal || DateTime.now().setZone('Asia/Jakarta').toISODate();

    if (!DateTime.fromISO(targetDate).isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    console.log('👨‍💼 Admin manual generate request for date:', targetDate);
    const result = await generatePresensiForDate(targetDate);

    // Log admin activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['ADMIN_GENERATE_PRESENSI', `Admin generate presensi untuk ${targetDate}`, req.user.id]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${result.generated_count} presensi baru dan update ${result.updated_count} presensi untuk tanggal ${targetDate}`,
      data: result
    });

  } catch (error) {
    console.error('Admin generate error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * API untuk generate presensi hari ini (emergency)
 */
const generatePresensiHariIniAPI = async (req, res) => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log('🚨 Emergency generate request for today:', today);
    
    const result = await generatePresensiForDate(today);

    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['EMERGENCY_GENERATE', `Emergency generate presensi hari ini ${today}`, req.user?.id || 1]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${result.generated_count} presensi untuk hari ini`,
      data: result
    });

  } catch (error) {
    console.error('Emergency generate error:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal generate presensi hari ini',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * API untuk generate presensi untuk rentang tanggal (API BARU)
 */
const generatePresensiRangeAPI = async (req, res) => {
  try {
    const { start_date, end_date, force_update = false } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Start date dan end date wajib diisi'
      });
    }

    if (!DateTime.fromISO(start_date).isValid || !DateTime.fromISO(end_date).isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    console.log('👨‍💼 Admin manual generate range request:', start_date, 'to', end_date);
    
    const result = await generatePresensiForDateRange(start_date, end_date);

    // Log admin activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['ADMIN_GENERATE_PRESENSI_RANGE', `Admin generate presensi untuk range ${start_date} hingga ${end_date}`, req.user.id]
    );

    res.json({
      success: true,
      message: `Berhasil generate presensi untuk ${result.total_dates} hari. ${result.success_count} berhasil, ${result.failed_count} gagal.`,
      data: result
    });

  } catch (error) {
    console.error('Admin generate range error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * API untuk mendapatkan status sistem
 */
const getSystemStatus = async (req, res) => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const tomorrow = DateTime.now().setZone('Asia/Jakarta').plus({ days: 1 }).toISODate();
    const yesterday = DateTime.now().setZone('Asia/Jakarta').minus({ days: 1 }).toISODate();
    
    // Hitung presensi untuk hari ini, kemarin, dan besok
    const [todayCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [today]
    );
    
    const [tomorrowCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [tomorrow]
    );
    
    const [yesterdayCount] = await pool.execute(
      'SELECT COUNT(*) as total FROM presensi WHERE tanggal = ?',
      [yesterday]
    );
    
    // Hitung user aktif
    const [activeUsers] = await pool.execute(
      'SELECT COUNT(*) as total FROM users WHERE is_active = 1 AND roles = "pegawai"'
    );
    
    // Get last cron job activity
    const [lastCron] = await pool.execute(
      `SELECT event_type, description, created_at FROM system_log 
       WHERE event_type LIKE '%GENERATE%' OR event_type LIKE '%UPDATE%' OR event_type LIKE '%CRON%'
       ORDER BY created_at DESC LIMIT 1`
    );
    
    // Get hari kerja info untuk hari ini
    const hariKerjaInfo = await checkHariKerja(today);
    
    // Get system statistics
    const [todayStats] = await pool.execute(
      `SELECT 
        SUM(CASE WHEN status_masuk = 'Tepat Waktu' THEN 1 ELSE 0 END) as tepat_waktu,
        SUM(CASE WHEN status_masuk LIKE 'Terlambat%' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as tanpa_keterangan,
        SUM(CASE WHEN izin_id IS NOT NULL THEN 1 ELSE 0 END) as izin,
        COUNT(*) as total
       FROM presensi 
       WHERE tanggal = ?`,
      [today]
    );
    
    res.json({
      success: true,
      data: {
        system_info: {
          tanggal_sekarang: today,
          waktu_server: DateTime.now().setZone('Asia/Jakarta').toFormat('yyyy-MM-dd HH:mm:ss'),
          timezone: 'Asia/Jakarta'
        },
        presensi_stats: {
          hari_ini: {
            total: todayCount[0].total,
            tepat_waktu: todayStats[0]?.tepat_waktu || 0,
            terlambat: todayStats[0]?.terlambat || 0,
            tanpa_keterangan: todayStats[0]?.tanpa_keterangan || 0,
            izin: todayStats[0]?.izin || 0
          },
          kemarin: yesterdayCount[0].total,
          besok: tomorrowCount[0].total
        },
        user_info: {
          total_pegawai_aktif: activeUsers[0].total
        },
        hari_kerja: {
          is_hari_kerja: hariKerjaInfo.is_hari_kerja,
          keterangan: hariKerjaInfo.keterangan,
          source: hariKerjaInfo.source
        },
        cron_job: {
          last_activity: lastCron[0] || null,
          status: 'Running',
          schedules: [
            { time: '00:01', description: 'Generate presensi hari ini' },
            { time: '08:00', description: 'Morning check' },
            { time: '20:00', description: 'Early update Tanpa Keterangan' },
            { time: '23:59', description: 'End of day update' },
            { time: '01:00 Monday', description: 'Generate for next week' }
          ]
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting system status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting system status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * API untuk fix presensi data (legacy function)
 */
const fixPresensiData = async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Start date dan end date wajib diisi'
      });
    }

    console.log(`🔄 Fixing presensi data dari ${start_date} hingga ${end_date}`);

    // Get semua presensi dalam rentang tanggal
    const [presensiList] = await pool.execute(
      `SELECT p.id, p.user_id, p.tanggal, p.izin_id, p.status_masuk, i.jenis as jenis_izin, i.status as status_izin
       FROM presensi p
       LEFT JOIN izin i ON p.izin_id = i.id
       WHERE p.tanggal BETWEEN ? AND ?`,
      [start_date, end_date]
    );

    let fixedCount = 0;
    let skippedCount = 0;

    for (const presensi of presensiList) {
      try {
        // Cek apakah ada izin yang disetujui untuk user di tanggal tersebut
        const izin = await checkUserIzin(presensi.user_id, presensi.tanggal);

        // Jika ada izin disetujui tapi presensi tidak mencatat izin_id
        if (izin && !presensi.izin_id) {
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?,
              status_masuk = ?,
              status_pulang = ?,
              keterangan = COALESCE(CONCAT(keterangan, ' - Fixed: Izin ${izin.jenis}'), 'Fixed: Izin ${izin.jenis}'),
              updated_at = NOW()
             WHERE id = ?`,
            [
              izin.id,
              `Izin ${izin.jenis}`,
              `Izin ${izin.jenis}`,
              presensi.id
            ]
          );
          fixedCount++;
          console.log(`✅ Fixed presensi ${presensi.id} dengan izin ${izin.jenis}`);
        } 
        // Jika tidak ada izin tapi status adalah izin (data inconsistent)
        else if (!izin && presensi.izin_id && presensi.status_izin !== 'Disetujui') {
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = NULL,
              status_masuk = 'Tanpa Keterangan',
              status_pulang = 'Tanpa Keterangan',
              keterangan = COALESCE(CONCAT(keterangan, ' - Fixed: Izin tidak disetujui'), 'Fixed: Izin tidak disetujui'),
              updated_at = NOW()
             WHERE id = ?`,
            [presensi.id]
          );
          fixedCount++;
          console.log(`🔄 Fixed presensi ${presensi.id}: hapus izin tidak disetujui`);
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error fixing presensi ${presensi.id}:`, error.message);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['FIX_PRESENSI_DATA', `Fixed ${fixedCount} presensi records, ${skippedCount} skipped untuk periode ${start_date} hingga ${end_date}`, req.user?.id || 1]
    );

    res.json({
      success: true,
      message: `Berhasil memperbaiki ${fixedCount} data presensi`,
      data: {
        fixed_count: fixedCount,
        skipped_count: skippedCount,
        total_checked: presensiList.length,
        periode: { start_date, end_date }
      }
    });

  } catch (error) {
    console.error('❌ Fix presensi data error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * Legacy function untuk generate presensi otomatis (untuk compatibility)
 */
const generatePresensiOtomatis = async (req, res) => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    const result = await generatePresensiForDate(today);
    
    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['GENERATE_PRESENSI_OTOMATIS', `System generate presensi otomatis untuk ${today}`, req.user?.id || 1]
    );
    
    res.json({
      success: true,
      message: `Berhasil generate ${result.generated_count} presensi`,
      data: result
    });
  } catch (error) {
    console.error('Generate presensi otomatis error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

/**
 * Legacy function untuk get generate stats
 */
const getGenerateStats = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;

    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    const targetBulan = bulan || currentDate.month;
    const targetTahun = tahun || currentDate.year;

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();

    // Statistik generate
    const [generateStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_generated,
        SUM(CASE WHEN is_system_generated = 1 THEN 1 ELSE 0 END) as system_generated,
        SUM(CASE WHEN izin_id IS NOT NULL THEN 1 ELSE 0 END) as dengan_izin,
        SUM(CASE WHEN izin_id IS NULL AND status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as tanpa_keterangan
       FROM presensi 
       WHERE tanggal BETWEEN ? AND ? AND is_system_generated = 1`,
      [startDate, endDate]
    );

    // Statistik hari kerja
    const [hariKerjaStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_hari,
        SUM(CASE WHEN hl.id IS NOT NULL THEN 1 ELSE 0 END) as hari_libur,
        SUM(CASE WHEN hk.id IS NOT NULL AND hk.is_hari_kerja = 1 THEN 1 ELSE 0 END) as hari_kerja_khusus,
        SUM(CASE WHEN hl.id IS NULL AND hk.id IS NULL AND DAYOFWEEK(dates.tanggal) BETWEEN 2 AND 6 THEN 1 ELSE 0 END) as hari_kerja_normal
       FROM (
         SELECT DATE_ADD(?, INTERVAL seq.seq DAY) as tanggal
         FROM (
           SELECT 0 as seq UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
           UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
           UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14
           UNION SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19
           UNION SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24
           UNION SELECT 25 UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29
           UNION SELECT 30
         ) seq
         WHERE DATE_ADD(?, INTERVAL seq.seq DAY) <= ?
       ) dates
       LEFT JOIN hari_libur hl ON dates.tanggal = hl.tanggal
       LEFT JOIN hari_kerja hk ON dates.tanggal = hk.tanggal`,
      [startDate, startDate, endDate]
    );

    // Log generate activity
    const [generateLogs] = await pool.execute(
      `SELECT event_type, description, created_at 
       FROM system_log 
       WHERE event_type IN ('GENERATE_PRESENSI', 'ADMIN_GENERATE_PRESENSI', 'EMERGENCY_GENERATE', 'FIX_PRESENSI_DATA', 'UPDATE_PRESENSI_END_DAY')
       AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC 
       LIMIT 10`,
      [startDate, endDate]
    );

    res.json({
      success: true,
      data: {
        periode: {
          bulan: parseInt(targetBulan),
          tahun: parseInt(targetTahun),
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate
        },
        generate_stats: generateStats[0] || {},
        hari_kerja_stats: hariKerjaStats[0] || {},
        recent_activities: generateLogs
      }
    });

  } catch (error) {
    console.error('Get generate stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ============ EKSPOR SEMUA FUNGSI ============

module.exports = {
  // Fungsi utama presensi (SEMUA FUNGSI ASLI TETAP ADA)
  presensiMasuk,
  presensiPulang,
  getPresensiHariIni,
  getPresensiUser,
  getAllPresensi,
  getRekapPresensi,
  
  // Fungsi generate yang sudah ada
  generatePresensiForDate,
  generatePresensiHariIniOnStartup,
  updatePresensiStatusAkhirHari,
  checkAndUpdateIzinPresensi,
  
  // Fungsi generate untuk admin (FUNGSI ASLI)
  generatePresensiManual: generatePresensiManualAPI,
  generatePresensiHariIni: generatePresensiHariIniAPI,
  
  // Fungsi generate baru yang ditambahkan
  generatePresensiRange: generatePresensiRangeAPI, // API BARU untuk generate range
  updateTanpaKeteranganEarly, // FUNGSI BARU untuk early update
  generatePresensiForDateRange, // FUNGSI BARU untuk generate range
  
  // Fungsi legacy (untuk compatibility) - SEMUA TETAP ADA
  generatePresensiOtomatis,
  fixPresensiData,
  getGenerateStats,
  
  // Helper functions - SEMUA TETAP ADA
  checkHariKerja,
  checkUserIzin,
  getJamKerjaUser,
  
  // Setup cron - FUNGSI DIPERBAIKI DENGAN TAMBAHAN CRON JOB BARU
  setupPresensiCronJobs,
  
  // System functions - SEMUA TETAP ADA
  getSystemStatus
};