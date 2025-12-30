const { pool } = require('../config/database');

// Get all users with their jam kerja (only for pegawai roles)
const getUsersWithJamKerja = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT 
        u.id, u.nama, u.username, u.jabatan, u.roles, u.wilayah_penugasan,
        u.jam_kerja_id, jk.nama_setting, jk.jam_masuk_standar, jk.jam_pulang_standar,
        jk.is_active as jam_kerja_aktif
       FROM users u
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY u.nama`
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get users with jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get available jam kerja options
const getAvailableJamKerja = async (req, res) => {
  try {
    const [jamKerja] = await pool.execute(
      `SELECT id, nama_setting, jam_masuk_standar, jam_pulang_standar, is_active
       FROM jam_kerja 
       ORDER BY is_active DESC, nama_setting`
    );

    res.json({
      success: true,
      data: jamKerja
    });

  } catch (error) {
    console.error('Get available jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Assign jam kerja to user (only for pegawai roles)
const assignJamKerjaToUser = async (req, res) => {
  try {
    const { user_id, jam_kerja_id } = req.body;

    // Validasi required fields
    if (!user_id || !jam_kerja_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID dan Jam Kerja ID wajib diisi'
      });
    }

    // Cek apakah user exists dan roles pegawai
    const [user] = await pool.execute(
      'SELECT nama, roles FROM users WHERE id = ? AND is_active = 1',
      [user_id]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan atau tidak aktif'
      });
    }

    // Validasi roles harus pegawai
    if (user[0].roles !== 'pegawai') {
      return res.status(400).json({
        success: false,
        message: 'Hanya user dengan roles pegawai yang dapat diassign jam kerja'
      });
    }

    // Cek apakah jam kerja exists
    const [jamKerja] = await pool.execute(
      'SELECT nama_setting FROM jam_kerja WHERE id = ?',
      [jam_kerja_id]
    );

    if (jamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jam kerja tidak ditemukan'
      });
    }

    // Update jam kerja user
    await pool.execute(
      'UPDATE users SET jam_kerja_id = ?, updated_at = NOW() WHERE id = ?',
      [jam_kerja_id, user_id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['ASSIGN_JAM_KERJA', `Admin assign jam kerja ${jamKerja[0].nama_setting} ke user ${user[0].nama}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Jam kerja berhasil diassign ke user'
    });

  } catch (error) {
    console.error('Assign jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Assign jam kerja to multiple users (bulk) - only for pegawai roles
const assignJamKerjaBulk = async (req, res) => {
  try {
    const { user_ids, jam_kerja_id } = req.body;

    // Validasi required fields
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0 || !jam_kerja_id) {
      return res.status(400).json({
        success: false,
        message: 'User IDs dan Jam Kerja ID wajib diisi'
      });
    }

    // Cek apakah jam kerja exists
    const [jamKerja] = await pool.execute(
      'SELECT nama_setting FROM jam_kerja WHERE id = ?',
      [jam_kerja_id]
    );

    if (jamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jam kerja tidak ditemukan'
      });
    }

    // Update jam kerja hanya untuk user dengan roles pegawai
    const placeholders = user_ids.map(() => '?').join(',');
    const [result] = await pool.execute(
      `UPDATE users SET jam_kerja_id = ?, updated_at = NOW() 
       WHERE id IN (${placeholders}) AND is_active = 1 AND roles = 'pegawai'`,
      [jam_kerja_id, ...user_ids]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['BULK_ASSIGN_JAM_KERJA', `Admin assign jam kerja ${jamKerja[0].nama_setting} ke ${result.affectedRows} user pegawai`, req.user.id]
    );

    res.json({
      success: true,
      message: `Jam kerja berhasil diassign ke ${result.affectedRows} user pegawai`,
      data: {
        affectedRows: result.affectedRows
      }
    });

  } catch (error) {
    console.error('Bulk assign jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Remove jam kerja from user (only for pegawai roles)
const removeJamKerjaFromUser = async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'User ID wajib diisi'
      });
    }

    // Cek apakah user exists dan roles pegawai
    const [user] = await pool.execute(
      'SELECT nama, roles FROM users WHERE id = ?',
      [user_id]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Validasi roles harus pegawai
    if (user[0].roles !== 'pegawai') {
      return res.status(400).json({
        success: false,
        message: 'Hanya user dengan roles pegawai yang dapat dihapus jam kerjanya'
      });
    }

    // Remove jam kerja
    await pool.execute(
      'UPDATE users SET jam_kerja_id = NULL, updated_at = NOW() WHERE id = ?',
      [user_id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['REMOVE_JAM_KERJA', `Admin menghapus jam kerja dari user ${user[0].nama}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Jam kerja berhasil dihapus dari user'
    });

  } catch (error) {
    console.error('Remove jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get user's current jam kerja (only for pegawai roles)
const getUserJamKerja = async (req, res) => {
  try {
    const { user_id } = req.params;

    const [userJamKerja] = await pool.execute(
      `SELECT u.id as user_id, u.nama as user_nama, u.roles,
              jk.id as jam_kerja_id, jk.nama_setting, jk.jam_masuk_standar, 
              jk.jam_pulang_standar, jk.toleransi_keterlambatan, jk.batas_terlambat
       FROM users u
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE u.id = ? AND u.is_active = 1 AND u.roles = 'pegawai'`,
      [user_id]
    );

    if (userJamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User pegawai tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: userJamKerja[0]
    });

  } catch (error) {
    console.error('Get user jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get only pegawai users without jam kerja (for selection)
const getPegawaiWithoutJamKerja = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, nama, username, jabatan, wilayah_penugasan
       FROM users 
       WHERE is_active = 1 AND roles = 'pegawai' AND jam_kerja_id IS NULL
       ORDER BY nama`
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get pegawai without jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Get only pegawai users with specific jam kerja
const getPegawaiByJamKerja = async (req, res) => {
  try {
    const { jam_kerja_id } = req.params;

    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.username, u.jabatan, u.wilayah_penugasan,
              jk.nama_setting, jk.jam_masuk_standar, jk.jam_pulang_standar
       FROM users u
       JOIN jam_kerja jk ON u.jam_kerja_id = jk.id
       WHERE u.is_active = 1 AND u.roles = 'pegawai' AND u.jam_kerja_id = ?
       ORDER BY u.nama`,
      [jam_kerja_id]
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get pegawai by jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getUsersWithJamKerja,
  getAvailableJamKerja,
  assignJamKerjaToUser,
  assignJamKerjaBulk,
  removeJamKerjaFromUser,
  getUserJamKerja,
  getPegawaiWithoutJamKerja,
  getPegawaiByJamKerja
};