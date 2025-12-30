const { pool } = require('../config/database');
const { DateTime } = require('luxon');

const getRekapKehadiran = async (req, res) => {
  try {
    const { bulan, tahun, user_id, wilayah } = req.query;

    // Default ke bulan dan tahun saat ini
    const currentDate = DateTime.now().setZone('Asia/Jakarta');
    const targetBulan = bulan || currentDate.month;
    const targetTahun = tahun || currentDate.getFullYear();

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();

    console.log('Rekap period:', startDate, 'to', endDate);

    let query = `
      SELECT 
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        
        -- Hitung hari kerja dalam bulan ini
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
            -- Default: Senin-Jumat adalah hari kerja
            (hk.id IS NULL AND DAYOFWEEK(dates.tanggal) BETWEEN 2 AND 6)
            OR 
            -- Override oleh tabel hari_kerja
            (hk.id IS NOT NULL AND hk.is_hari_kerja = 1)
            AND hl.id IS NULL -- Exclude hari libur
        ) as total_hari_kerja,
        
        -- Hitung presensi
        COUNT(p.id) as total_presensi,
        
        -- Hitung kehadiran
        SUM(CASE 
          WHEN p.izin_id IS NULL 
          AND (p.status_masuk = 'Tepat Waktu' OR p.status_masuk = 'Terlambat' OR p.status_masuk = 'Terlambat Berat')
          THEN 1 
          ELSE 0 
        END) as hadir,
        
        -- Hitung tepat waktu
        SUM(CASE 
          WHEN p.izin_id IS NULL AND p.status_masuk = 'Tepat Waktu' THEN 1 
          ELSE 0 
        END) as tepat_waktu,
        
        -- Hitung terlambat
        SUM(CASE 
          WHEN p.izin_id IS NULL AND (p.status_masuk = 'Terlambat' OR p.status_masuk = 'Terlambat Berat') THEN 1 
          ELSE 0 
        END) as terlambat,
        
        -- Hitung izin berdasarkan jenis
        SUM(CASE 
          WHEN p.izin_id IS NOT NULL AND i.jenis = 'cuti' THEN 1 
          ELSE 0 
        END) as izin_cuti,
        
        SUM(CASE 
          WHEN p.izin_id IS NOT NULL AND i.jenis = 'sakit' THEN 1 
          ELSE 0 
        END) as izin_sakit,
        
        SUM(CASE 
          WHEN p.izin_id IS NOT NULL AND i.jenis = 'izin' THEN 1 
          ELSE 0 
        END) as izin_lainnya,
        
        SUM(CASE 
          WHEN p.izin_id IS NOT NULL AND i.jenis = 'dinas_luar' THEN 1 
          ELSE 0 
        END) as dinas_luar,
        
        -- Hitung tanpa keterangan (alpha)
        SUM(CASE 
          WHEN p.izin_id IS NULL 
          AND (p.status_masuk = 'Tanpa Keterangan' OR p.status_masuk IS NULL) 
          THEN 1 
          ELSE 0 
        END) as tanpa_keterangan,
        
        -- Hitung lembur
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as lembur,

        -- Hitung belum pulang
        SUM(CASE 
          WHEN p.jam_masuk IS NOT NULL AND p.jam_pulang IS NULL 
          AND p.status_pulang = 'Belum Pulang' 
          THEN 1 
          ELSE 0 
        END) as belum_pulang

      FROM users u
      LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal BETWEEN ? AND ?
      LEFT JOIN izin i ON p.izin_id = i.id
      WHERE u.is_active = 1 AND u.roles = 'pegawai'
    `;

    const params = [startDate, startDate, endDate, startDate, endDate];

    if (user_id) {
      query += ' AND u.id = ?';
      params.push(user_id);
    }

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    query += ' GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan ORDER BY u.nama';

    const [rekap] = await pool.execute(query, params);

    // Hitung statistik tambahan
    const rekapDenganStatistik = rekap.map(item => {
      const totalHadir = item.hadir;
      const totalIzin = item.izin_cuti + item.izin_sakit + item.izin_lainnya + item.dinas_luar;
      const totalKehadiran = totalHadir + totalIzin;
      
      const persentaseHadir = item.total_hari_kerja > 0 
        ? ((totalKehadiran / item.total_hari_kerja) * 100).toFixed(2)
        : 0;

      const persentaseTepatWaktu = totalHadir > 0 
        ? ((item.tepat_waktu / totalHadir) * 100).toFixed(2)
        : 0;

      return {
        ...item,
        total_hadir: totalHadir,
        total_izin: totalIzin,
        total_kehadiran: totalKehadiran,
        persentase_kehadiran: parseFloat(persentaseHadir),
        persentase_tepat_waktu: parseFloat(persentaseTepatWaktu),
        alpha: item.tanpa_keterangan
      };
    });

    // Hitung total statistik
    const totalStatistik = {
      total_pegawai: rekapDenganStatistik.length,
      total_hari_kerja: rekapDenganStatistik[0]?.total_hari_kerja || 0,
      total_hadir: rekapDenganStatistik.reduce((sum, item) => sum + item.hadir, 0),
      total_terlambat: rekapDenganStatistik.reduce((sum, item) => sum + item.terlambat, 0),
      total_izin: rekapDenganStatistik.reduce((sum, item) => sum + item.total_izin, 0),
      total_alpha: rekapDenganStatistik.reduce((sum, item) => sum + item.tanpa_keterangan, 0),
      total_lembur: rekapDenganStatistik.reduce((sum, item) => sum + item.lembur, 0)
    };

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
        statistik: totalStatistik,
        rekap: rekapDenganStatistik
      }
    });

  } catch (error) {
    console.error('Get rekap kehadiran error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getDetailKehadiranUser = async (req, res) => {
  try {
    const { user_id, bulan, tahun } = req.query;
    const currentUser = req.user;

    // Jika bukan admin, hanya bisa akses data sendiri
    let targetUserId = user_id;
    if (currentUser.roles !== 'admin' && currentUser.roles !== 'atasan') {
      targetUserId = currentUser.id;
    }

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        message: 'User ID wajib diisi'
      });
    }

    const targetBulan = bulan || DateTime.now().setZone('Asia/Jakarta').month;
    const targetTahun = tahun || DateTime.now().setZone('Asia/Jakarta').year;

    const startDate = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).endOf('month').toISODate();

    // Get detail presensi user
    const [detailPresensi] = await pool.execute(
      `SELECT 
        p.tanggal,
        p.jam_masuk,
        p.jam_pulang,
        p.status_masuk,
        p.status_pulang,
        p.is_lembur,
        p.jam_lembur,
        p.keterangan,
        p.foto_masuk,
        p.foto_pulang,
        i.jenis as jenis_izin,
        i.keterangan as keterangan_izin,
        i.status as status_izin,
        i.dokumen_pendukung,
        CASE 
          WHEN p.izin_id IS NOT NULL THEN 
            CASE i.jenis
              WHEN 'cuti' THEN 'Cuti'
              WHEN 'sakit' THEN 'Sakit' 
              WHEN 'izin' THEN 'Izin'
              WHEN 'dinas_luar' THEN 'Dinas Luar'
              ELSE 'Izin'
            END
          WHEN p.status_masuk = 'Tepat Waktu' THEN 'Hadir'
          WHEN p.status_masuk = 'Terlambat' THEN 'Hadir (Terlambat)'
          WHEN p.status_masuk = 'Terlambat Berat' THEN 'Hadir (Terlambat Berat)'
          WHEN p.status_masuk = 'Tanpa Keterangan' OR p.status_masuk IS NULL THEN 'Tanpa Keterangan'
          ELSE 'Tidak Hadir'
        END as status_kehadiran,
        
        -- Info hari
        DAYNAME(p.tanggal) as nama_hari,
        hl.nama_libur,
        hk.keterangan as keterangan_hari_kerja
        
       FROM presensi p
       LEFT JOIN izin i ON p.izin_id = i.id
       LEFT JOIN hari_libur hl ON p.tanggal = hl.tanggal
       LEFT JOIN hari_kerja hk ON p.tanggal = hk.tanggal
       WHERE p.user_id = ? AND p.tanggal BETWEEN ? AND ?
       ORDER BY p.tanggal`,
      [targetUserId, startDate, endDate]
    );

    // Get info user
    const [user] = await pool.execute(
      'SELECT id, nama, jabatan, wilayah_penugasan, no_hp FROM users WHERE id = ?',
      [targetUserId]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Generate calendar days untuk bulan tersebut
    const daysInMonth = DateTime.fromObject({ 
      year: targetTahun, 
      month: targetBulan 
    }).daysInMonth;

    const calendarDays = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${targetTahun}-${targetBulan.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const dateTime = DateTime.fromISO(date);
      const dayOfWeek = dateTime.weekday; // 1 = Senin, 7 = Minggu
      
      const presensiHariIni = detailPresensi.find(p => 
        DateTime.fromJSDate(p.tanggal).toISODate() === date
      );
      
      // Cek apakah hari libur atau hari kerja khusus
      const [hariInfo] = await pool.execute(
        `SELECT 
          hl.nama_libur,
          hk.keterangan,
          hk.is_hari_kerja
         FROM (SELECT ? as tanggal) d
         LEFT JOIN hari_libur hl ON d.tanggal = hl.tanggal
         LEFT JOIN hari_kerja hk ON d.tanggal = hk.tanggal`,
        [date]
      );

      let status = 'Belum Ada Data';
      let keterangan = '';
      let isHariKerja = true;
      
      if (hariInfo[0].nama_libur) {
        status = 'Libur';
        keterangan = hariInfo[0].nama_libur;
        isHariKerja = false;
      } else if (hariInfo[0].keterangan) {
        status = hariInfo[0].is_hari_kerja ? 'Hari Kerja Khusus' : 'Libur Khusus';
        keterangan = hariInfo[0].keterangan;
        isHariKerja = hariInfo[0].is_hari_kerja;
      } else if (dayOfWeek === 6 || dayOfWeek === 7) {
        status = 'Weekend';
        isHariKerja = false;
      } else {
        status = 'Hari Kerja';
        isHariKerja = true;
      }

      // Override dengan data presensi jika ada
      if (presensiHariIni) {
        status = presensiHariIni.status_kehadiran;
        keterangan = presensiHariIni.keterangan || presensiHariIni.keterangan_izin || keterangan;
      }

      calendarDays.push({
        tanggal: date,
        hari: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dateTime.weekday - 1],
        status: status,
        keterangan: keterangan,
        jam_masuk: presensiHariIni?.jam_masuk || null,
        jam_pulang: presensiHariIni?.jam_pulang || null,
        is_lembur: presensiHariIni?.is_lembur || 0,
        jam_lembur: presensiHariIni?.jam_lembur || null,
        is_hari_kerja: isHariKerja,
        is_weekend: dayOfWeek === 6 || dayOfWeek === 7
      });
    }

    // Hitung rekap user
    const rekapUser = {
      hadir: detailPresensi.filter(p => 
        p.status_masuk === 'Tepat Waktu' || p.status_masuk === 'Terlambat' || p.status_masuk === 'Terlambat Berat'
      ).length,
      tepat_waktu: detailPresensi.filter(p => p.status_masuk === 'Tepat Waktu').length,
      terlambat: detailPresensi.filter(p => 
        p.status_masuk === 'Terlambat' || p.status_masuk === 'Terlambat Berat'
      ).length,
      izin: detailPresensi.filter(p => p.izin_id).length,
      sakit: detailPresensi.filter(p => p.jenis_izin === 'sakit').length,
      cuti: detailPresensi.filter(p => p.jenis_izin === 'cuti').length,
      tanpa_keterangan: detailPresensi.filter(p => 
        p.status_masuk === 'Tanpa Keterangan' || p.status_masuk === null
      ).length,
      lembur: detailPresensi.filter(p => p.is_lembur).length
    };

    res.json({
      success: true,
      data: {
        user: user[0],
        periode: {
          bulan: parseInt(targetBulan),
          tahun: parseInt(targetTahun),
          nama_bulan: DateTime.fromObject({ month: targetBulan }).setLocale('id').toFormat('MMMM'),
          start_date: startDate,
          end_date: endDate
        },
        rekap: rekapUser,
        detail_harian: calendarDays,
        presensi: detailPresensi
      }
    });

  } catch (error) {
    console.error('Get detail kehadiran user error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getRekapHarian = async (req, res) => {
  try {
    const { tanggal } = req.query;

    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal wajib diisi (format: YYYY-MM-DD)'
      });
    }

    // Validasi format tanggal
    if (!DateTime.fromISO(tanggal).isValid) {
      return res.status(400).json({
        success: false,
        message: 'Format tanggal tidak valid. Gunakan format: YYYY-MM-DD'
      });
    }

    const [rekapHarian] = await pool.execute(
      `SELECT 
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        u.no_hp,
        p.tanggal,
        p.jam_masuk,
        p.jam_pulang,
        p.status_masuk,
        p.status_pulang,
        p.is_lembur,
        p.jam_lembur,
        p.keterangan,
        p.foto_masuk,
        p.foto_pulang,
        i.jenis as jenis_izin,
        i.keterangan as keterangan_izin,
        CASE 
          WHEN p.izin_id IS NOT NULL THEN 
            CONCAT('Izin ', UPPER(SUBSTRING(i.jenis, 1, 1)), LOWER(SUBSTRING(i.jenis, 2)))
          WHEN p.status_masuk = 'Tepat Waktu' THEN 'Hadir'
          WHEN p.status_masuk = 'Terlambat' THEN 'Terlambat'
          WHEN p.status_masuk = 'Terlambat Berat' THEN 'Terlambat Berat'
          WHEN p.status_masuk = 'Tanpa Keterangan' OR p.status_masuk IS NULL THEN 'Tanpa Keterangan'
          ELSE 'Belum Presensi'
        END as status_kehadiran
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id AND p.tanggal = ?
       LEFT JOIN izin i ON p.izin_id = i.id
       WHERE u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY u.nama`,
      [tanggal]
    );

    // Hitung statistik
    const totalPegawai = rekapHarian.length;
    const hadir = rekapHarian.filter(r => r.status_kehadiran === 'Hadir').length;
    const terlambat = rekapHarian.filter(r => 
      r.status_kehadiran === 'Terlambat' || r.status_kehadiran === 'Terlambat Berat'
    ).length;
    const izin = rekapHarian.filter(r => r.status_kehadiran.includes('Izin')).length;
    const tanpaKeterangan = rekapHarian.filter(r => r.status_kehadiran === 'Tanpa Keterangan').length;
    const belumPresensi = rekapHarian.filter(r => 
      !r.jam_masuk && !r.izin_id && r.status_kehadiran === 'Belum Presensi'
    ).length;
    const lembur = rekapHarian.filter(r => r.is_lembur).length;

    // Cek info hari
    const [hariInfo] = await pool.execute(
      `SELECT 
        hl.nama_libur,
        hk.keterangan,
        hk.is_hari_kerja,
        DAYNAME(?) as nama_hari
       FROM (SELECT ? as tanggal) d
       LEFT JOIN hari_libur hl ON d.tanggal = hl.tanggal
       LEFT JOIN hari_kerja hk ON d.tanggal = hk.tanggal`,
      [tanggal, tanggal]
    );

    const infoHari = {
      tanggal: tanggal,
      nama_hari: hariInfo[0].nama_hari,
      is_libur: !!hariInfo[0].nama_libur,
      is_hari_kerja_khusus: !!hariInfo[0].keterangan,
      keterangan: hariInfo[0].nama_libur || hariInfo[0].keterangan || null
    };

    res.json({
      success: true,
      data: {
        info_hari: infoHari,
        statistik: {
          total_pegawai: totalPegawai,
          hadir: hadir,
          terlambat: terlambat,
          izin: izin,
          tanpa_keterangan: tanpaKeterangan,
          belum_presensi: belumPresensi,
          lembur: lembur,
          persentase_kehadiran: totalPegawai > 0 ? 
            (((hadir + terlambat + izin) / totalPegawai) * 100).toFixed(2) : 0
        },
        detail: rekapHarian
      }
    });

  } catch (error) {
    console.error('Get rekap harian error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getRekapKehadiran,
  getDetailKehadiranUser,
  getRekapHarian
};