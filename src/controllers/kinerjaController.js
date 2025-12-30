// src/controllers/kinerjaController.js
const { pool } = require('../config/database');
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

const saveBase64Image = (base64String, subfolder = 'kinerja') => {
  if (!base64String) return null;
  
  try {
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 string');
    }

    const imageType = matches[1];
    const imageData = matches[2];
    
    const ext = imageType.split('/')[1] || 'png';
    const filename = `${subfolder}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${ext}`;
    const uploadsDir = ensureUploadsDir();
    const subfolderDir = path.join(uploadsDir, subfolder);
    
    if (!fs.existsSync(subfolderDir)) {
      fs.mkdirSync(subfolderDir, { recursive: true });
    }
    
    const filePath = path.join(subfolderDir, filename);
    const buffer = Buffer.from(imageData, 'base64');
    
    fs.writeFileSync(filePath, buffer);
    
    return `/uploads/${subfolder}/${filename}`;
  } catch (error) {
    console.error('Error saving base64 image:', error);
    return null;
  }
};

const deleteFile = (filePath) => {
  if (!filePath) return;
  
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
  if (!filePath) return null;
  
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    const fileBuffer = fs.readFileSync(fullPath);
    const fileType = path.extname(filePath).substring(1);
    const base64 = fileBuffer.toString('base64');
    
    return `data:image/${fileType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
};

// Main Controller Functions
const createKinerja = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      tanggal,
      ruas_jalan,
      kegiatan,
      panjang_kr,
      panjang_kn,
      sket_image,
      foto_0,
      foto_50,
      foto_100
    } = req.body;

    // Validasi required fields
    if (!tanggal || !ruas_jalan || !kegiatan || !panjang_kr || !panjang_kn) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal, ruas jalan, kegiatan, panjang KR dan KN wajib diisi'
      });
    }

    // Cek apakah sudah ada data untuk tanggal dan user yang sama
    const [existing] = await pool.execute(
      'SELECT id FROM kinerja_harian WHERE user_id = ? AND tanggal = ?',
      [userId, tanggal]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Data kinerja untuk tanggal ini sudah ada'
      });
    }

    // Simpan gambar sebagai file
    const sketImagePath = saveBase64Image(sket_image, 'sket');
    const foto0Path = saveBase64Image(foto_0, 'foto');
    const foto50Path = saveBase64Image(foto_50, 'foto');
    const foto100Path = saveBase64Image(foto_100, 'foto');

    // Insert data kinerja
    const [result] = await pool.execute(
      `INSERT INTO kinerja_harian 
       (user_id, tanggal, ruas_jalan, kegiatan, panjang_kr, panjang_kn, 
        sket_image, foto_0, foto_50, foto_100) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        tanggal,
        ruas_jalan,
        kegiatan,
        panjang_kr,
        panjang_kn,
        sketImagePath,
        foto0Path,
        foto50Path,
        foto100Path
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_CREATE', `User membuat laporan kinerja harian - Ruas: ${ruas_jalan}`, userId]
    );

    res.status(201).json({
      success: true,
      message: 'Data kinerja harian berhasil disimpan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKinerjaUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bulan, tahun } = req.query;

    let query = `
      SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE k.user_id = ?
    `;
    const params = [userId];

    if (bulan && tahun) {
      query += ' AND MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?';
      params.push(bulan, tahun);
    }

    query += ' ORDER BY k.tanggal DESC';

    const [kinerja] = await pool.execute(query, params);

    // Convert file paths back to base64 untuk response
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100)
    }));

    res.json({
      success: true,
      data: parsedKinerja
    });

  } catch (error) {
    console.error('Get kinerja user error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKinerjaById = async (req, res) => {
  try {
    const { id } = req.params;

    const [kinerja] = await pool.execute(
      `SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
       FROM kinerja_harian k
       JOIN users u ON k.user_id = u.id
       WHERE k.id = ?`,
      [id]
    );

    if (kinerja.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    // Convert file paths back to base64
    const data = {
      ...kinerja[0],
      sket_image: getBase64FromFile(kinerja[0].sket_image),
      foto_0: getBase64FromFile(kinerja[0].foto_0),
      foto_50: getBase64FromFile(kinerja[0].foto_50),
      foto_100: getBase64FromFile(kinerja[0].foto_100)
    };

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Get kinerja by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateKinerja = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const {
      ruas_jalan,
      kegiatan,
      panjang_kr,
      panjang_kn,
      sket_image,
      foto_0,
      foto_50,
      foto_100
    } = req.body;

    // Cek kepemilikan data dan dapatkan data lama
    const [existing] = await pool.execute(
      'SELECT user_id, sket_image, foto_0, foto_50, foto_100 FROM kinerja_harian WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    if (existing[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk mengubah data ini'
      });
    }

    const oldData = existing[0];

    // Handle gambar - simpan yang baru, hapus yang lama jika diupdate
    let sketImagePath = oldData.sket_image;
    let foto0Path = oldData.foto_0;
    let foto50Path = oldData.foto_50;
    let foto100Path = oldData.foto_100;

    // Jika ada gambar baru, simpan dan hapus yang lama
    if (sket_image && sket_image !== 'keep') {
      if (sketImagePath) {
        deleteFile(sketImagePath);
      }
      sketImagePath = saveBase64Image(sket_image, 'sket');
    }

    if (foto_0 && foto_0 !== 'keep') {
      if (foto0Path) {
        deleteFile(foto0Path);
      }
      foto0Path = saveBase64Image(foto_0, 'foto');
    }

    if (foto_50 && foto_50 !== 'keep') {
      if (foto50Path) {
        deleteFile(foto50Path);
      }
      foto50Path = saveBase64Image(foto_50, 'foto');
    }

    if (foto_100 && foto_100 !== 'keep') {
      if (foto100Path) {
        deleteFile(foto100Path);
      }
      foto100Path = saveBase64Image(foto_100, 'foto');
    }

    // Update data
    await pool.execute(
      `UPDATE kinerja_harian SET 
        ruas_jalan = ?, kegiatan = ?, panjang_kr = ?, panjang_kn = ?,
        sket_image = ?, foto_0 = ?, foto_50 = ?, foto_100 = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        ruas_jalan,
        kegiatan,
        panjang_kr,
        panjang_kn,
        sketImagePath,
        foto0Path,
        foto50Path,
        foto100Path,
        id
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_UPDATE', `User mengupdate laporan kinerja harian - ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data kinerja berhasil diupdate'
    });

  } catch (error) {
    console.error('Update kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteKinerja = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cek kepemilikan data dan dapatkan path file
    const [existing] = await pool.execute(
      'SELECT user_id, sket_image, foto_0, foto_50, foto_100 FROM kinerja_harian WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kinerja tidak ditemukan'
      });
    }

    if (existing[0].user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk menghapus data ini'
      });
    }

    // Hapus file-file gambar
    const fileFields = ['sket_image', 'foto_0', 'foto_50', 'foto_100'];
    fileFields.forEach(field => {
      if (existing[0][field]) {
        deleteFile(existing[0][field]);
      }
    });

    // Delete data dari database
    await pool.execute('DELETE FROM kinerja_harian WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['KINERJA_DELETE', `User menghapus laporan kinerja harian - ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Data kinerja berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getAllKinerja = async (req, res) => {
  try {
    const { start_date, end_date, wilayah, user_id } = req.query;

    let query = `
      SELECT k.*, u.nama, u.jabatan, u.wilayah_penugasan
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ' AND k.tanggal BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    if (user_id) {
      query += ' AND k.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY k.tanggal DESC, u.nama ASC';

    const [kinerja] = await pool.execute(query, params);

    // Convert file paths ke base64
    const parsedKinerja = kinerja.map((item) => ({
      ...item,
      sket_image: getBase64FromFile(item.sket_image),
      foto_0: getBase64FromFile(item.foto_0),
      foto_50: getBase64FromFile(item.foto_50),
      foto_100: getBase64FromFile(item.foto_100)
    }));

    res.json({
      success: true,
      data: parsedKinerja
    });

  } catch (error) {
    console.error('Get all kinerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKinerjaStatistik = async (req, res) => {
  try {
    const { bulan, tahun, wilayah } = req.query;

    const targetBulan = bulan || new Date().getMonth() + 1;
    const targetTahun = tahun || new Date().getFullYear();

    let query = `
      SELECT 
        u.wilayah_penugasan,
        COUNT(k.id) as total_laporan,
        COUNT(DISTINCT k.user_id) as total_pegawai,
        AVG(CAST(REPLACE(k.panjang_kr, ' meter', '') AS DECIMAL(10,2))) as avg_panjang_kr,
        AVG(CAST(REPLACE(k.panjang_kn, ' meter', '') AS DECIMAL(10,2))) as avg_panjang_kn
      FROM kinerja_harian k
      JOIN users u ON k.user_id = u.id
      WHERE MONTH(k.tanggal) = ? AND YEAR(k.tanggal) = ?
    `;
    const params = [targetBulan, targetTahun];

    if (wilayah) {
      query += ' AND u.wilayah_penugasan = ?';
      params.push(wilayah);
    }

    query += ' GROUP BY u.wilayah_penugasan ORDER BY total_laporan DESC';

    const [statistik] = await pool.execute(query, params);

    res.json({
      success: true,
      data: statistik
    });

  } catch (error) {
    console.error('Get kinerja statistik error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  createKinerja,
  getKinerjaUser,
  getKinerjaById,
  updateKinerja,
  deleteKinerja,
  getAllKinerja,
  getKinerjaStatistik
};