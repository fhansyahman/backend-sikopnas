const { pool } = require('../config/database');
const { DateTime } = require('luxon');

const getDataForPemutihan = async (req, res) => {
  console.log('=== GET DATA PEMUTIHAN START ===');
  try {
    const { bulan, tahun, wilayah_id } = req.query;

    console.log('Query parameters:', { bulan, tahun, wilayah_id });

    // Validasi bulan dan tahun
    if (!bulan || !tahun) {
      return res.status(400).json({
        success: false,
        message: 'Bulan dan tahun wajib diisi'
      });
    }

    const bulanNum = parseInt(bulan);
    const tahunNum = parseInt(tahun);

    // Buat tanggal
    const startDate = `${tahunNum}-${bulanNum.toString().padStart(2, '0')}-01`;
    const endDate = DateTime.fromISO(startDate).endOf('month').toISODate();

    console.log('Date range:', { startDate, endDate });

    // Query data yang bisa diputihkan (alpha dan terlambat)
    let query = `
      SELECT 
        p.id as presensi_id,
        p.tanggal,
        p.jam_masuk,
        p.jam_pulang,
        p.status_masuk,
        p.status_pulang,
        p.keterangan,
        p.created_at,
        p.updated_at,
        u.id as user_id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        w.nama_wilayah,
        i.jenis as jenis_izin,
        i.status as status_izin
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN wilayah w ON u.wilayah_id = w.id
      LEFT JOIN izin i ON p.izin_id = i.id
      WHERE p.tanggal BETWEEN ? AND ?
        AND u.is_active = 1 
        AND u.roles = 'pegawai'
        AND (
          p.status_masuk = 'Tanpa Keterangan' 
          OR p.status_masuk = 'Terlambat'
        )
    `;

    const params = [startDate, endDate];

    if (wilayah_id && wilayah_id !== 'all') {
      query += ' AND u.wilayah_id = ?';
      params.push(wilayah_id);
    }

    query += ' ORDER BY p.tanggal DESC, u.nama ASC';

    console.log('Executing query...');
    const [data] = await pool.execute(query, params);
    console.log('Found records:', data.length);

    // Hitung statistik
    const stats = {
      total: data.length,
      tanpa_keterangan: data.filter(d => d.status_masuk === 'Tanpa Keterangan').length,
      terlambat: data.filter(d => d.status_masuk === 'Terlambat').length,
      dengan_izin: data.filter(d => d.izin_id).length
    };

    console.log('Stats:', stats);

    const response = {
      success: true,
      data: {
        presensi: data,
        stats,
        periode: {
          bulan: bulanNum,
          tahun: tahunNum,
          nama_bulan: DateTime.fromISO(startDate).setLocale('id').toFormat('MMMM yyyy')
        }
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in getDataForPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const prosesPemutihan = async (req, res) => {
  console.log('=== PROSES PEMUTIHAN START ===');
  try {
    const { presensi_ids, catatan_pemutihan, jenis_pemutihan } = req.body;

    console.log('Request body:', { presensi_ids, catatan_pemutihan, jenis_pemutihan });

    // Validasi
    if (!presensi_ids || !Array.isArray(presensi_ids) || presensi_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi wajib dipilih'
      });
    }

    if (!catatan_pemutihan) {
      return res.status(400).json({
        success: false,
        message: 'Catatan pemutihan wajib diisi'
      });
    }

    // Cek data presensi
    const placeholders = presensi_ids.map(() => '?').join(',');
    const [existingPresensi] = await pool.execute(
      `SELECT p.id, p.tanggal, u.nama, p.status_masuk
       FROM presensi p 
       JOIN users u ON p.user_id = u.id 
       WHERE p.id IN (${placeholders})`,
      presensi_ids
    );

    console.log('Existing presensi:', existingPresensi.length);

    if (existingPresensi.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // LANGSUNG UPDATE STATUS PRESENSI - TANPA KOLOM BARU
    const [result] = await pool.execute(
      `UPDATE presensi 
       SET 
         status_masuk = 'Tepat Waktu',
         status_pulang = CASE 
           WHEN status_pulang = 'Belum Pulang' THEN 'Tepat Waktu'
           ELSE status_pulang 
         END,
         keterangan = CONCAT(COALESCE(keterangan, ''), ' | PEMUTIHAN: ', ?),
         updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [catatan_pemutihan, ...presensi_ids]
    );

    console.log('Update result - affected rows:', result.affectedRows);

    // Log activity
    const namaUser = existingPresensi.map(p => p.nama).join(', ');
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      [
        'PEMUTIHAN_PRESENSI', 
        `Admin melakukan pemutihan ${result.affectedRows} data presensi: ${namaUser} - ${catatan_pemutihan}`,
        req.user.id
      ]
    );

    const response = {
      success: true,
      message: `Berhasil memutihkan ${result.affectedRows} data presensi`,
      data: {
        affected_rows: result.affectedRows,
        catatan_pemutihan
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in prosesPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const batalkanPemutihan = async (req, res) => {
  console.log('=== BATAL PEMUTIHAN START ===');
  try {
    const { presensi_ids, alasan_pembatalan } = req.body;

    console.log('Request body:', { presensi_ids, alasan_pembatalan });

    // Validasi
    if (!presensi_ids || !Array.isArray(presensi_ids) || presensi_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Data presensi wajib dipilih'
      });
    }

    if (!alasan_pembatalan) {
      return res.status(400).json({
        success: false,
        message: 'Alasan pembatalan wajib diisi'
      });
    }

    // Tidak perlu cek status khusus, langsung update saja
    const placeholders = presensi_ids.map(() => '?').join(',');
    
    // Kembalikan ke status default (Tanpa Keterangan)
    const [result] = await pool.execute(
      `UPDATE presensi 
       SET 
         status_masuk = 'Tanpa Keterangan',
         status_pulang = 'Belum Pulang',
         keterangan = CONCAT(COALESCE(keterangan, ''), ' | BATAL PEMUTIHAN: ', ?),
         updated_at = NOW()
       WHERE id IN (${placeholders})`,
      [alasan_pembatalan, ...presensi_ids]
    );

    console.log('Cancel result - affected rows:', result.affectedRows);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      [
        'BATAL_PEMUTIHAN', 
        `Admin membatalkan pemutihan ${result.affectedRows} data presensi - ${alasan_pembatalan}`,
        req.user.id
      ]
    );

    const response = {
      success: true,
      message: `Berhasil membatalkan ${result.affectedRows} data pemutihan`,
      data: {
        affected_rows: result.affectedRows,
        alasan_pembatalan
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Error in batalkanPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getRiwayatPemutihan = async (req, res) => {
  console.log('=== GET RIWAYAT PEMUTIHAN START ===');
  try {
    const { start_date, end_date, wilayah_id } = req.query;

    console.log('Query parameters:', { start_date, end_date, wilayah_id });

    // Riwayat = data yang status_masuk = 'Tepat Waktu' dan ada kata PEMUTIHAN di keterangan
    let query = `
      SELECT 
        p.id as presensi_id,
        p.tanggal,
        p.status_masuk,
        p.keterangan,
        p.updated_at as tanggal_pemutihan,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        w.nama_wilayah
      FROM presensi p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN wilayah w ON u.wilayah_id = w.id
      WHERE p.status_masuk = 'Tepat Waktu'
        AND p.keterangan LIKE '%PEMUTIHAN%'
    `;

    const params = [];

    if (start_date && end_date) {
      query += ' AND p.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (wilayah_id && wilayah_id !== 'all') {
      query += ' AND u.wilayah_id = ?';
      params.push(wilayah_id);
    }

    query += ' ORDER BY p.updated_at DESC, p.tanggal DESC';

    console.log('Executing riwayat query...');
    const [riwayat] = await pool.execute(query, params);
    console.log('Riwayat found:', riwayat.length);

    const response = {
      success: true,
      data: riwayat
    };

    res.json(response);

  } catch (error) {
    console.error('Error in getRiwayatPemutihan:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getDataForPemutihan,
  prosesPemutihan,
  batalkanPemutihan,
  getRiwayatPemutihan
};