const { pool } = require('../config/database');

// ========== HARI KERJA CONTROLLERS ==========

const getAllHariKerja = async (req, res) => {
  try {
    const { tahun, bulan } = req.query;

    let query = 'SELECT * FROM hari_kerja WHERE 1=1';
    const params = [];

    if (tahun) {
      query += ' AND YEAR(tanggal) = ?';
      params.push(tahun);
    }

    if (bulan) {
      query += ' AND MONTH(tanggal) = ?';
      params.push(bulan);
    }

    query += ' ORDER BY tanggal DESC';

    const [hariKerja] = await pool.execute(query, params);

    res.json({
      success: true,
      data: hariKerja
    });

  } catch (error) {
    console.error('Get all hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createHariKerja = async (req, res) => {
  try {
    const { tanggal, is_hari_kerja, keterangan } = req.body;

    // Validasi required fields
    if (!tanggal) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal wajib diisi'
      });
    }

    // Cek apakah tanggal sudah ada
    const [existing] = await pool.execute(
      'SELECT id FROM hari_kerja WHERE tanggal = ?',
      [tanggal]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal sudah ada dalam database'
      });
    }

    // Insert hari kerja
    const [result] = await pool.execute(
      'INSERT INTO hari_kerja (tanggal, is_hari_kerja, keterangan) VALUES (?, ?, ?)',
      [tanggal, is_hari_kerja ? 1 : 0, keterangan]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_KERJA_CREATE', `Admin mengatur hari kerja: ${tanggal} - ${is_hari_kerja ? 'Hari Kerja' : 'Bukan Hari Kerja'}`, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: 'Hari kerja berhasil ditambahkan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateHariKerja = async (req, res) => {
  try {
    const { id } = req.params;
    const { tanggal, is_hari_kerja, keterangan } = req.body;

    // Cek apakah hari kerja exists
    const [existing] = await pool.execute(
      'SELECT tanggal FROM hari_kerja WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data hari kerja tidak ditemukan'
      });
    }

    // Cek apakah tanggal sudah ada (kecuali untuk data ini)
    if (tanggal !== existing[0].tanggal) {
      const [duplicate] = await pool.execute(
        'SELECT id FROM hari_kerja WHERE tanggal = ? AND id != ?',
        [tanggal, id]
      );

      if (duplicate.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Tanggal sudah ada dalam database'
        });
      }
    }

    // Update hari kerja
    await pool.execute(
      'UPDATE hari_kerja SET tanggal = ?, is_hari_kerja = ?, keterangan = ? WHERE id = ?',
      [tanggal, is_hari_kerja ? 1 : 0, keterangan, id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_KERJA_UPDATE', `Admin mengupdate hari kerja: ${tanggal} - ${is_hari_kerja ? 'Hari Kerja' : 'Bukan Hari Kerja'}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Hari kerja berhasil diupdate'
    });

  } catch (error) {
    console.error('Update hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteHariKerja = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah hari kerja exists
    const [existing] = await pool.execute(
      'SELECT tanggal FROM hari_kerja WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data hari kerja tidak ditemukan'
      });
    }

    // Delete hari kerja
    await pool.execute('DELETE FROM hari_kerja WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_KERJA_DELETE', `Admin menghapus hari kerja: ${existing[0].tanggal}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Hari kerja berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const bulkCreateHariKerja = async (req, res) => {
  try {
    const { start_date, end_date, is_hari_kerja, keterangan } = req.body;

    // Validasi required fields
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Start date dan end date wajib diisi'
      });
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    const results = [];
    let createdCount = 0;
    let updatedCount = 0;

    // Iterate through each day in the range
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const currentDate = new Date(date).toISOString().split('T')[0];

      // Cek apakah tanggal sudah ada
      const [existing] = await pool.execute(
        'SELECT id FROM hari_kerja WHERE tanggal = ?',
        [currentDate]
      );

      if (existing.length > 0) {
        // Update existing
        await pool.execute(
          'UPDATE hari_kerja SET is_hari_kerja = ?, keterangan = ? WHERE tanggal = ?',
          [is_hari_kerja ? 1 : 0, keterangan, currentDate]
        );
        updatedCount++;
      } else {
        // Insert new
        const [result] = await pool.execute(
          'INSERT INTO hari_kerja (tanggal, is_hari_kerja, keterangan) VALUES (?, ?, ?)',
          [currentDate, is_hari_kerja ? 1 : 0, keterangan]
        );
        createdCount++;
      }
    }

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_KERJA_BULK_CREATE', `Admin bulk update hari kerja: ${start_date} hingga ${end_date} - ${is_hari_kerja ? 'Hari Kerja' : 'Bukan Hari Kerja'}`, req.user.id]
    );

    res.json({
      success: true,
      message: `Bulk update berhasil: ${createdCount} dibuat, ${updatedCount} diupdate`,
      data: {
        created: createdCount,
        updated: updatedCount
      }
    });

  } catch (error) {
    console.error('Bulk create hari kerja error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// ========== HARI LIBUR CONTROLLERS ==========

const getAllHariLibur = async (req, res) => {
  try {
    const { tahun, is_tahunan } = req.query;

    let query = 'SELECT * FROM hari_libur WHERE 1=1';
    const params = [];

    if (tahun) {
      query += ' AND (tahun = ? OR is_tahunan = 1)';
      params.push(tahun);
    }

    if (is_tahunan !== undefined) {
      query += ' AND is_tahunan = ?';
      params.push(is_tahunan ? 1 : 0);
    }

    query += ' ORDER BY tanggal ASC';

    const [hariLibur] = await pool.execute(query, params);

    res.json({
      success: true,
      data: hariLibur
    });

  } catch (error) {
    console.error('Get all hari libur error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const createHariLibur = async (req, res) => {
  try {
    const { tanggal, nama_libur, is_tahunan, tahun } = req.body;

    // Validasi required fields
    if (!tanggal || !nama_libur) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal dan nama libur wajib diisi'
      });
    }

    // Cek apakah tanggal sudah ada
    const [existing] = await pool.execute(
      'SELECT id FROM hari_libur WHERE tanggal = ?',
      [tanggal]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Tanggal sudah ada dalam database'
      });
    }

    // Insert hari libur
    const targetTahun = is_tahunan ? null : (tahun || new Date().getFullYear());
    const [result] = await pool.execute(
      'INSERT INTO hari_libur (tanggal, nama_libur, is_tahunan, tahun) VALUES (?, ?, ?, ?)',
      [tanggal, nama_libur, is_tahunan ? 1 : 0, targetTahun]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_LIBUR_CREATE', `Admin menambahkan hari libur: ${nama_libur} - ${tanggal}`, req.user.id]
    );

    res.status(201).json({
      success: true,
      message: 'Hari libur berhasil ditambahkan',
      data: {
        id: result.insertId
      }
    });

  } catch (error) {
    console.error('Create hari libur error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const updateHariLibur = async (req, res) => {
  try {
    const { id } = req.params;
    const { tanggal, nama_libur, is_tahunan, tahun } = req.body;

    // Cek apakah hari libur exists
    const [existing] = await pool.execute(
      'SELECT tanggal, nama_libur FROM hari_libur WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data hari libur tidak ditemukan'
      });
    }

    // Cek apakah tanggal sudah ada (kecuali untuk data ini)
    if (tanggal !== existing[0].tanggal) {
      const [duplicate] = await pool.execute(
        'SELECT id FROM hari_libur WHERE tanggal = ? AND id != ?',
        [tanggal, id]
      );

      if (duplicate.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Tanggal sudah ada dalam database'
        });
      }
    }

    // Update hari libur
    const targetTahun = is_tahunan ? null : (tahun || new Date().getFullYear());
    await pool.execute(
      'UPDATE hari_libur SET tanggal = ?, nama_libur = ?, is_tahunan = ?, tahun = ? WHERE id = ?',
      [tanggal, nama_libur, is_tahunan ? 1 : 0, targetTahun, id]
    );

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_LIBUR_UPDATE', `Admin mengupdate hari libur: ${nama_libur} - ${tanggal}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Hari libur berhasil diupdate'
    });

  } catch (error) {
    console.error('Update hari libur error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const deleteHariLibur = async (req, res) => {
  try {
    const { id } = req.params;

    // Cek apakah hari libur exists
    const [existing] = await pool.execute(
      'SELECT nama_libur, tanggal FROM hari_libur WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data hari libur tidak ditemukan'
      });
    }

    // Delete hari libur
    await pool.execute('DELETE FROM hari_libur WHERE id = ?', [id]);

    // Log activity
    await pool.execute(
      'INSERT INTO system_log (event_type, description, user_id) VALUES (?, ?, ?)',
      ['HARI_LIBUR_DELETE', `Admin menghapus hari libur: ${existing[0].nama_libur} - ${existing[0].tanggal}`, req.user.id]
    );

    res.json({
      success: true,
      message: 'Hari libur berhasil dihapus'
    });

  } catch (error) {
    console.error('Delete hari libur error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

const getKalender = async (req, res) => {
  try {
    const { tahun, bulan } = req.query;

    const targetTahun = tahun || new Date().getFullYear();
    const targetBulan = bulan || new Date().getMonth() + 1;

    // Get hari kerja untuk bulan tersebut
    const [hariKerja] = await pool.execute(
      `SELECT tanggal, is_hari_kerja, keterangan 
       FROM hari_kerja 
       WHERE YEAR(tanggal) = ? AND MONTH(tanggal) = ?
       ORDER BY tanggal ASC`,
      [targetTahun, targetBulan]
    );

    // Get hari libur untuk bulan tersebut
    const [hariLibur] = await pool.execute(
      `SELECT tanggal, nama_libur, is_tahunan
       FROM hari_libur 
       WHERE (YEAR(tanggal) = ? OR is_tahunan = 1) AND MONTH(tanggal) = ?
       ORDER BY tanggal ASC`,
      [targetTahun, targetBulan]
    );

    // Combine data
    const kalender = [];
    const startDate = new Date(targetTahun, targetBulan - 1, 1);
    const endDate = new Date(targetTahun, targetBulan, 0);

    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
      const currentDate = new Date(date).toISOString().split('T')[0];
      const dayOfWeek = date.getDay(); // 0 = Minggu, 1 = Senin, etc

      // Default: Senin-Jumat adalah hari kerja
      let isHariKerjaDefault = dayOfWeek >= 1 && dayOfWeek <= 5;
      let keterangan = isHariKerjaDefault ? 'Hari kerja normal' : 'Weekend';

      // Check custom hari kerja
      const customHariKerja = hariKerja.find(hk => hk.tanggal.toISOString().split('T')[0] === currentDate);
      if (customHariKerja) {
        isHariKerjaDefault = customHariKerja.is_hari_kerja === 1;
        keterangan = customHariKerja.keterangan || keterangan;
      }

      // Check hari libur
      const libur = hariLibur.find(hl => {
        const liburDate = hl.tanggal.toISOString().split('T')[0];
        if (hl.is_tahunan) {
          // Untuk libur tahunan, bandingkan bulan dan tanggal saja
          return liburDate.substring(5) === currentDate.substring(5);
        }
        return liburDate === currentDate;
      });

      kalender.push({
        tanggal: currentDate,
        hari: date.toLocaleDateString('id-ID', { weekday: 'long' }),
        tanggal_format: date.toLocaleDateString('id-ID', { 
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }),
        is_hari_kerja: libur ? false : isHariKerjaDefault,
        is_weekend: dayOfWeek === 0 || dayOfWeek === 6,
        is_libur: !!libur,
        nama_libur: libur ? libur.nama_libur : null,
        keterangan: libur ? `Libur: ${libur.nama_libur}` : keterangan,
        is_custom: !!customHariKerja
      });
    }

    res.json({
      success: true,
      data: kalender
    });

  } catch (error) {
    console.error('Get kalender error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  // Hari Kerja
  getAllHariKerja,
  createHariKerja,
  updateHariKerja,
  deleteHariKerja,
  bulkCreateHariKerja,

  // Hari Libur
  getAllHariLibur,
  createHariLibur,
  updateHariLibur,
  deleteHariLibur,

  // Kalender
  getKalender
};