const { pool } = require('../config/database');

const getAllJamKerja = async (req, res) => {
  try {
    const [jamKerja] = await pool.execute(
      `SELECT id, nama_setting, jam_masuk_standar, jam_pulang_standar, 
              toleransi_keterlambatan, batas_terlambat, is_active, created_at
       FROM jam_kerja 
       ORDER BY is_active DESC, nama_setting`
    );

    res.json({
      success: true,
      data: jamKerja
    });

  } catch (error) {
    console.error('Get jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getJamKerjaById = async (req, res) => {
  try {
    const { id } = req.params;

    const [jamKerja] = await pool.execute(
      `SELECT id, nama_setting, jam_masuk_standar, jam_pulang_standar, 
              toleransi_keterlambatan, batas_terlambat, is_active, created_at
       FROM jam_kerja WHERE id = ?`,
      [id]
    );

    if (jamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jam kerja tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: jamKerja[0]
    });

  } catch (error) {
    console.error('Get jam kerja by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getJamKerjaAktif = async (req, res) => {
  try {
    const [jamKerja] = await pool.execute(
      `SELECT id, nama_setting, jam_masuk_standar, jam_pulang_standar, 
              toleransi_keterlambatan, batas_terlambat, is_active, created_at
       FROM jam_kerja 
       WHERE is_active = 1 
       ORDER BY created_at DESC 
       LIMIT 1`
    );

    if (jamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tidak ada jam kerja yang aktif'
      });
    }

    res.json({
      success: true,
      data: jamKerja[0]
    });

  } catch (error) {
    console.error('Get jam kerja aktif error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createJamKerja = async (req, res) => {
  try {
    const {
      nama_setting,
      jam_masuk_standar,
      jam_pulang_standar,
      toleransi_keterlambatan,
      batas_terlambat,
      is_active
    } = req.body;

    // Validasi required fields
    if (!nama_setting || !jam_masuk_standar || !jam_pulang_standar) {
      return res.status(400).json({
        success: false,
        message: 'Nama setting, jam masuk standar, dan jam pulang standar wajib diisi'
      });
    }

    // HAPUS: Logika penonaktifan otomatis dihapus
    // Biarkan user memilih mana yang aktif tanpa otomatis menonaktifkan yang lain

    // Insert jam kerja baru
    const [result] = await pool.execute(
      `INSERT INTO jam_kerja 
       (nama_setting, jam_masuk_standar, jam_pulang_standar, 
        toleransi_keterlambatan, batas_terlambat, is_active) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        nama_setting,
        jam_masuk_standar,
        jam_pulang_standar,
        toleransi_keterlambatan || '00:15:00',
        batas_terlambat || '09:00:00',
        is_active ? 1 : 0
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_JAM_KERJA', `Admin membuat setting jam kerja: ${nama_setting}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Jam kerja berhasil ditambahkan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateJamKerja = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nama_setting,
      jam_masuk_standar,
      jam_pulang_standar,
      toleransi_keterlambatan,
      batas_terlambat,
      is_active
    } = req.body;

    // Cek apakah jam kerja exists
    const [existingJamKerja] = await pool.execute(
      'SELECT id, nama_setting FROM jam_kerja WHERE id = ?',
      [id]
    );

    if (existingJamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jam kerja tidak ditemukan'
      });
    }

    // HAPUS: Logika penonaktifan otomatis dihapus
    // Biarkan multiple jam kerja aktif jika user menginginkannya

    // Update jam kerja
    await pool.execute(
      `UPDATE jam_kerja SET 
        nama_setting = ?, jam_masuk_standar = ?, jam_pulang_standar = ?,
        toleransi_keterlambatan = ?, batas_terlambat = ?, is_active = ?
       WHERE id = ?`,
      [
        nama_setting,
        jam_masuk_standar,
        jam_pulang_standar,
        toleransi_keterlambatan,
        batas_terlambat,
        is_active ? 1 : 0,
        id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_JAM_KERJA', `Admin mengupdate jam kerja: ${nama_setting} (ID: ${id})`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Jam kerja berhasil diupdate'
    });

  } catch (error) {
    console.error('Update jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteJamKerja = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah jam kerja exists
    const [existingJamKerja] = await pool.execute(
      'SELECT nama_setting FROM jam_kerja WHERE id = ?',
      [id]
    );

    if (existingJamKerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Jam kerja tidak ditemukan'
      });
    }

    // Cek apakah ada user yang menggunakan jam kerja ini
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE jam_kerja_id = ?',
      [id]
    );

    if (users.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus jam kerja karena masih digunakan oleh user'
      });
    }

    // Hapus jam kerja
    await pool.execute('DELETE FROM jam_kerja WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_JAM_KERJA', `Admin menghapus jam kerja: ${existingJamKerja[0].nama_setting}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Jam kerja berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete jam kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// HAPUS: Fungsi setJamKerjaAktif dihapus karena tidak digunakan lagi
// const setJamKerjaAktif = async (req, res) => { ... }

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

    // Cek apakah user exists
    const [user] = await pool.execute(
      'SELECT nama FROM users WHERE id = ?',
      [user_id]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
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

module.exports = {
  getAllJamKerja,
  getJamKerjaById,
  getJamKerjaAktif,
  createJamKerja,
  updateJamKerja,
  deleteJamKerja,
  // HAPUS: setJamKerjaAktif dihapus dari exports
  assignJamKerjaToUser
};