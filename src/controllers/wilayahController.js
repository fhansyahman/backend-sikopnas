const { pool } = require('../config/database');

const getAllWilayah = async (req, res) => {
  try {
    const [wilayah] = await pool.execute(
      'SELECT * FROM wilayah ORDER BY nama_wilayah ASC'
    );

    res.json({
      success: true,
      data: wilayah
    });

  } catch (error) {
    console.error('Get all wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getWilayahById = async (req, res) => {
  try {
    const { id } = req.params;

    const [wilayah] = await pool.execute(
      'SELECT * FROM wilayah WHERE id = ?',
      [id]
    );

    if (wilayah.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wilayah tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: wilayah[0]
    });

  } catch (error) {
    console.error('Get wilayah by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createWilayah = async (req, res) => {
  try {
    const { nama_wilayah, keterangan } = req.body;

    // Validasi required fields
    if (!nama_wilayah) {
      return res.status(400).json({
        success: false,
        message: 'Nama wilayah wajib diisi'
      });
    }

    // Cek apakah nama wilayah sudah ada
    const [existing] = await pool.execute(
      'SELECT id FROM wilayah WHERE nama_wilayah = ?',
      [nama_wilayah]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Nama wilayah sudah ada'
      });
    }

    // Insert wilayah baru
    const [result] = await pool.execute(
      'INSERT INTO wilayah (nama_wilayah, keterangan) VALUES (?, ?)',
      [nama_wilayah, keterangan]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['WILAYAH_CREATE', `Admin membuat wilayah baru: ${nama_wilayah}`, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: 'Wilayah berhasil dibuat',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateWilayah = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_wilayah, keterangan } = req.body;

    // Cek apakah wilayah exists
    const [existing] = await pool.execute(
      'SELECT id FROM wilayah WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wilayah tidak ditemukan'
      });
    }

    // Cek apakah nama wilayah sudah ada (kecuali untuk wilayah ini)
    const [duplicate] = await pool.execute(
      'SELECT id FROM wilayah WHERE nama_wilayah = ? AND id != ?',
      [nama_wilayah, id]
    );

    if (duplicate.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Nama wilayah sudah ada'
      });
    }

    // Update wilayah
    await pool.execute(
      'UPDATE wilayah SET nama_wilayah = ?, keterangan = ? WHERE id = ?',
      [nama_wilayah, keterangan, id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['WILAYAH_UPDATE', `Admin mengupdate wilayah: ${nama_wilayah}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Wilayah berhasil diupdate'
    });

  } catch (error) {
    console.error('Update wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteWilayah = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah wilayah exists
    const [existing] = await pool.execute(
      'SELECT nama_wilayah FROM wilayah WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Wilayah tidak ditemukan'
      });
    }

    // Cek apakah ada user yang menggunakan wilayah ini
    const [users] = await pool.execute(
      'SELECT id FROM users WHERE wilayah_id = ?',
      [id]
    );

    if (users.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat menghapus wilayah karena masih ada user yang menggunakan wilayah ini'
      });
    }

    // Delete wilayah
    await pool.execute('DELETE FROM wilayah WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['WILAYAH_DELETE', `Admin menghapus wilayah: ${existing[0].nama_wilayah}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Wilayah berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getUsersByWilayah = async (req, res) => {
  try {
    const { wilayah_id } = req.params;

    const [users] = await pool.execute(
      `SELECT u.id, u.nama, u.jabatan, u.roles, u.status, u.is_active, 
              u.wilayah_penugasan, w.nama_wilayah
       FROM users u 
       LEFT JOIN wilayah w ON u.wilayah_id = w.id 
       WHERE u.wilayah_id = ? AND u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY u.nama ASC`,
      [wilayah_id]
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get users by wilayah error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const assignWilayahToUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { wilayah_id } = req.body;

    // Cek apakah user exists dan roles pegawai
    const [user] = await pool.execute(
      'SELECT id, nama, roles FROM users WHERE id = ?',
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
        message: 'Hanya user dengan roles pegawai yang dapat ditugaskan wilayah'
      });
    }

    // Cek apakah wilayah exists
    if (wilayah_id) {
      const [wilayah] = await pool.execute(
        'SELECT id, nama_wilayah FROM wilayah WHERE id = ?',
        [wilayah_id]
      );

      if (wilayah.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Wilayah tidak ditemukan'
        });
      }
    }

    // Update user's wilayah
    await pool.execute(
      'UPDATE users SET wilayah_id = ?, wilayah_penugasan = ? WHERE id = ?',
      [
        wilayah_id, 
        wilayah_id ? (await pool.execute('SELECT nama_wilayah FROM wilayah WHERE id = ?', [wilayah_id]))[0][0].nama_wilayah : null,
        user_id
      ]
    );

    // Log activity
    const wilayahName = wilayah_id ? 
      (await pool.execute('SELECT nama_wilayah FROM wilayah WHERE id = ?', [wilayah_id]))[0][0].nama_wilayah : 
      'Tidak ada wilayah';
    
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['USER_WILAYAH_ASSIGN', `Admin menugaskan wilayah ${wilayahName} ke user ${user[0].nama}`, req.user.id]
    );

    res.json({
      success: true,
      message: `Wilayah berhasil ${wilayah_id ? 'ditugaskan' : 'dihapus'} dari user`
    });

  } catch (error) {
    console.error('Assign wilayah to user error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getWilayahStats = async (req, res) => {
  try {
    const [stats] = await pool.execute(
      `SELECT 
        w.id,
        w.nama_wilayah,
        COUNT(u.id) as total_users,
        SUM(CASE WHEN u.status = 'Aktif' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) as system_active_users
       FROM wilayah w
       LEFT JOIN users u ON w.id = u.wilayah_id AND u.roles = 'pegawai'
       GROUP BY w.id, w.nama_wilayah
       ORDER BY w.nama_wilayah ASC`
    );

    // Total users tanpa wilayah (hanya pegawai)
    const [noWilayah] = await pool.execute(
      `SELECT COUNT(*) as total FROM users WHERE wilayah_id IS NULL AND is_active = 1 AND roles = 'pegawai'`
    );

    res.json({
      success: true,
      data: {
        wilayah_stats: stats,
        no_wilayah_total: noWilayah[0].total
      }
    });

  } catch (error) {
    console.error('Get wilayah stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
const getAllPegawai = async (req, res) => {
  try {
    const [pegawai] = await pool.execute(
      `SELECT 
         u.id, u.nama, u.jabatan, u.roles, u.status, u.is_active, 
         u.wilayah_penugasan, u.wilayah_id, w.nama_wilayah,
         u.username, u.foto, u.telegram_id, u.created_at
       FROM users u 
       LEFT JOIN wilayah w ON u.wilayah_id = w.id 
       WHERE u.is_active = 1 AND u.roles = 'pegawai'
       ORDER BY w.nama_wilayah, u.nama ASC`
    );

    res.json({
      success: true,
      data: pegawai
    });

  } catch (error) {
    console.error('Get all pegawai error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
module.exports = {
  getAllWilayah,
  getWilayahById,
  createWilayah,
  updateWilayah,
  deleteWilayah,
  getUsersByWilayah,
  assignWilayahToUser,
  getWilayahStats,
  getAllPegawai
};