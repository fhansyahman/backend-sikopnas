const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
// Tambahkan di bagian atas file, setelah imports
const fs = require('fs');
const path = require('path');

const getBase64FromFile = (filePath) => {
  if (!filePath) {
    return null;
  }
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    const fileBuffer = fs.readFileSync(fullPath);
    const fileType = path.extname(filePath).toLowerCase().substring(1);
    
    const mimeTypes = {
      'jpg': 'jpeg',
      'jpeg': 'jpeg',
      'png': 'png',
      'gif': 'gif',
      'webp': 'webp'
    };
    
    const mimeType = mimeTypes[fileType] || 'png';
    const base64 = fileBuffer.toString('base64');
    
    return `data:image/${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
};
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    console.log('Login attempt for:', username);

    // Validation
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan password wajib diisi'
      });
    }

    // Find user
    const [users] = await pool.execute(
      `SELECT u.*, jk.jam_masuk_standar, jk.jam_pulang_standar 
       FROM users u 
       LEFT JOIN jam_kerja jk ON u.jam_kerja_id = jk.id 
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }

    const user = users[0];

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah'
      });
    }

    // Generate token dengan expiresIn yang valid
    const token = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        role: user.roles,
        nama: user.nama,
        jabatan: user.jabatan
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' } // Format yang valid: '7d', '24h', '3600' (seconds)
    );

    // Response data user untuk frontend (tanpa password)
    const userResponse = {
      id: user.id,
      nama: user.nama,
      username: user.username,
      alamat: user.alamat,
      jenis_kelamin: user.jenis_kelamin,
      roles: user.roles,
      jabatan: user.jabatan,
      foto: user.foto,
      wilayah_penugasan: user.wilayah_penugasan,
      telegram_id: user.telegram_id,
      jam_kerja_id: user.jam_kerja_id,
      jam_masuk_standar: user.jam_masuk_standar,
      jam_pulang_standar: user.jam_pulang_standar,
      is_active: user.is_active,
      created_at: user.created_at
    };

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        token,
        user: userResponse
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getProfile = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT id, nama, username, no_hp, jabatan, roles, 
              foto, wilayah_penugasan, telegram_id, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = users[0];
    
    // Konversi foto ke base64
    let fotoBase64 = null;
    if (user.foto) {
      try {
        // Pastikan fungsi getBase64FromFile sudah didefinisikan
        if (typeof getBase64FromFile === 'function') {
          fotoBase64 = getBase64FromFile(user.foto);
        } else {
          // Jika fungsi tidak tersedia, gunakan path asli
          fotoBase64 = user.foto;
          console.warn('getBase64FromFile tidak tersedia, menggunakan path asli');
        }
      } catch (error) {
        console.error('Error converting foto to base64:', error);
        // Tetap lanjut dengan path asli jika gagal konversi
        fotoBase64 = user.foto;
      }
    }

    // Return dengan foto dalam format base64
    const responseData = {
      ...user,
      foto: fotoBase64
    };

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = { login, getProfile };