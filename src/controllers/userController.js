const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// File Utility Functions
const ensureUploadsDir = () => {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
};

const saveBase64Image = (base64String, subfolder = 'users') => {
  if (!base64String || !base64String.startsWith('data:image')) {
    return null;
  }
  
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 string');
    }

    const imageType = matches[1];
    const imageData = matches[2];
    
    // Ekstrak ekstensi file dari tipe MIME
    const ext = imageType.split('/')[1] || 'png';
    const filename = `user_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${ext}`;
    const uploadsDir = ensureUploadsDir();
    const subfolderDir = path.join(uploadsDir, subfolder);
    
    if (!fs.existsSync(subfolderDir)) {
      fs.mkdirSync(subfolderDir, { recursive: true });
    }
    
    const filePath = path.join(subfolderDir, filename);
    const buffer = Buffer.from(imageData, 'base64');
    
    // Validasi ukuran file (max 500KB)
    if (buffer.length > 500 * 1024) {
      throw new Error('Ukuran foto terlalu besar (>500KB)');
    }
    
    fs.writeFileSync(filePath, buffer);
    
    return `/uploads/${subfolder}/${filename}`;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    throw error;
  }
};

const deleteFile = (filePath) => {
  if (!filePath || filePath.includes('default.png')) {
    return;
  }
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

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
    
    // Tentukan tipe MIME berdasarkan ekstensi
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

// Fungsi untuk optimasi gambar sebelum disimpan
const optimizeImage = async (base64String) => {
  try {
    if (!base64String || !base64String.startsWith('data:image')) {
      throw new Error('Format foto tidak valid');
    }

    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 string');
    }

    const imageData = matches[2];
    const buffer = Buffer.from(imageData, 'base64');

    // Gunakan sharp untuk optimasi jika tersedia
    try {
      const sharp = require('sharp');
      
      const metadata = await sharp(buffer).metadata();
      console.log(`📐 Dimensi asli: ${metadata.width}x${metadata.height}`);
      console.log(`📁 Ukuran asli: ${(buffer.length / 1024).toFixed(2)} KB`);

      // Tentukan resize berdasarkan ukuran asli
      let resizeOptions = { 
        width: 400,
        height: 400,
        fit: 'cover',
        withoutEnlargement: true 
      };

      // Kompres dan konversi ke JPEG dengan quality 80%
      const optimizedBuffer = await sharp(buffer)
        .resize(resizeOptions)
        .jpeg({ 
          quality: 80,
          progressive: true 
        })
        .toBuffer();

      console.log(`📁 Ukuran setelah optimasi: ${(optimizedBuffer.length / 1024).toFixed(2)} KB`);

      // Konversi kembali ke base64
      const mimeType = 'image/jpeg';
      const base64 = optimizedBuffer.toString('base64');
      return `data:${mimeType};base64,${base64}`;
      
    } catch (sharpError) {
      console.log('⚠️ Sharp tidak tersedia, menggunakan gambar asli');
      return base64String;
    }
    
  } catch (error) {
    console.error('❌ Error optimizing image:', error);
    throw error;
  }
};

// Controller Functions
const getAllUsers = async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT * FROM users 
       ORDER BY nama`
    );

    // Convert foto paths ke base64 untuk response
    const usersWithBase64 = users.map(user => ({
      ...user,
      foto: getBase64FromFile(user.foto)
    }));

    res.json({
      success: true,
      data: usersWithBase64
    });

  } catch (error) {
    console.error('Get users error:', error);
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
      `SELECT * FROM users WHERE id = ?`,
      [id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = users[0];
    user.foto = getBase64FromFile(user.foto);

    res.json({
      success: true,
      data: user
    });

  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createUser = async (req, res) => {
  let connection;
  try {
    const {
      nama,
      username,
      password,
      no_hp,
      jabatan,
      roles,
      wilayah_penugasan,
      tempat_lahir,
      tanggal_lahir,
      alamat,
      jenis_kelamin,
      pendidikan_terakhir,
      telegram_id,
      jam_kerja_id,
      can_remote,
      status,
      foto
    } = req.body;

    console.log(`📥 Request create user: ${nama}`);
    console.log(`📸 Ada foto: ${!!foto}`);

    // Validasi required fields
    if (!nama || !username || !password || !jabatan || !roles || !status) {
      return res.status(400).json({
        success: false,
        message: 'Nama, username, password, jabatan, roles, dan status wajib diisi'
      });
    }

    connection = await pool.getConnection();

    // Cek apakah username sudah ada
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      await connection.release();
      return res.status(400).json({
        success: false,
        message: 'Username sudah digunakan'
      });
    }

    // Handle upload foto
    let fotoPath = "/uploads/users/default.png";
    
    // Jika ada foto yang diupload
    if (foto && foto.startsWith("data:image")) {
      try {
        console.log('🔄 Memproses upload foto...');
        
        // Optimasi gambar terlebih dahulu
        let optimizedFoto = foto;
        try {
          optimizedFoto = await optimizeImage(foto);
        } catch (optimizeError) {
          console.log('⚠️ Optimasi gambar gagal, menggunakan gambar asli:', optimizeError.message);
        }
        
        // Simpan file
        fotoPath = saveBase64Image(optimizedFoto, 'users');
        console.log('✅ Foto berhasil diproses:', fotoPath);
      } catch (error) {
        console.error('❌ Error saving photo:', error.message);
        // Tetap lanjut dengan foto default jika gagal
        fotoPath = "/uploads/users/default.png";
      }
    } else {
      console.log('ℹ️ Tidak ada foto atau format tidak valid, menggunakan default');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user baru
    const [result] = await connection.execute(
      `INSERT INTO users 
       (nama, username, password, no_hp, jabatan, roles, wilayah_penugasan,
        tempat_lahir, tanggal_lahir, alamat, jenis_kelamin, pendidikan_terakhir,
        telegram_id, jam_kerja_id, can_remote, status, foto) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nama,
        username,
        hashedPassword,
        no_hp || null,
        jabatan,
        roles,
        wilayah_penugasan || null,
        tempat_lahir || null,
        tanggal_lahir || null,
        alamat || null,
        jenis_kelamin || null,
        pendidikan_terakhir || null,
        telegram_id || null,
        jam_kerja_id || null,
        can_remote || 0,
        status,
        fotoPath
      ]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_USER', `Admin membuat user baru: ${nama} (${username})`, req.user?.id || 1]
    );

    await connection.release();

    console.log('✅ User berhasil dibuat:', result.insertId);

    res.json({
      success: true,
      message: 'User berhasil ditambahkan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('❌ Create user error:', error);
    if (connection) await connection.release();
    
    // Berikan error message yang lebih spesifik
    let errorMessage = 'Terjadi kesalahan server';
    if (error.message.includes('PayloadTooLargeError')) {
      errorMessage = 'Ukuran foto terlalu besar. Silakan gunakan foto yang lebih kecil atau kompres terlebih dahulu.';
    } else if (error.message.includes('Ukuran foto terlalu besar')) {
      errorMessage = error.message;
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage
    });
  }
};

const updateUser = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const {
      nama,
      username,
      no_hp,
      jabatan,
      roles,
      status,
      is_active,
      wilayah_penugasan,
      tempat_lahir,
      tanggal_lahir,
      alamat,
      jenis_kelamin,
      pendidikan_terakhir,
      telegram_id,
      jam_kerja_id,
      can_remote,
      foto
    } = req.body;

    console.log(`📥 Request update user ID: ${id}`);
    console.log(`📸 Ada foto: ${!!foto}`);

    connection = await pool.getConnection();

    // Cek apakah user exists
    const [existingUsers] = await connection.execute(
      'SELECT id, foto, nama FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      await connection.release();
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const currentUser = existingUsers[0];

    // Cek apakah username sudah digunakan oleh user lain
    const [usernameCheck] = await connection.execute(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username, id]
    );

    if (usernameCheck.length > 0) {
      await connection.release();
      return res.status(400).json({
        success: false,
        message: 'Username sudah digunakan'
      });
    }

    // Handle update foto jika ada
    let fotoPath = currentUser.foto;
    
    if (foto && foto.startsWith("data:image")) {
      try {
        console.log('🔄 Memproses update foto...');
        
        // Optimasi gambar terlebih dahulu
        let optimizedFoto = foto;
        try {
          optimizedFoto = await optimizeImage(foto);
        } catch (optimizeError) {
          console.log('⚠️ Optimasi gambar gagal, menggunakan gambar asli:', optimizeError.message);
        }
        
        // Hapus foto lama jika bukan default
        deleteFile(fotoPath);
        
        // Simpan foto baru
        fotoPath = saveBase64Image(optimizedFoto, 'users');
        console.log('✅ Foto berhasil diupdate:', fotoPath);
      } catch (error) {
        console.error("⚠️ Gagal memproses foto upload:", error.message);
        // Tetap gunakan fotoPath yang lama jika gagal
      }
    }

    // Update user
    await connection.execute(
      `UPDATE users SET 
        nama = ?, username = ?, no_hp = ?, jabatan = ?, roles = ?,
        status = ?, is_active = ?, wilayah_penugasan = ?, tempat_lahir = ?,
        tanggal_lahir = ?, alamat = ?, jenis_kelamin = ?, pendidikan_terakhir = ?,
        telegram_id = ?, jam_kerja_id = ?, can_remote = ?, foto = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        nama,
        username,
        no_hp || null,
        jabatan,
        roles,
        status || 'Aktif',
        is_active !== undefined ? is_active : 1,
        wilayah_penugasan || null,
        tempat_lahir || null,
        tanggal_lahir || null,
        alamat || null,
        jenis_kelamin || null,
        pendidikan_terakhir || null,
        telegram_id || null,
        jam_kerja_id || null,
        can_remote || 0,
        fotoPath,
        id
      ]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_USER', `Admin mengupdate user: ${nama} (ID: ${id})`, req.user?.id || 1]
    );

    await connection.release();

    console.log('✅ User berhasil diupdate:', id);

    res.json({
      success: true,
      message: 'User berhasil diupdate'
    });

  } catch (error) {
    console.error('❌ Update user error:', error);
    if (connection) await connection.release();
    
    let errorMessage = 'Terjadi kesalahan server';
    if (error.message.includes('PayloadTooLargeError')) {
      errorMessage = 'Ukuran foto terlalu besar. Silakan gunakan foto yang lebih kecil atau kompres terlebih dahulu.';
    } else if (error.message.includes('Ukuran foto terlalu besar')) {
      errorMessage = error.message;
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage
    });
  }
};

const deleteUser = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    console.log(`🗑️ Request delete user ID: ${id}`);

    connection = await pool.getConnection();

    // Cek apakah user exists
    const [existingUsers] = await connection.execute(
      'SELECT nama, username, foto FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      await connection.release();
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    const user = existingUsers[0];

    // Hapus foto jika ada
    deleteFile(user.foto);

    // Hapus user
    await connection.execute('DELETE FROM users WHERE id = ?', [id]);

    // Log activity
    await connection.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_USER', `Admin menghapus user: ${user.nama} (${user.username})`, req.user?.id || 1]
    );

    await connection.release();

    console.log('✅ User berhasil dihapus:', id);

    res.json({
      success: true,
      message: 'User berhasil dihapus'
    });

  } catch (error) {
    console.error('❌ Delete user error:', error);
    if (connection) await connection.release();
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateUserPassword = async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { password } = req.body;

    console.log(`🔐 Request update password user ID: ${id}`);

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password wajib diisi'
      });
    }

    connection = await pool.getConnection();

    // Cek apakah user exists
    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );

    if (existingUsers.length === 0) {
      await connection.release();
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Hash password baru
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password
    await connection.execute(
      'UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?',
      [hashedPassword, id]
    );

    // Log activity
    await connection.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_PASSWORD', `Admin mengupdate password user ID: ${id}`, req.user?.id || 1]
    );

    await connection.release();

    console.log('✅ Password berhasil diupdate untuk user:', id);

    res.json({
      success: true,
      message: 'Password berhasil diupdate'
    });

  } catch (error) {
    console.error('❌ Update password error:', error);
    if (connection) await connection.release();
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserPassword
};