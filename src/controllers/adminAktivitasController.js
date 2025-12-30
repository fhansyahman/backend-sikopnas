// controllers/adminAktivitasController.js
const { pool } = require('../config/database');

const getAllAktivitasAdmin = async (req, res) => {
  try {
    const { 
      start_date, 
      end_date, 
      user_id, 
      wilayah, 
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
        u.wilayah_penugasan as user_wilayah,
        u.is_active as user_status
      FROM aktivitas_pekerja a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    
    let countQuery = `
      SELECT COUNT(*) as total
      FROM aktivitas_pekerja a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    
    const params = [];
    const countParams = [];

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

    // User ID filtering
    if (user_id) {
      query += ' AND a.user_id = ?';
      countQuery += ' AND a.user_id = ?';
      params.push(user_id);
      countParams.push(user_id);
    }

    // Wilayah filtering
    if (wilayah) {
      query += ' AND (a.wilayah LIKE ? OR u.wilayah_penugasan LIKE ?)';
      countQuery += ' AND (a.wilayah LIKE ? OR u.wilayah_penugasan LIKE ?)';
      const wilayahTerm = `%${wilayah}%`;
      params.push(wilayahTerm, wilayahTerm);
      countParams.push(wilayahTerm, wilayahTerm);
    }

    // Search filtering
    if (search) {
      query += ' AND (u.nama LIKE ? OR a.kegiatan LIKE ? OR a.lokasi LIKE ?)';
      countQuery += ' AND (u.nama LIKE ? OR a.kegiatan LIKE ? OR a.lokasi LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    // FIX: Gunakan template literal untuk LIMIT dan OFFSET
    query += ` ORDER BY a.tanggal DESC, a.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;

    console.log('Executing query with params:', params);
    console.log('Final query:', query);

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
    console.error('Get all aktivitas admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
const getAktivitasDetailAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    const [aktivitas] = await pool.execute(
      `SELECT 
        a.*,
        u.nama as user_nama,
        u.username as user_username,
        u.jabatan as user_jabatan,
        u.wilayah_penugasan as user_wilayah,
        u.jenis_kelamin as user_jenis_kelamin,
        u.no_hp as user_no_hp,
        u.alamat as user_alamat,
        u.is_active as user_status
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.id = ?`,
      [id]
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
    console.error('Get aktivitas detail admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createAktivitasAdmin = async (req, res) => {
  try {
    const { user_id, tanggal, wilayah, lokasi, durasi, kegiatan } = req.body;
    const adminId = req.user.id;

    // Validasi required fields
    if (!user_id || !tanggal || !kegiatan) {
      return res.status(400).json({
        success: false,
        message: 'User ID, tanggal, dan kegiatan wajib diisi'
      });
    }

    // Cek apakah user exists dan aktif
    const [users] = await pool.execute(
      'SELECT nama, is_active FROM users WHERE id = ?', 
      [user_id]
    );
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = users[0];
    
    if (!user.is_active) {
      return res.status(400).json({
        success: false,
        message: 'User tidak aktif, tidak dapat menambahkan aktivitas'
      });
    }

    // Insert aktivitas
    const [result] = await pool.execute(
      `INSERT INTO aktivitas_pekerja 
       (user_id, tanggal, wilayah, lokasi, durasi, kegiatan) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, tanggal, wilayah, lokasi, durasi, kegiatan]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_AKTIVITAS_ADMIN', `Admin menambahkan aktivitas untuk ${user.nama}`, adminId]
    );

    // Get created data dengan join
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
    console.error('Create aktivitas admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateAktivitasAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { tanggal, wilayah, lokasi, durasi, kegiatan } = req.body;
    const adminId = req.user.id;

    // Cek apakah aktivitas exists
    const [aktivitas] = await pool.execute(
      `SELECT a.*, u.nama 
       FROM aktivitas_pekerja a 
       LEFT JOIN users u ON a.user_id = u.id 
       WHERE a.id = ?`,
      [id]
    );

    if (aktivitas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data aktivitas tidak ditemukan'
      });
    }

    const aktivitasData = aktivitas[0];

    // Update aktivitas
    await pool.execute(
      `UPDATE aktivitas_pekerja 
       SET tanggal = ?, wilayah = ?, lokasi = ?, durasi = ?, kegiatan = ?, updated_at = NOW()
       WHERE id = ?`,
      [tanggal, wilayah, lokasi, durasi, kegiatan, id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_AKTIVITAS_ADMIN', `Admin mengupdate aktivitas untuk ${aktivitasData.nama}`, adminId]
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
    console.error('Update aktivitas admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteAktivitasAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    // Cek apakah aktivitas exists
    const [aktivitas] = await pool.execute(
      `SELECT a.*, u.nama 
       FROM aktivitas_pekerja a 
       LEFT JOIN users u ON a.user_id = u.id 
       WHERE a.id = ?`,
      [id]
    );

    if (aktivitas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data aktivitas tidak ditemukan'
      });
    }

    const aktivitasData = aktivitas[0];

    // Delete aktivitas
    await pool.execute('DELETE FROM aktivitas_pekerja WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_AKTIVITAS_ADMIN', `Admin menghapus aktivitas untuk ${aktivitasData.nama}`, adminId]
    );

    res.json({
      success: true,
      message: 'Aktivitas berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete aktivitas admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const bulkDeleteAktivitas = async (req, res) => {
  try {
    const { ids } = req.body;
    const adminId = req.user.id;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'ID aktivitas harus berupa array'
      });
    }

    // Cek apakah semua aktivitas exists
    const placeholders = ids.map(() => '?').join(',');
    const [aktivitas] = await pool.execute(
      `SELECT a.id, u.nama 
       FROM aktivitas_pekerja a 
       LEFT JOIN users u ON a.user_id = u.id 
       WHERE a.id IN (${placeholders})`,
      ids
    );

    if (aktivitas.length !== ids.length) {
      return res.status(404).json({
        success: false,
        message: 'Beberapa data aktivitas tidak ditemukan'
      });
    }

    // Delete aktivitas
    await pool.execute(
      `DELETE FROM aktivitas_pekerja WHERE id IN (${placeholders})`,
      ids
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['BULK_DELETE_AKTIVITAS', `Admin menghapus ${ids.length} aktivitas`, adminId]
    );

    res.json({
      success: true,
      message: `${ids.length} aktivitas berhasil dihapus`
    });

  } catch (error) {
    console.error('Bulk delete aktivitas error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getAktivitasStatsAdmin = async (req, res) => {
  try {
    const { start_date, end_date, group_by = 'daily' } = req.query;

    let dateCondition = '';
    const params = [];

    if (start_date && end_date) {
      dateCondition = 'WHERE tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    // Total statistics
    const [totalStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_aktivitas,
        COUNT(DISTINCT user_id) as total_pegawai,
        SUM(TIME_TO_SEC(durasi)) as total_durasi_detik,
        AVG(TIME_TO_SEC(durasi)) as avg_durasi_detik
       FROM aktivitas_pekerja ${dateCondition}`,
      params
    );

    // Top performers
    const [topPerformers] = await pool.execute(
      `SELECT 
        u.id,
        u.nama,
        u.jabatan,
        COUNT(a.id) as total_aktivitas,
        SUM(TIME_TO_SEC(a.durasi)) as total_durasi_detik,
        AVG(TIME_TO_SEC(a.durasi)) as avg_durasi_detik
       FROM users u
       LEFT JOIN aktivitas_pekerja a ON u.id = a.user_id ${dateCondition ? 'AND a.' + dateCondition.replace('WHERE', '') : ''}
       WHERE u.roles != 'admin' AND u.is_active = 1
       GROUP BY u.id, u.nama, u.jabatan
       ORDER BY total_aktivitas DESC
       LIMIT 10`,
      dateCondition ? params : []
    );

    // Activity by wilayah
    const [wilayahStats] = await pool.execute(
      `SELECT 
        COALESCE(a.wilayah, u.wilayah_penugasan, 'Tidak ditentukan') as wilayah,
        COUNT(a.id) as total_aktivitas,
        COUNT(DISTINCT a.user_id) as total_pegawai,
        SUM(TIME_TO_SEC(a.durasi)) as total_durasi_detik
       FROM aktivitas_pekerja a
       LEFT JOIN users u ON a.user_id = u.id
       ${dateCondition}
       GROUP BY COALESCE(a.wilayah, u.wilayah_penugasan, 'Tidak ditentukan')
       ORDER BY total_aktivitas DESC`,
      params
    );

    // Activity trend (daily/weekly/monthly)
    let groupByQuery = '';
    let dateFormat = '';
    
    switch (group_by) {
      case 'weekly':
        groupByQuery = 'YEARWEEK(tanggal)';
        dateFormat = 'Week %v, %Y';
        break;
      case 'monthly':
        groupByQuery = 'DATE_FORMAT(tanggal, "%Y-%m")';
        dateFormat = '%M %Y';
        break;
      default: // daily
        groupByQuery = 'tanggal';
        dateFormat = '%e %M %Y';
    }

    const [trendStats] = await pool.execute(
      `SELECT 
        ${groupByQuery} as period,
        DATE_FORMAT(MIN(tanggal), '${dateFormat}') as period_label,
        COUNT(*) as total_aktivitas,
        COUNT(DISTINCT user_id) as total_pegawai
       FROM aktivitas_pekerja
       ${dateCondition}
       GROUP BY ${groupByQuery}
       ORDER BY period DESC
       LIMIT 30`,
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
       ${dateCondition}
       ORDER BY a.created_at DESC
       LIMIT 5`,
      params
    );

    res.json({
      success: true,
      data: {
        summary: totalStats[0],
        top_performers: topPerformers,
        wilayah_stats: wilayahStats,
        trend_stats: trendStats,
        recent_activities: recentActivities
      }
    });

  } catch (error) {
    console.error('Get aktivitas stats admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const exportAktivitas = async (req, res) => {
  try {
    const { start_date, end_date, user_id, wilayah, format = 'json' } = req.query;

    let query = `
      SELECT 
        a.id,
        u.nama as pegawai,
        u.jabatan,
        u.wilayah_penugasan,
        a.tanggal,
        a.wilayah as wilayah_aktivitas,
        a.lokasi,
        a.durasi,
        a.kegiatan,
        a.created_at
      FROM aktivitas_pekerja a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ' AND a.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (user_id) {
      query += ' AND a.user_id = ?';
      params.push(user_id);
    }

    if (wilayah) {
      query += ' AND (a.wilayah LIKE ? OR u.wilayah_penugasan LIKE ?)';
      const wilayahTerm = `%${wilayah}%`;
      params.push(wilayahTerm, wilayahTerm);
    }

    query += ' ORDER BY a.tanggal DESC, a.created_at DESC';

    const [aktivitas] = await pool.execute(query, params);

    if (format === 'csv') {
      // Convert to CSV
      const headers = ['ID', 'Pegawai', 'Jabatan', 'Wilayah Penugasan', 'Tanggal', 'Wilayah Aktivitas', 'Lokasi', 'Durasi', 'Kegiatan', 'Dibuat Pada'];
      const csvData = aktivitas.map(item => [
        item.id,
        `"${item.pegawai}"`,
        `"${item.jabatan}"`,
        `"${item.wilayah_penugasan}"`,
        item.tanggal,
        `"${item.wilayah_aktivitas}"`,
        `"${item.lokasi}"`,
        item.durasi,
        `"${item.kegiatan}"`,
        item.created_at
      ]);

      const csvContent = [
        headers.join(','),
        ...csvData.map(row => row.join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=aktivitas-${new Date().toISOString().split('T')[0]}.csv`);
      return res.send(csvContent);
    }

    // Default JSON response
    res.json({
      success: true,
      data: aktivitas,
      export_info: {
        total_records: aktivitas.length,
        exported_at: new Date().toISOString(),
        filters: { start_date, end_date, user_id, wilayah }
      }
    });

  } catch (error) {
    console.error('Export aktivitas error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getAllAktivitasAdmin,
  getAktivitasDetailAdmin,
  createAktivitasAdmin,
  updateAktivitasAdmin,
  deleteAktivitasAdmin,
  bulkDeleteAktivitas,
  getAktivitasStatsAdmin,
  exportAktivitas
};