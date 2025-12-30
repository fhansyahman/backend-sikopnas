const { pool } = require('../config/database');

// Get all presensi dengan filter
const getAllPresensi = async (req, res) => {
  try {
    const { tanggal, bulan, tahun, user_id } = req.query;
    
    let query = `
      SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
             jk.jam_masuk_standar, jk.jam_pulang_standar
      FROM presensi p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
      WHERE 1=1
    `;
    const params = [];

    if (tanggal) {
      query += ' AND p.tanggal = ?';
      params.push(tanggal);
    }

    if (bulan && tahun) {
      query += ' AND MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?';
      params.push(bulan, tahun);
    }

    if (user_id) {
      query += ' AND p.user_id = ?';
      params.push(user_id);
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

// Get presensi by ID
const getPresensiById = async (req, res) => {
  try {
    const { id } = req.params;

    const [presensi] = await pool.execute(
      `SELECT p.*, u.nama, u.jabatan, u.wilayah_penugasan,
              jk.jam_masuk_standar, jk.jam_pulang_standar
       FROM presensi p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE p.id = ?`,
      [id]
    );

    if (presensi.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: presensi[0]
    });

  } catch (error) {
    console.error('Get presensi by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Update presensi manual (admin)
const updatePresensi = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;
    const { 
      jam_masuk, 
      jam_pulang, 
      status_masuk, 
      status_pulang, 
      keterangan,
      is_lembur,
      jam_lembur 
    } = req.body;

    // Check if presensi exists
    const [presensi] = await pool.execute(
      'SELECT * FROM presensi WHERE id = ?',
      [id]
    );

    if (presensi.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // Update presensi
    await pool.execute(
      `UPDATE presensi 
       SET jam_masuk = ?, jam_pulang = ?, status_masuk = ?, status_pulang = ?,
           is_lembur = ?, jam_lembur = ?, keterangan = ?, updated_at = NOW()
       WHERE id = ?`,
      [jam_masuk, jam_pulang, status_masuk, status_pulang, 
       is_lembur ? 1 : 0, jam_lembur, keterangan, id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_PRESENSI', `Admin mengupdate presensi ID ${id}`, adminId]
    );

    res.json({
      success: true,
      message: 'Data presensi berhasil diupdate'
    });

  } catch (error) {
    console.error('Update presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Delete presensi
const deletePresensi = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { id } = req.params;

    // Check if presensi exists
    const [presensi] = await pool.execute(
      'SELECT * FROM presensi WHERE id = ?',
      [id]
    );

    if (presensi.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data presensi tidak ditemukan'
      });
    }

    // Delete presensi
    await pool.execute('DELETE FROM presensi WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_PRESENSI', `Admin menghapus presensi ID ${id}`, adminId]
    );

    res.json({
      success: true,
      message: 'Data presensi berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Generate presensi kosong untuk hari ini
const generatePresensiHariIni = async (req, res) => {
  try {
    const adminId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get all active users
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE is_active = 1 AND status = "Aktif"'
    );

    let generatedCount = 0;

    // Generate presensi untuk setiap user
    for (const user of users) {
      // Check if presensi already exists for today
      const [existing] = await pool.execute(
        'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
        [user.id, today]
      );

      if (existing.length === 0) {
        await pool.execute(
          `INSERT INTO presensi 
           (user_id, tanggal, status_masuk, status_pulang, is_system_generated) 
           VALUES (?, ?, 'Tanpa Keterangan', 'Belum Pulang', 1)`,
          [user.id, today]
        );
        generatedCount++;
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id, records_affected) VALUES (?, ?, ?, ?)',
      ['GENERATE_PRESENSI', `Admin generate presensi kosong untuk hari ini`, adminId, generatedCount]
    );

    res.json({
      success: true,
      message: `Berhasil generate ${generatedCount} presensi kosong untuk hari ini`,
      data: {
        generated_count: generatedCount
      }
    });

  } catch (error) {
    console.error('Generate presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get statistik presensi
const getStatistikPresensi = async (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    
    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();

    // Statistik per user
    const [statistik] = await pool.execute(
      `SELECT 
        u.id,
        u.nama,
        u.jabatan,
        u.wilayah_penugasan,
        COUNT(p.id) as total_hari,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_tanpa_keterangan,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur
       FROM users u
       LEFT JOIN presensi p ON u.id = p.user_id 
         AND MONTH(p.tanggal) = ? 
         AND YEAR(p.tanggal) = ?
       WHERE u.is_active = 1 AND u.status = 'Aktif'
       GROUP BY u.id, u.nama, u.jabatan, u.wilayah_penugasan
       ORDER BY u.nama ASC`,
      [targetBulan, targetTahun]
    );

    // Statistik keseluruhan
    const [overall] = await pool.execute(
      `SELECT 
        COUNT(DISTINCT p.user_id) as total_pegawai,
        COUNT(p.id) as total_presensi,
        SUM(CASE WHEN p.jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN p.status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
        SUM(CASE WHEN p.status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_tanpa_keterangan,
        SUM(CASE WHEN p.is_lembur = 1 THEN 1 ELSE 0 END) as total_lembur
       FROM presensi p
       WHERE MONTH(p.tanggal) = ? AND YEAR(p.tanggal) = ?`,
      [targetBulan, targetTahun]
    );

    res.json({
      success: true,
      data: {
        statistik_per_user: statistik,
        statistik_overall: overall[0] || {}
      }
    });

  } catch (error) {
    console.error('Get statistik presensi error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getAllPresensi,
  getPresensiById,
  updatePresensi,
  deletePresensi,
  generatePresensiHariIni,
  getStatistikPresensi
};