const { pool } = require('../config/database');

const getAllAktivitasPegawai = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      start_date, 
      end_date, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT 
        a.*,
        u.nama as user_nama,
        u.username as user_username,
        u.jabatan as user_jabatan,
        u.wilayah_penugasan as user_wilayah
      FROM aktivitas_pekerja a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.user_id = ?
    `;
    
    let countQuery = `
      SELECT COUNT(*) as total
      FROM aktivitas_pekerja a
      WHERE a.user_id = ?
    `;
    
    const params = [userId];
    const countParams = [userId];

    // Date filtering
    if (start_date && end_date) {
      query += ' AND a.tanggal BETWEEN ? AND ?';
      countQuery += ' AND a.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
      countParams.push(start_date, end_date);
    } else if (start_date) {
      query += ' AND a.tanggal >= ?';
      countQuery += ' AND a.tanggal >= ?';
      params.push(start_date);
      countParams.push(start_date);
    } else if (end_date) {
      query += ' AND a.tanggal <= ?';
      countQuery += ' AND a.tanggal <= ?';
      params.push(end_date);
      countParams.push(end_date);
    }

    // Search filtering
    if (search) {
      query += ' AND (a.kegiatan LIKE ? OR a.lokasi LIKE ? OR a.wilayah LIKE ?)';
      countQuery += ' AND (a.kegiatan LIKE ? OR a.lokasi LIKE ? OR a.wilayah LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY a.tanggal DESC, a.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    // Execute queries
    const [aktivitas] = await pool.execute(query, params);
    const [countResult] = await pool.execute(countQuery, countParams);
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);

    res.json({
      success: true,
      data: aktivitas,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages
      }
    });

  } catch (error) {
    console.error('Get all aktivitas pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getAktivitasDetailPegawai = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [aktivitas] = await pool.execute(
      `SELECT 
        a.*,
        u.nama as user_nama,
        u.username as user_username,
        u.jabatan as user_jabatan,
        u.wilayah_penugasan as user_wilayah,
        u.jenis_kelamin as user_jenis_kelamin,
        u.no_hp as user_no_hp,
        u.alamat as user_alamat
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = ? AND a.user_id = ?`,
      [id, userId]
    );

    if (aktivitas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data aktivitas tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: aktivitas[0]
    });

  } catch (error) {
    console.error('Get aktivitas detail pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createAktivitasPegawai = async (req, res) => {
  try {
    const userId = req.user.id;
    const { tanggal, wilayah, lokasi, durasi, kegiatan } = req.body;

    // Validasi required fields
    if (!tanggal || !kegiatan) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal dan kegiatan wajib diisi'
      });
    }

    // Cek apakah user aktif
    const [users] = await pool.execute(
      'SELECT nama, is_active FROM users WHERE id = ?', 
      [userId]
    );
    
    if (users.length === 0 || !users[0].is_active) {
      return res.status(400).json({
        success: false,
        message: 'Akun tidak aktif, tidak dapat menambahkan aktivitas'
      });
    }

    // Insert aktivitas
    const [result] = await pool.execute(
      `INSERT INTO aktivitas_pekerja 
       (user_id, tanggal, wilayah, lokasi, durasi, kegiatan) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, tanggal, wilayah, lokasi, durasi, kegiatan]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_AKTIVITAS', `Pegawai menambahkan aktivitas: ${kegiatan}`, userId]
    );

    // Get created data
    const [createdAktivitas] = await pool.execute(
      `SELECT 
        a.*,
        u.nama as user_nama,
        u.jabatan as user_jabatan
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Aktivitas berhasil ditambahkan',
      data: createdAktivitas[0]
    });

  } catch (error) {
    console.error('Create aktivitas pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateAktivitasPegawai = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { tanggal, wilayah, lokasi, durasi, kegiatan } = req.body;

    // Cek apakah aktivitas exists dan milik user
    const [aktivitas] = await pool.execute(
      `SELECT a.* 
       FROM aktivitas_pekerja a 
       WHERE a.id = ? AND a.user_id = ?`,
      [id, userId]
    );

    if (aktivitas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data aktivitas tidak ditemukan'
      });
    }

    // Update aktivitas
    await pool.execute(
      `UPDATE aktivitas_pekerja 
       SET tanggal = ?, wilayah = ?, lokasi = ?, durasi = ?, kegiatan = ?, updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [tanggal, wilayah, lokasi, durasi, kegiatan, id, userId]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_AKTIVITAS', `Pegawai mengupdate aktivitas ID: ${id}`, userId]
    );

    // Get updated data
    const [updatedAktivitas] = await pool.execute(
      `SELECT 
        a.*,
        u.nama as user_nama,
        u.jabatan as user_jabatan
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: 'Aktivitas berhasil diupdate',
      data: updatedAktivitas[0]
    });

  } catch (error) {
    console.error('Update aktivitas pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteAktivitasPegawai = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cek apakah aktivitas exists dan milik user
    const [aktivitas] = await pool.execute(
      `SELECT a.* 
       FROM aktivitas_pekerja a 
       WHERE a.id = ? AND a.user_id = ?`,
      [id, userId]
    );

    if (aktivitas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data aktivitas tidak ditemukan'
      });
    }

    // Delete aktivitas
    await pool.execute(
      'DELETE FROM aktivitas_pekerja WHERE id = ? AND user_id = ?', 
      [id, userId]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_AKTIVITAS', `Pegawai menghapus aktivitas ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Aktivitas berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete aktivitas pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getAktivitasStatsPegawai = async (req, res) => {
  try {
    const userId = req.user.id;
    const { start_date, end_date } = req.query;

    let dateCondition = '';
    const params = [userId];

    if (start_date && end_date) {
      dateCondition = 'AND tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    // Total statistics
    const [totalStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_aktivitas,
        SUM(TIME_TO_SEC(durasi)) as total_durasi_detik,
        AVG(TIME_TO_SEC(durasi)) as avg_durasi_detik,
        MIN(tanggal) as tanggal_pertama,
        MAX(tanggal) as tanggal_terakhir
       FROM aktivitas_pekerja 
       WHERE user_id = ? ${dateCondition}`,
      params
    );

    // Activity by wilayah
    const [wilayahStats] = await pool.execute(
      `SELECT 
        wilayah,
        COUNT(*) as total_aktivitas,
        SUM(TIME_TO_SEC(durasi)) as total_durasi_detik
       FROM aktivitas_pekerja
       WHERE user_id = ? ${dateCondition}
       GROUP BY wilayah
       ORDER BY total_aktivitas DESC`,
      params
    );

    // Recent activities
    const [recentActivities] = await pool.execute(
      `SELECT 
        a.*,
        u.nama as user_nama,
        u.jabatan as user_jabatan
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.user_id = ? ${dateCondition}
       ORDER BY a.created_at DESC
       LIMIT 5`,
      params
    );

    // Weekly activity
    const [weeklyStats] = await pool.execute(
      `SELECT 
        YEARWEEK(tanggal) as week,
        COUNT(*) as total_aktivitas,
        SUM(TIME_TO_SEC(durasi)) as total_durasi_detik
       FROM aktivitas_pekerja
       WHERE user_id = ? AND tanggal >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
       GROUP BY YEARWEEK(tanggal)
       ORDER BY week DESC
       LIMIT 8`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        summary: totalStats[0],
        wilayah_stats: wilayahStats,
        recent_activities: recentActivities,
        weekly_stats: weeklyStats
      }
    });

  } catch (error) {
    console.error('Get aktivitas stats pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getProfilePegawai = async (req, res) => {
  try {
    const userId = req.user.id;

    const [users] = await pool.execute(
      `SELECT 
        id, nama, username, email, jabatan, 
        wilayah_penugasan, jenis_kelamin, no_hp, alamat,
        created_at, updated_at
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data profil tidak ditemukan'
      });
    }

    // Get total aktivitas
    const [stats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_aktivitas,
        SUM(TIME_TO_SEC(durasi)) as total_durasi_detik
       FROM aktivitas_pekerja 
       WHERE user_id = ?`,
      [userId]
    );

    const userProfile = users[0];
    userProfile.total_aktivitas = stats[0].total_aktivitas;
    userProfile.total_durasi_detik = stats[0].total_durasi_detik;

    res.json({
      success: true,
      data: userProfile
    });

  } catch (error) {
    console.error('Get profile pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateProfilePegawai = async (req, res) => {
  try {
    const userId = req.user.id;
    const { nama, email, no_hp, alamat } = req.body;

    // Update profile
    await pool.execute(
      `UPDATE users 
       SET nama = ?, email = ?, no_hp = ?, alamat = ?, updated_at = NOW()
       WHERE id = ?`,
      [nama, email, no_hp, alamat, userId]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_PROFILE', 'Pegawai mengupdate profil', userId]
    );

    // Get updated profile
    const [updatedUser] = await pool.execute(
      `SELECT 
        id, nama, username, email, jabatan, 
        wilayah_penugasan, jenis_kelamin, no_hp, alamat,
        created_at, updated_at
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'Profil berhasil diupdate',
      data: updatedUser[0]
    });

  } catch (error) {
    console.error('Update profile pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getAllAktivitasPegawai,
  getAktivitasDetailPegawai,
  createAktivitasPegawai,
  updateAktivitasPegawai,
  deleteAktivitasPegawai,
  getAktivitasStatsPegawai,
  getProfilePegawai,
  updateProfilePegawai
};