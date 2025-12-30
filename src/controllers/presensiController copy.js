const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
const { pool } = require('../config/database');

// Fungsi helper untuk cek hari kerja
const checkHariKerja = async (tanggal) => {
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
};

// ============ FUNGSI BARU UNTUK GENERATE PRESENSI YANG LEBIH BAIK ============

/**
 * Fungsi untuk generate presensi harian otomatis (dipanggil oleh cron job)
 */
const generatePresensiHarian = async (targetDate = null) => {
  try {
    const today = targetDate || DateTime.now().setZone('Asia/Jakarta').toISODate();
    console.log('🔄 Auto-generating presensi untuk:', today);

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let izinCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi untuk hari ini
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, today]
        );

        if (existingPresensi.length > 0) {
          skippedCount++;
          continue;
        }

        // Cek apakah hari ini hari kerja
        const hariKerjaInfo = await checkHariKerja(today);
        
        if (!hariKerjaInfo.is_hari_kerja) {
          console.log(`⏭️ Skip ${user.nama}: Bukan hari kerja - ${hariKerjaInfo.keterangan}`);
          continue;
        }

        // Cek apakah user memiliki izin yang disetujui untuk hari ini
        const [izin] = await pool.execute(
          `SELECT i.id, i.jenis, i.status 
           FROM izin i 
           WHERE i.user_id = ? 
             AND i.status = 'Disetujui'
             AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai`,
          [user.id, today]
        );

        if (izin.length > 0) {
          // Buat presensi dengan status izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              today,
              izin[0].id,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              `Auto-generated: Izin ${izin[0].jenis}`
            ]
          );
          generatedCount++;
          izinCount++;
          console.log(`✅ Generated izin presensi untuk: ${user.nama} - ${izin[0].jenis}`);
        } else {
          // Buat presensi dengan status alpha (hanya untuk hari kerja)
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, 'Tanpa Keterangan', 'Tanpa Keterangan', 1, 'Auto-generated: Tidak hadir', NOW(), NOW())`,
            [user.id, today]
          );
          generatedCount++;
          console.log(`❌ Generated alpha presensi untuk: ${user.nama}`);
        }
      } catch (error) {
        console.error(`❌ Error generating presensi for user ${user.id}:`, error);
      }
    }

    console.log(`🎉 Auto-generation selesai: ${generatedCount} generated (${izinCount} izin), ${skippedCount} skipped`);
    
    return {
      success: true,
      generated_count: generatedCount,
      izin_count: izinCount,
      skipped_count: skippedCount,
      total_users: users.length,
      tanggal: today
    };

  } catch (error) {
    console.error('❌ Generate presensi harian error:', error);
    throw error;
  }
};

/**
 * Fungsi untuk generate presensi manual dengan tanggal tertentu
 */
const generatePresensiManual = async (req, res) => {
  try {
    const { tanggal } = req.body;
    const targetDate = tanggal || DateTime.now().setZone('Asia/Jakarta').toISODate();

    if (!DateTime.fromISO(targetDate).isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    console.log('🔄 Manual generate presensi untuk:', targetDate);

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`
    );

    let generatedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let izinCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi untuk tanggal tersebut
        const [existingPresensi] = await pool.execute(
          'SELECT id, izin_id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, targetDate]
        );

        // Cek apakah hari tersebut hari kerja
        const hariKerjaInfo = await checkHariKerja(targetDate);
        
        if (!hariKerjaInfo.is_hari_kerja) {
          console.log(`⏭️ Skip ${user.nama}: Bukan hari kerja - ${hariKerjaInfo.keterangan}`);
          continue;
        }

        // Cek izin yang disetujui
        const [izin] = await pool.execute(
          `SELECT i.id, i.jenis, i.status 
           FROM izin i 
           WHERE i.user_id = ? 
             AND i.status = 'Disetujui'
             AND ? BETWEEN i.tanggal_mulai AND i.tanggal_selesai`,
          [user.id, targetDate]
        );

        if (existingPresensi.length > 0) {
          // Jika sudah ada presensi, update jika ada perubahan izin
          if (izin.length > 0 && !existingPresensi[0].izin_id) {
            await pool.execute(
              `UPDATE presensi SET 
                izin_id = ?, 
                status_masuk = ?, 
                status_pulang = ?, 
                keterangan = ?,
                updated_at = NOW()
               WHERE id = ?`,
              [
                izin[0].id,
                `Izin ${izin[0].jenis}`,
                `Izin ${izin[0].jenis}`,
                `Updated: Izin ${izin[0].jenis}`,
                existingPresensi[0].id
              ]
            );
            updatedCount++;
            izinCount++;
            console.log(`🔄 Updated presensi dengan izin untuk: ${user.nama}`);
          }
          skippedCount++;
          continue;
        }

        if (izin.length > 0) {
          // Buat presensi dengan status izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, izin_id, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, 1, ?, NOW(), NOW())`,
            [
              user.id,
              targetDate,
              izin[0].id,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              `Manual-generated: Izin ${izin[0].jenis}`
            ]
          );
          generatedCount++;
          izinCount++;
          console.log(`✅ Generated izin presensi untuk: ${user.nama} - ${izin[0].jenis}`);
        } else {
          // Buat presensi dengan status alpha
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan, created_at, updated_at) 
             VALUES (?, ?, 'Tanpa Keterangan', 'Tanpa Keterangan', 1, 'Manual-generated: Tidak hadir', NOW(), NOW())`,
            [user.id, targetDate]
          );
          generatedCount++;
          console.log(`❌ Generated alpha presensi untuk: ${user.nama}`);
        }
      } catch (error) {
        console.error(`❌ Error processing user ${user.id}:`, error);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['GENERATE_PRESENSI_MANUAL', `Manual generate presensi untuk ${targetDate}: ${generatedCount} generated, ${updatedCount} updated, ${skippedCount} skipped`, req.user?.id || 1]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${generencedCount} presensi (${izinCount} izin) dan update ${updatedCount} presensi untuk tanggal ${targetDate}`,
      data: {
        generated_count: generatedCount,
        updated_count: updatedCount,
        izin_count: izinCount,
        skipped_count: skippedCount,
        total_users: users.length,
        tanggal: targetDate
      }
    });

  } catch (error) {
    console.error('❌ Generate presensi manual error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Fungsi untuk memperbaiki data presensi yang sudah ada (fix existing data)
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
        const [izin] = await pool.execute(
          `SELECT id, jenis FROM izin 
           WHERE user_id = ? 
           AND status = 'Disetujui'
           AND ? BETWEEN tanggal_mulai AND tanggal_selesai`,
          [presensi.user_id, presensi.tanggal]
        );

        // Jika ada izin disetujui tapi presensi tidak mencatat izin_id
        if (izin.length > 0 && !presensi.izin_id) {
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?,
              status_masuk = ?,
              status_pulang = ?,
              keterangan = CONCAT(COALESCE(keterangan, ''), ' - Fixed: Izin ${izin[0].jenis}'),
              updated_at = NOW()
             WHERE id = ?`,
            [
              izin[0].id,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              presensi.id
            ]
          );
          fixedCount++;
          console.log(`✅ Fixed presensi ${presensi.id} dengan izin ${izin[0].jenis}`);
        } 
        // Jika tidak ada izin tapi status adalah izin (data inconsistent)
        else if (!izin.length && presensi.izin_id && presensi.status_izin !== 'Disetujui') {
          await pool.execute(
            `UPDATE presensi SET 
              izin_id = NULL,
              status_masuk = 'Tanpa Keterangan',
              status_pulang = 'Tanpa Keterangan',
              keterangan = CONCAT(COALESCE(keterangan, ''), ' - Fixed: Izin tidak disetujui'),
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
        console.error(`❌ Error fixing presensi ${presensi.id}:`, error);
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
 * Fungsi untuk mendapatkan statistik generate presensi
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
       WHERE event_type IN ('AUTO_GENERATE_PRESENSI', 'GENERATE_PRESENSI_MANUAL', 'FIX_PRESENSI_DATA')
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
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM')
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

// ============ FUNGSI YANG SUDAH ADA (TIDAK DIUBAH) ============

const presensiMasuk = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_masuk, latitude_masuk, longitude_masuk, keterangan } = req.body;

    console.log('Presensi masuk attempt - User:', userId);
    console.log('Base64 length:', foto_masuk?.length);
    console.log('Location:', { latitude_masuk, longitude_masuk });

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

    console.log('Tanggal:', today, 'Waktu sekarang:', now.toFormat('HH:mm:ss'));

    // Cek apakah sudah presensi hari ini
    const [existingPresensi] = await pool.execute(
      'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    if (existingPresensi.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan presensi masuk hari ini'
      });
    }

    // CEK HARI KERJA
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.status(400).json({
        success: false,
        message: `Hari ini bukan hari kerja: ${hariKerjaInfo.keterangan}`
      });
    }

    // Cek izin
    const { checkIzinBeforePresensi } = require('./izinController');
    const izin = await checkIzinBeforePresensi(userId, today);
    if (izin) {
      return res.status(400).json({
        success: false,
        message: `Anda memiliki izin ${izin.jenis} yang disetujui pada tanggal ini`
      });
    }

    // Get jam kerja user
    const [jamKerja] = await pool.execute(
      `SELECT jk.* FROM jam_kerja jk
       JOIN users u ON u.jam_kerja_id = jk.id
       WHERE u.id = ?`,
      [userId]
    );

    if (jamKerja.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Jam kerja tidak ditemukan untuk user ini'
      });
    }

    const jamKerjaAktif = jamKerja[0];

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

    // Tentukan status masuk - SESUAI ENUM: 'Tepat Waktu','Terlambat','Tanpa Keterangan'
    const toleransi = DateTime.fromFormat(jamKerjaAktif.toleransi_keterlambatan, 'HH:mm:ss');
    
    let statusMasuk = 'Tepat Waktu'; // Default sesuai ENUM
    
    if (now > batasTerlambatToday) {
      statusMasuk = 'Terlambat'; // Sesuai ENUM
    } else if (now > jamMasukStandarToday.plus({ minutes: toleransi.minute })) {
      statusMasuk = 'Terlambat'; // Sesuai ENUM
    }

    console.log('Status masuk:', statusMasuk);

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
    console.log('Foto disimpan sebagai:', fotoFileName);

    // Insert presensi ke database - SESUAI STRUKTUR TABEL
    const [result] = await pool.execute(
      `INSERT INTO presensi 
       (user_id, tanggal, jam_masuk, foto_masuk, latitude_masuk, longitude_masuk, 
        status_masuk, status_pulang, keterangan) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        today,
        now.toFormat('HH:mm:ss'),
        fotoFileName, // Simpan nama file saja (sesuai perubahan sebelumnya)
        parseFloat(latitude_masuk),
        parseFloat(longitude_masuk),
        statusMasuk, // Sesuai ENUM: 'Tepat Waktu','Terlambat','Tanpa Keterangan'
        'Belum Pulang', // Sesuai ENUM: 'Tepat Waktu','Cepat Pulang','Lembur','Belum Pulang'
        keterangan || null
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['PRESENSI_MASUK', `User melakukan presensi masuk - Status: ${statusMasuk}`, userId]
    );

    console.log('Presensi masuk berhasil - ID:', result.insertId);

    res.json({
      success: true,
      message: 'Presensi masuk berhasil',
      data: {
        id: result.insertId,
        tanggal: today,
        jam_masuk: now.toFormat('HH:mm:ss'),
        status_masuk: statusMasuk,
        foto_masuk: fotoFileName
      }
    });

  } catch (error) {
    console.error('Presensi masuk error:', error);
    console.error('Error details:', error.message);
    console.error('SQL State:', error.sqlState);
    console.error('SQL Message:', error.sqlMessage);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const presensiPulang = async (req, res) => {
  try {
    const userId = req.user.id;
    const { foto_pulang, latitude_pulang, longitude_pulang, keterangan } = req.body;

    console.log('Presensi pulang attempt - User:', userId);
    console.log('Base64 length:', foto_pulang?.length);
    console.log('Location:', { latitude_pulang, longitude_pulang });

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

    console.log('Tanggal pulang:', today, 'Waktu sekarang:', now.toFormat('HH:mm:ss'));

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

    if (presensi[0].jam_pulang) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan presensi pulang hari ini'
      });
    }

    // CEK HARI KERJA
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.status(400).json({
        success: false,
        message: `Hari ini bukan hari kerja: ${hariKerjaInfo.keterangan}`
      });
    }

    // Get jam kerja user
    const [jamKerja] = await pool.execute(
      `SELECT jk.* FROM jam_kerja jk
       JOIN users u ON u.jam_kerja_id = jk.id
       WHERE u.id = ?`,
      [userId]
    );

    if (jamKerja.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Jam kerja tidak ditemukan untuk user ini'
      });
    }

    const jamKerjaAktif = jamKerja[0];
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

    // Tentukan status pulang - SESUAI ENUM: 'Tepat Waktu','Cepat Pulang','Lembur','Belum Pulang'
    let statusPulang = 'Tepat Waktu'; // Default
    let isLembur = 0;
    let jamLembur = null;

    // Cek apakah pulang lebih cepat
    if (now < jamPulangStandarToday) {
      statusPulang = 'Cepat Pulang'; // Sesuai ENUM
    } 
    // Cek lembur (lebih dari jam pulang standar)
    else if (now > jamPulangStandarToday) {
      statusPulang = 'Lembur'; // Sesuai ENUM
      isLembur = 1;
      
      // Hitung jam lembur dengan format yang benar
      const diffMinutes = Math.floor(now.diff(jamPulangStandarToday, 'minutes').minutes);
      
      // Format jam lembur sebagai TIME (HH:mm:ss)
      const lemburHours = Math.floor(diffMinutes / 60);
      const lemburMinutes = diffMinutes % 60;
      jamLembur = `${lemburHours.toString().padStart(2, '0')}:${lemburMinutes.toString().padStart(2, '0')}:00`;
      
      console.log('Lembur detected:', jamLembur, 'Total minutes:', diffMinutes);
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
    console.log('Foto pulang disimpan sebagai:', fotoFileName);

    // Update presensi pulang - Pastikan tidak ada undefined
    const updateData = [
      now.toFormat('HH:mm:ss'),                    // jam_pulang
      fotoFileName,                                // foto_pulang
      parseFloat(latitude_pulang),                 // latitude_pulang
      parseFloat(longitude_pulang),                // longitude_pulang
      statusPulang,                                // status_pulang
      isLembur,                                    // is_lembur
      jamLembur,                                   // jam_lembur (bisa null)
      keterangan || null,                          // keterangan (bisa null)
      presensi[0].id                               // WHERE id
    ];

    console.log('Update data:', updateData);

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

    console.log('Presensi pulang berhasil - ID:', presensi[0].id);

    res.json({
      success: true,
      message: 'Presensi pulang berhasil',
      data: {
        id: presensi[0].id,
        jam_pulang: now.toFormat('HH:mm:ss'),
        status_pulang: statusPulang,
        is_lembur: isLembur,
        jam_lembur: jamLembur,
        foto_pulang: fotoFileName
      }
    });

  } catch (error) {
    console.error('Presensi pulang error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const generatePresensiOtomatis = async (req, res) => {
  try {
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();
    
    // CEK HARI KERJA DENGAN SISTEM BARU
    const hariKerjaInfo = await checkHariKerja(today);
    
    if (!hariKerjaInfo.is_hari_kerja) {
      return res.json({
        success: true,
        message: `Bukan hari kerja: ${hariKerjaInfo.keterangan}, skip generate presensi`
      });
    }

    // Get semua user aktif
    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jam_kerja_id, u.wilayah_penugasan 
       FROM users u 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'`
    );

    let generatedCount = 0;

    for (const user of users) {
      try {
        // Cek apakah sudah ada presensi
        const [existingPresensi] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [user.id, today]
        );

        if (existingPresensi.length > 0) continue;

        // Cek apakah user memiliki izin
        const [izin] = await pool.execute(
          `SELECT * FROM izin 
           WHERE user_id = ? AND tanggal_mulai <= ? AND tanggal_selesai >= ? AND status = 'Disetujui'`,
          [user.id, today, today]
        );

        if (izin.length > 0) {
          // Buat presensi dengan status izin
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, izin_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan) 
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [
              user.id,
              izin[0].id,
              today,
              `Izin ${izin[0].jenis}`,
              `Izin ${izin[0].jenis}`,
              `Auto-generated: Izin ${izin[0].jenis}`
            ]
          );
          generatedCount++;
        } else {
          // Buat presensi dengan status alpha
          await pool.execute(
            `INSERT INTO presensi 
             (user_id, tanggal, status_masuk, status_pulang, is_system_generated, keterangan) 
             VALUES (?, ?, 'Tanpa Keterangan', 'Tanpa Keterangan', 1, 'Auto-generated: Tidak hadir')`,
            [user.id, today]
          );
          generatedCount++;
        }
      } catch (error) {
        console.error(`Error generating presensi for user ${user.id}:`, error);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['GENERATE_PRESENSI', `System generate presensi otomatis untuk ${generatedCount} user`, req.user.id]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${generatedCount} presensi otomatis`,
      data: {
        generated_count: generatedCount,
        total_users: users.length
      }
    });

  } catch (error) {
    console.error('Generate presensi otomatis error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

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
        
        -- Hitung hari kerja dengan sistem baru
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
      data: rekap
    });

  } catch (error) {
    console.error('Get rekap presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getPresensiHariIni = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = DateTime.now().setZone('Asia/Jakarta').toISODate();

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan 
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.user_id = ? AND p.tanggal = ?`,
      [userId, today]
    );

    res.json({
      success: true,
      data: presensi[0] || null
    });

  } catch (error) {
    console.error('Get presensi hari ini error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getPresensiUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bulan, tahun } = req.query;

    // Default ke bulan dan tahun saat ini jika tidak disediakan
    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    const targetBulan = bulan || currentDate.month;
    const targetTahun = tahun || currentDate.year;

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromISO(startDate).endOf('month').toISODate();

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan,
              i.jenis as jenis_izin, i.status as status_izin
       FROM presensi p 
       LEFT JOIN users u ON p.user_id = u.id 
       LEFT JOIN izin i ON p.izin_id = i.id
       WHERE p.user_id = ? AND p.tanggal BETWEEN ? AND ?
       ORDER BY p.tanggal DESC`,
      [userId, startDate, endDate]
    );

    // Hitung rekap
    let rekap = {
      hadir: 0,
      terlambat: 0,
      tanpa_keterangan: 0,
      izin: 0,
      sakit: 0,
      lembur: 0
    };

    presensi.forEach(p => {
      if (p.izin_id) {
        if (p.jenis_izin === 'sakit') {
          rekap.sakit++;
        } else {
          rekap.izin++;
        }
      } else if (p.status_masuk === 'Tanpa Keterangan') {
        rekap.tanpa_keterangan++;
      } else {
        rekap.hadir++;
        if (p.status_masuk.includes('Terlambat')) {
          rekap.terlambat++;
        }
        if (p.is_lembur) {
          rekap.lembur++;
        }
      }
    });

    res.json({
      success: true,
      data: {
        rekap,
        presensi
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

const getAllPresensi = async (req, res) => {
  try {
    const { start_date, end_date, wilayah } = req.query;

    // Validasi tanggal
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Start date dan end date wajib diisi'
      });
    }

    let query = `
      SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
             i.jenis as jenis_izin, i.status as status_izin
      FROM presensi p 
      LEFT JOIN users u ON p.user_id = u.id 
      LEFT JOIN izin i ON p.izin_id = i.id
      WHERE p.tanggal BETWEEN ? AND ?
    `;
    const params = [start_date, end_date];
    
    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }
    
    query += ' ORDER BY p.tanggal DESC, u.nama ASC';

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

// ============ EKSPOR SEMUA FUNGSI ============

module.exports = {
  // Fungsi yang sudah ada (tetap dipertahankan)
  presensiMasuk,
  presensiPulang,
  getPresensiHariIni,
  getPresensiUser,
  getAllPresensi,
  generatePresensiOtomatis,
  getRekapPresensi,
  checkHariKerja,
  
  // Fungsi baru yang ditambahkan
  generatePresensiHarian,    // Untuk cron job
  generatePresensiManual,    // Untuk generate manual dengan tanggal
  fixPresensiData,          // Untuk memperbaiki data yang sudah ada
  getGenerateStats          // Untuk melihat statistik generate
};