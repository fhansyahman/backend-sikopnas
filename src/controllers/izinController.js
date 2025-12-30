const { pool } = require('../config/database');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');
const { Console } = require('console');

const getAllIzin = async (req, res) => {
  try {
    const { status, user_id } = req.query;

    let query = `
      SELECT i.*, u.nama as nama_pegawai, u.jabatan, u.wilayah_penugasan,
             admin.nama as Disetujui_by_name
      FROM izin i
      JOIN users u ON i.user_id = u.id
      LEFT JOIN users admin ON i.updated_by = admin.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE i.status = ?';
      params.push(status);
    }

    if (user_id) {
      if (params.length > 0) {
        query += ' AND i.user_id = ?';
      } else {
        query += ' WHERE i.user_id = ?';
      }
      params.push(user_id);
    }

    query += ' ORDER BY i.created_at DESC';

    const [izin] = await pool.execute(query, params);

    res.json({
      success: true,
      data: izin
    });

  } catch (error) {
    console.error('Get all izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getIzinById = async (req, res) => {
  try {
    const { id } = req.params;

    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai, u.jabatan, u.wilayah_penugasan,
              admin.nama as Disetujui_by_name
       FROM izin i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN users admin ON i.updated_by = admin.id
       WHERE i.id = ?`,
      [id]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: izin[0]
    });

  } catch (error) {
    console.error('Get izin by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getMyIzin = async (req, res) => {
  try {
    const userId = req.user.id;

    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai, u.jabatan,
              admin.nama as Disetujui_by_name
       FROM izin i
       JOIN users u ON i.user_id = u.id
       LEFT JOIN users admin ON i.updated_by = admin.id
       WHERE i.user_id = ?
       ORDER BY i.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: izin
    });

  } catch (error) {
    console.error('Get my izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createIzin = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      jenis, 
      tanggal_mulai, 
      tanggal_selesai, 
      keterangan, 
      dokumen_pendukung 
    } = req.body;

    console.log('Create izin attempt - User:', userId);
    console.log('Data:', { jenis, tanggal_mulai, tanggal_selesai, keterangan });
    console.log('Base64 length:', dokumen_pendukung?.length);

    // Validasi required fields SESUAI STRUCTURE TABLE
    if (!jenis || !tanggal_mulai || !tanggal_selesai) {
      return res.status(400).json({
        success: false,
        message: 'Jenis, tanggal mulai, dan tanggal selesai wajib diisi'
      });
      // keterangan TIDAK required karena di database bisa NULL
    }

    // Validasi jenis izin sesuai ENUM
    const validJenis = [
      'Sakit', 'Izin', 'Cuti Tahunan', 'Cuti Besar', 
      'Cuti Sakit', 'Cuti Melahirkan', 'Tugas Luar', 'Dinas Luar'
    ];
    
    if (!validJenis.includes(jenis)) {
      return res.status(400).json({
        success: false,
        message: `Jenis izin tidak valid. Pilihan: ${validJenis.join(', ')}`
      });
    }

    // Hitung durasi hari
    const startDate = new Date(tanggal_mulai);
    const endDate = new Date(tanggal_selesai);
    
    // Validasi tanggal
    if (startDate > endDate) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal selesai tidak boleh sebelum tanggal mulai'
      });
    }

    const diffTime = Math.abs(endDate - startDate);
    const durasi_hari = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let dokumenFileName = null;

    // Handle file upload jika ada dokumen pendukung
    if (dokumen_pendukung) {
      // Generate filename
      dokumenFileName = `izin_${userId}_${Date.now()}.pdf`;
      const filePath = path.join(__dirname, '../uploads/izin', dokumenFileName);
      
      // Convert base64 to file dan simpan
      const base64Data = dokumen_pendukung.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Pastikan folder uploads exists
      const uploadDir = path.join(__dirname, '../uploads/izin');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, buffer);
      console.log('Dokumen izin disimpan sebagai:', dokumenFileName);
    }

    // Insert izin ke database - SESUAI STRUCTURE TABLE
    const [result] = await pool.execute(
      `INSERT INTO izin 
       (user_id, tanggal_mulai, tanggal_selesai, durasi_hari, jenis, 
        keterangan, dokumen_pendukung, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`, // Status = 'Pending' sesuai ENUM
      [
        userId,
        tanggal_mulai,
        tanggal_selesai,
        durasi_hari,
        jenis,
        keterangan || null, // Bisa NULL
        dokumenFileName, // Simpan nama file saja, bukan base64
      ]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_IZIN', `User mengajukan izin ${jenis} - ${durasi_hari} hari`, userId]
    );

    console.log('Izin berhasil dibuat - ID:', result.insertId);

    res.json({
      success: true,
      message: 'Izin berhasil diajukan',
      data: {
        id: result.insertId,
        jenis,
        tanggal_mulai,
        tanggal_selesai,
        durasi_hari,
        status: 'Pending' // Sesuai ENUM di database
      }
    });

  } catch (error) {
    console.error('Create izin error:', error);
    console.error('Error details:', error.message);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateIzinStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.user.id;

    console.log('=== UPDATE IZIN STATUS START ===');

    // Validasi status
    if (!status || !['Disetujui', 'Ditolak'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus Disetujui atau Ditolak'
      });
    }

    // Cek apakah izin exists
    const [izin] = await pool.execute(
      `SELECT i.*, u.nama as nama_pegawai 
       FROM izin i 
       JOIN users u ON i.user_id = u.id 
       WHERE i.id = ?`,
      [id]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    console.log('Izin found - Dates:', izin[0].tanggal_mulai, 'to', izin[0].tanggal_selesai);

    // Update status izin
    await pool.execute(
      `UPDATE izin SET 
        status = ?, updated_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, adminId, id]
    );

    console.log('Izin status updated successfully');

    let presensiGenerated = 0;
    
    // Jika status Disetujui, generate presensi otomatis
    if (status === 'Disetujui') {
      console.log('Starting presensi generation...');
      try {
        // Gunakan versi simple terlebih dahulu
        presensiGenerated = await generatePresensiIzinSimple(izin[0]);
        console.log('Presensi generation completed successfully');
      } catch (presensiError) {
        console.error('Presensi generation failed:', presensiError);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['UPDATE_IZIN_STATUS', `Admin mengubah status izin ID ${id} menjadi ${status}`, adminId]
    );

    // Kirim response
    const response = {
      success: true,
      message: `Izin berhasil ${status.toLowerCase()}`,
      data: {
        izin_id: parseInt(id),
        status: status,
        presensi_generated: presensiGenerated
      }
    };

    console.log('Sending response');
    res.json(response);

  } catch (error) {
    console.error('!!! UPDATE IZIN STATUS ERROR:', error);
    
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteIzin = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Cek apakah izin exists
    const [izin] = await pool.execute(
      'SELECT * FROM izin WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (izin.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data izin tidak ditemukan'
      });
    }

    // Hanya bisa hapus izin dengan status Pending
    if (izin[0].status !== 'Pending') {
      return res.status(400).json({
        success: false,
        message: 'Hanya bisa menghapus izin dengan status Pending'
      });
    }

    // Hapus izin
    await pool.execute('DELETE FROM izin WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['DELETE_IZIN', `User menghapus pengajuan izin ID: ${id}`, userId]
    );

    res.json({
      success: true,
      message: 'Izin berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete izin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Fungsi helper untuk generate presensi izin
// Alternatif function tanpa Luxon
// Fungsi helper untuk generate presensi izin - FIXED VERSION
const generatePresensiIzinSimple = async (izin) => {
  let generatedCount = 0;
  
  try {
    console.log('=== GENERATE PRESENSI IZIN SIMPLE START ===');
    console.log('Izin ID:', izin.id, 'User ID:', izin.user_id);
    console.log('Raw tanggal_mulai:', izin.tanggal_mulai);
    console.log('Raw tanggal_selesai:', izin.tanggal_selesai);
    console.log('Type of tanggal_mulai:', typeof izin.tanggal_mulai);
    console.log('Type of tanggal_selesai:', typeof izin.tanggal_selesai);

    // Handle berbagai format tanggal
    let startDate, endDate;

    // Jika tanggal sudah dalam format Date object
    if (izin.tanggal_mulai instanceof Date) {
      startDate = new Date(izin.tanggal_mulai);
      endDate = new Date(izin.tanggal_selesai);
    } 
    // Jika tanggal dalam format string
    else if (typeof izin.tanggal_mulai === 'string') {
      // Coba berbagai format
      startDate = new Date(izin.tanggal_mulai);
      endDate = new Date(izin.tanggal_selesai);
      
      // Jika parsing gagal, coba format Indonesia (DD/MM/YYYY)
      if (isNaN(startDate.getTime())) {
        console.log('Trying alternative date format...');
        const partsMulai = izin.tanggal_mulai.split('/');
        const partsSelesai = izin.tanggal_selesai.split('/');
        
        if (partsMulai.length === 3 && partsSelesai.length === 3) {
          // Format DD/MM/YYYY
          startDate = new Date(`${partsMulai[2]}-${partsMulai[1]}-${partsMulai[0]}`);
          endDate = new Date(`${partsSelesai[2]}-${partsSelesai[1]}-${partsSelesai[0]}`);
        } else {
          // Coba split by space atau karakter lain
          startDate = new Date(izin.tanggal_mulai.replace(/\s+/g, '-'));
          endDate = new Date(izin.tanggal_selesai.replace(/\s+/g, '-'));
        }
      }
    } 
    // Jika format tidak dikenal, gunakan langsung dari database
    else {
      // Query langsung ke database untuk mendapatkan format yang benar
      const [dateCheck] = await pool.execute(
        'SELECT DATE_FORMAT(tanggal_mulai, "%Y-%m-%d") as mulai, DATE_FORMAT(tanggal_selesai, "%Y-%m-%d") as selesai FROM izin WHERE id = ?',
        [izin.id]
      );
      
      if (dateCheck.length > 0) {
        startDate = new Date(dateCheck[0].mulai);
        endDate = new Date(dateCheck[0].selesai);
      } else {
        throw new Error('Tidak dapat memparsing format tanggal');
      }
    }

    console.log('Parsed start date:', startDate, 'Valid:', !isNaN(startDate.getTime()));
    console.log('Parsed end date:', endDate, 'Valid:', !isNaN(endDate.getTime()));

    // Validasi tanggal
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('Invalid dates - start:', startDate, 'end:', endDate);
      throw new Error(`Format tanggal tidak valid: ${izin.tanggal_mulai} - ${izin.tanggal_selesai}`);
    }

    // Loop through dates
    let currentDate = new Date(startDate);
    
    console.log('Date range:', startDate.toISOString(), 'to', endDate.toISOString());

    while (currentDate <= endDate) {
      const tanggal = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      console.log('Processing date:', tanggal);

      try {
        // Cek apakah sudah ada presensi untuk tanggal ini
        const [existingPresensi] = await pool.execute(
          'SELECT id FROM presensi WHERE user_id = ? AND tanggal = ?',
          [izin.user_id, tanggal]
        );

        // Tentukan status berdasarkan enum yang tersedia
        // Karena enum status_masuk tidak ada "Izin", kita perlu pilih yang sesuai
        const statusIzin = 'Tanpa Keterangan'; // Fallback ke enum yang ada
        const statusPulang = 'Belum Pulang';   // Fallback ke enum yang ada

        if (existingPresensi.length === 0) {
          // Buat presensi dengan status izin
          console.log('Creating new presensi...');
          const [insertResult] = await pool.execute(
            `INSERT INTO presensi 
             (user_id, izin_id, tanggal, status_masuk, status_pulang, 
              is_system_generated, keterangan) 
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [
              izin.user_id,
              izin.id,
              tanggal,
              statusIzin, // Gunakan enum yang valid
              statusPulang, // Gunakan enum yang valid
              `Auto-generated: Izin ${izin.jenis}`
            ]
          );
          console.log('Insert result - ID:', insertResult.insertId);
          generatedCount++;
        } else {
          // Update presensi yang sudah ada
          console.log('Updating existing presensi ID:', existingPresensi[0].id);
          const [updateResult] = await pool.execute(
            `UPDATE presensi SET 
              izin_id = ?, status_masuk = ?, status_pulang = ?,
              keterangan = ?, updated_at = NOW()
             WHERE user_id = ? AND tanggal = ?`,
            [
              izin.id,
              statusIzin, // Gunakan enum yang valid
              statusPulang, // Gunakan enum yang valid
              `Updated: Izin ${izin.jenis}`,
              izin.user_id,
              tanggal
            ]
          );
          console.log('Update result:', updateResult.affectedRows, 'rows affected');
          generatedCount++;
        }
      } catch (dateError) {
        console.error(`Error processing date ${tanggal}:`, dateError);
      }
      
      // Next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log('=== GENERATE PRESENSI COMPLETE ===');
    console.log('Total records processed:', generatedCount);
    
  } catch (error) {
    console.error('!!! ERROR IN generatePresensiIzinSimple:', error);
    throw error;
  }
  
  return generatedCount;
};

// Update juga di presensiController untuk validasi izin
const checkIzinBeforePresensi = async (userId, tanggal) => {
  const [izin] = await pool.execute(
    `SELECT * FROM izin 
     WHERE user_id = ? AND tanggal_mulai <= ? AND tanggal_selesai >= ? 
     AND status = 'Disetujui'`,
    [userId, tanggal, tanggal]
  );
  
  return izin.length > 0 ? izin[0] : null;
};

// Admin create izin for user
const createIzinByAdmin = async (req, res) => {
  try {
    const adminId = req.user.id;
    const {
      user_id,
      tanggal_mulai,
      tanggal_selesai,
      jenis,
      keterangan,
      dokumen_pendukung,
      status = 'Disetujui' // Default langsung disetujui
    } = req.body;

    // Validasi required fields
    if (!user_id || !tanggal_mulai || !tanggal_selesai || !jenis) {
      return res.status(400).json({
        success: false,
        message: 'User ID, tanggal mulai, tanggal selesai, dan jenis izin wajib diisi'
      });
    }

    // Validasi tanggal
    const startDate = new Date(tanggal_mulai);
    const endDate = new Date(tanggal_selesai);

    if (endDate < startDate) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal selesai tidak boleh sebelum tanggal mulai'
      });
    }

    // Hitung durasi hari
    const durasiHari = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Cek apakah user exists
    const [user] = await pool.execute(
      'SELECT nama FROM users WHERE id = ? AND is_active = 1',
      [user_id]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan atau tidak aktif'
      });
    }

    // Cek apakah ada tanggal yang sudah ada izin yang disetujui
    const [existingIzin] = await pool.execute(
      `SELECT * FROM izin 
       WHERE user_id = ? AND status = 'Disetujui'
       AND (
         (tanggal_mulai BETWEEN ? AND ?) OR
         (tanggal_selesai BETWEEN ? AND ?) OR
         (? BETWEEN tanggal_mulai AND tanggal_selesai) OR
         (? BETWEEN tanggal_mulai AND tanggal_selesai)
       )`,
      [user_id, tanggal_mulai, tanggal_selesai, tanggal_mulai, tanggal_selesai, 
       tanggal_mulai, tanggal_selesai]
    );

    if (existingIzin.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User sudah memiliki izin yang disetujui pada tanggal tersebut'
      });
    }

    // Insert izin
    const [result] = await pool.execute(
      `INSERT INTO izin 
       (user_id, tanggal_mulai, tanggal_selesai, durasi_hari, jenis, 
        keterangan, dokumen_pendukung, status, updated_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id,
        tanggal_mulai,
        tanggal_selesai,
        durasiHari,
        jenis,
        keterangan || null,
        dokumen_pendukung || null,
        status,
        adminId
      ]
    );

    let presensiGenerated = 0;
    
    // Jika status Disetujui, generate presensi otomatis
    if (status === 'Disetujui') {
      try {
        const izinData = {
          id: result.insertId,
          user_id: user_id,
          tanggal_mulai: tanggal_mulai,
          tanggal_selesai: tanggal_selesai,
          jenis: jenis
        };
        presensiGenerated = await generatePresensiIzinSimple(izinData);
      } catch (presensiError) {
        console.error('Presensi generation failed:', presensiError);
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['CREATE_IZIN_BY_ADMIN', `Admin membuat izin ${jenis} untuk ${user[0].nama} selama ${durasiHari} hari`, adminId]
    );

    res.json({
      success: true,
      message: `Izin berhasil dibuat ${status === 'Disetujui' ? 'dan disetujui' : ''}`,
      data: {
        id: result.insertId,
        durasi_hari: durasiHari,
        presensi_generated: presensiGenerated
      }
    });

  } catch (error) {
    console.error('Create izin by admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};
module.exports = {
  getAllIzin,
  getIzinById,
  getMyIzin,
  createIzin,
  updateIzinStatus,
  deleteIzin,
  generatePresensiIzinSimple,
  checkIzinBeforePresensi,
   createIzinByAdmin // Tambahkan ini
};