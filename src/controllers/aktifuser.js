// controllers/usersController.js
const { pool } = require('../config/database');

const getAllUsers = async (req, res) => {
  try {
    const { search, status, is_active } = req.query;

    let query = `
      SELECT 
        u.id, u.nama, u.username, u.jabatan, u.status, u.is_active,
        u.wilayah_penugasan, u.jenis_kelamin, u.no_hp, u.alamat,
        u.pendidikan_terakhir, u.tempat_lahir, u.tanggal_lahir,
        u.foto, u.roles, u.created_at, u.updated_at,
        w.nama_wilayah
      FROM users u
      LEFT JOIN wilayah w ON u.wilayah_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ' AND (u.nama LIKE ? OR u.username LIKE ? OR u.jabatan LIKE ? OR u.wilayah_penugasan LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      query += ' AND u.status = ?';
      params.push(status);
    }

    if (is_active !== undefined) {
      query += ' AND u.is_active = ?';
      params.push(is_active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY u.created_at DESC';

    const [users] = await pool.execute(query, params);

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const [users] = await pool.execute(
      `SELECT 
        u.id, u.nama, u.username, u.jabatan, u.status, u.is_active,
        u.wilayah_penugasan, u.jenis_kelamin, u.no_hp, u.alamat,
        u.pendidikan_terakhir, u.tempat_lahir, u.tanggal_lahir,
        u.foto, u.roles, u.created_at, u.updated_at,
        w.nama_wilayah
       FROM users u
       LEFT JOIN wilayah w ON u.wilayah_id = w.id
       WHERE u.id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data user tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: users[0]
    });

  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    console.log('=== DEACTIVATE USER START ===');

    // Cek apakah user exists
    const [users] = await pool.execute(
      `SELECT u.*, admin.nama as admin_name 
       FROM users u 
       CROSS JOIN (SELECT nama FROM users WHERE id = ?) as admin
       WHERE u.id = ?`,
      [adminId, id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data user tidak ditemukan'
      });
    }

    const user = users[0];

    // Cek apakah user sudah nonaktif
    if (user.is_active === 0) {
      return res.status(400).json({
        success: false,
        message: 'User sudah dalam status nonaktif'
      });
    }

    // Update status user menjadi nonaktif
    await pool.execute(
      `UPDATE users SET 
        is_active = 0, 
        status = 'Nonaktif',
        updated_at = NOW()
       WHERE id = ?`,
      [id]
    );

    console.log('User deactivated successfully');

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DEACTIVATE_USER', `Admin menonaktifkan user: ${user.nama} (${user.jabatan})`, adminId]
    );

    // Kirim response
    const response = {
      success: true,
      message: `User ${user.nama} berhasil dinonaktifkan`,
      data: {
        user_id: parseInt(id),
        nama: user.nama,
        is_active: 0,
        status: 'Nonaktif'
      }
    };

    console.log('Sending response');
    res.json(response);

  } catch (error) {
    console.error('!!! DEACTIVATE USER ERROR:', error);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const activateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    console.log('=== ACTIVATE USER START ===');

    // Cek apakah user exists
    const [users] = await pool.execute(
      `SELECT u.*, admin.nama as admin_name 
       FROM users u 
       CROSS JOIN (SELECT nama FROM users WHERE id = ?) as admin
       WHERE u.id = ?`,
      [adminId, id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data user tidak ditemukan'
      });
    }

    const user = users[0];

    // Cek apakah user sudah aktif
    if (user.is_active === 1) {
      return res.status(400).json({
        success: false,
        message: 'User sudah dalam status aktif'
      });
    }

    // Update status user menjadi aktif
    await pool.execute(
      `UPDATE users SET 
        is_active = 1, 
        status = 'Aktif',
        updated_at = NOW()
       WHERE id = ?`,
      [id]
    );

    console.log('User activated successfully');

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['ACTIVATE_USER', `Admin mengaktifkan user: ${user.nama} (${user.jabatan})`, adminId]
    );

    // Kirim response
    const response = {
      success: true,
      message: `User ${user.nama} berhasil diaktifkan`,
      data: {
        user_id: parseInt(id),
        nama: user.nama,
        is_active: 1,
        status: 'Aktif'
      }
    };

    console.log('Sending response');
    res.json(response);

  } catch (error) {
    console.error('!!! ACTIVATE USER ERROR:', error);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.user.id;

    console.log('=== UPDATE USER STATUS START ===');

    // Validasi status
    if (!status || !['Aktif', 'Nonaktif', 'Cuti', 'Resign'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus Aktif, Nonaktif, Cuti, atau Resign'
      });
    }

    // Cek apakah user exists
    const [users] = await pool.execute(
      `SELECT u.* 
       FROM users u 
       WHERE u.id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data user tidak ditemukan'
      });
    }

    const user = users[0];

    // Tentukan is_active berdasarkan status
    const is_active = status === 'Aktif' ? 1 : 0;

    // Update status user
    await pool.execute(
      `UPDATE users SET 
        status = ?, 
        is_active = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [status, is_active, id]
    );

    console.log('User status updated successfully');

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_USER_STATUS', `Admin mengubah status user ${user.nama} menjadi ${status}`, adminId]
    );

    // Kirim response
    const response = {
      success: true,
      message: `Status user ${user.nama} berhasil diubah menjadi ${status}`,
      data: {
        user_id: parseInt(id),
        nama: user.nama,
        status: status,
        is_active: is_active
      }
    };

    console.log('Sending response');
    res.json(response);

  } catch (error) {
    console.error('!!! UPDATE USER STATUS ERROR:', error);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getActiveUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT 
        id, nama, jabatan, wilayah_penugasan, status, is_active
       FROM users 
       WHERE is_active = 1
       ORDER BY nama`
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get active users error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getInactiveUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT 
        id, nama, jabatan, wilayah_penugasan, status, is_active
       FROM users 
       WHERE is_active = 0
       ORDER BY nama`
    );

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    console.error('Get inactive users error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  deactivateUser,
  activateUser,
  updateUserStatus,
  getActiveUsers,
  getInactiveUsers
};