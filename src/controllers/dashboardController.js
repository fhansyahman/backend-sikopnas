const { pool } = require('../config/database');

const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Today's presensi
    const [todayPresensi] = await pool.execute(
      'SELECT * FROM presensi WHERE user_id = ? AND tanggal = ?',
      [userId, today]
    );

    // Monthly stats
    const [monthlyStats] = await pool.execute(
      `SELECT 
        COUNT(*) as total_hari,
        SUM(CASE WHEN jam_masuk IS NOT NULL THEN 1 ELSE 0 END) as total_hadir,
        SUM(CASE WHEN status_masuk = 'Terlambat' THEN 1 ELSE 0 END) as total_terlambat,
        SUM(CASE WHEN status_masuk = 'Tanpa Keterangan' THEN 1 ELSE 0 END) as total_tanpa_keterangan
       FROM presensi 
       WHERE user_id = ? 
       AND MONTH(tanggal) = ? 
       AND YEAR(tanggal) = ?`,
      [userId, currentMonth, currentYear]
    );

    const stats = monthlyStats[0] || {
      total_hari: 0,
      total_hadir: 0,
      total_terlambat: 0,
      total_tanpa_keterangan: 0
    };

    // Get aktivitas bulan ini
    const [aktivitas] = await pool.execute(
      `SELECT COUNT(*) as total_aktivitas 
       FROM aktivitas_pekerja 
       WHERE user_id = ? 
       AND MONTH(tanggal) = ? 
       AND YEAR(tanggal) = ?`,
      [userId, currentMonth, currentYear]
    );

    res.json({
      success: true,
      data: {
        today: todayPresensi[0] || null,
        monthly: stats,
        total_aktivitas: aktivitas[0].total_aktivitas || 0
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = { getDashboardStats };