const { pool } = require('../config/database');
const { DateTime } = require('luxon');

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
    const dateTime = DateTime.fromISO(tanggal);
    const dayOfWeek = dateTime.weekday; // 1 = Senin, 7 = Minggu
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Senin-Jumat

    return {
      is_hari_kerja: isWeekday,
      keterangan: isWeekday ? 'Hari kerja normal' : 'Weekend',
      source: 'default'
    };
  } catch (error) {
    console.error('Error checking hari kerja:', error);
    return {
      is_hari_kerja: false,
      keterangan: 'Error checking hari kerja',
      source: 'error'
    };
  }
};

const getHariKerjaInRange = async (startDate, endDate) => {
  try {
    const [days] = await pool.execute(
      `SELECT dates.tanggal, 
              hl.nama_libur,
              hk.keterangan as keterangan_hari_kerja,
              hk.is_hari_kerja,
              CASE 
                WHEN hl.id IS NOT NULL THEN false
                WHEN hk.id IS NOT NULL THEN hk.is_hari_kerja = 1
                ELSE DAYOFWEEK(dates.tanggal) BETWEEN 2 AND 6
              END as is_hari_kerja_result
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
       ORDER BY dates.tanggal`,
      [startDate, startDate, endDate]
    );

    return days;
  } catch (error) {
    console.error('Error getting hari kerja in range:', error);
    return [];
  }
};

module.exports = {
  checkHariKerja,
  getHariKerjaInRange
};