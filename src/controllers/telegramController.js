// controllers/telegramController.js
const { pool } = require('../config/database');

const handleTelegramWebhook = async (req, res) => {
  try {
    const data = req.body;
    const message = data.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!chatId || !text) {
      return res.json({ ok: true });
    }

    console.log(`📱 Telegram message from ${chatId}: ${text}`);

    // ======================================================
    // 🔹 1️⃣ Perintah /start → minta nama lengkap
    // ======================================================
    if (text === "/start") {
      await pool.execute("DELETE FROM telegram_sessions WHERE chat_id = ?", [chatId]);
      await pool.execute("INSERT INTO telegram_sessions (chat_id, step) VALUES (?, ?)", [
        chatId,
        "waiting_for_name",
      ]);

      await sendTelegramMessage(chatId, token, 
        "👋 Halo! Silakan ketik *nama lengkap Anda* untuk menghubungkan akun.",
        "Markdown"
      );

      return res.json({ ok: true });
    }

    // ======================================================
    // 🔹 2️⃣ Perintah /reset → hapus telegram_id
    // ======================================================
    if (text === "/reset") {
      const [users] = await pool.execute("SELECT * FROM users WHERE telegram_id = ?", [chatId]);

      if (users.length > 0) {
        await pool.execute("UPDATE users SET telegram_id = NULL WHERE telegram_id = ?", [chatId]);

        await sendTelegramMessage(chatId, token,
          "✅ Akun Anda telah diputuskan dari sistem.\n\n" +
          "Jika ingin menghubungkan kembali, ketik /start untuk memulai ulang."
        );
      } else {
        await sendTelegramMessage(chatId, token,
          "⚠️ Akun Anda belum terhubung dengan sistem apa pun."
        );
      }

      return res.json({ ok: true });
    }

    // ======================================================
    // 🔹 3️⃣ Saat user sedang kirim nama (setelah /start)
    // ======================================================
    const [sessions] = await pool.execute(
      "SELECT * FROM telegram_sessions WHERE chat_id = ? AND step = 'waiting_for_name'",
      [chatId]
    );

    if (sessions.length > 0) {
      const nama = text;

      const [users] = await pool.execute("SELECT id, nama FROM users WHERE nama = ?", [nama]);

      if (users.length > 0) {
        try {
          await pool.execute("UPDATE users SET telegram_id = ? WHERE id = ?", [
            chatId,
            users[0].id,
          ]);

          await pool.execute("DELETE FROM telegram_sessions WHERE chat_id = ?", [chatId]);

          await sendTelegramMessage(chatId, token,
            `✅ Terima kasih *${nama}*! Akun Anda telah berhasil dihubungkan dengan sistem.`,
            "Markdown"
          );
        } catch (err) {
          if (err.code === "ER_DUP_ENTRY") {
            await sendTelegramMessage(chatId, token,
              "⚠️ ID Telegram ini sudah terhubung dengan akun lain.\n\n" +
              "Ketik /reset jika ingin memutus sambungan dari akun sebelumnya."
            );
          } else {
            throw err;
          }
        }
      } else {
        await sendTelegramMessage(chatId, token,
          `❌ Maaf, nama *${nama}* tidak ditemukan di sistem.`,
          "Markdown"
        );
      }

      return res.json({ ok: true });
    }

    // ======================================================
    // 🔹 4️⃣ Default jika pesan lain
    // ======================================================
    await sendTelegramMessage(chatId, token,
      "Ketik /start untuk menghubungkan akun, atau /reset untuk memutus sambungan."
    );

    return res.json({ ok: true });

  } catch (error) {
    console.error('Telegram webhook error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error' 
    });
  }
};

// Helper function untuk mengirim pesan ke Telegram
const sendTelegramMessage = async (chatId, token, text, parse_mode = null) => {
  const payload = {
    chat_id: chatId,
    text: text
  };

  if (parse_mode) {
    payload.parse_mode = parse_mode;
  }

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

// Fungsi untuk mengirim notifikasi ke user
const sendNotification = async (userId, message) => {
  try {
    const [users] = await pool.execute(
      "SELECT telegram_id FROM users WHERE id = ? AND telegram_id IS NOT NULL",
      [userId]
    );

    if (users.length > 0 && users[0].telegram_id) {
      await sendTelegramMessage(
        users[0].telegram_id, 
        process.env.TELEGRAM_BOT_TOKEN, 
        message
      );
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error sending notification:', error);
    return false;
  }
};

// Fungsi untuk mendapatkan status koneksi Telegram user
const getTelegramStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const [users] = await pool.execute(
      "SELECT telegram_id FROM users WHERE id = ?",
      [userId]
    );

    if (users.length > 0) {
      const isConnected = !!users[0].telegram_id;
      
      res.json({
        success: true,
        data: {
          is_connected: isConnected,
          telegram_id: users[0].telegram_id
        }
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }
  } catch (error) {
    console.error('Get telegram status error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

// Fungsi untuk memutus koneksi Telegram
const disconnectTelegram = async (req, res) => {
  try {
    const userId = req.user.id;

    const [result] = await pool.execute(
      "UPDATE users SET telegram_id = NULL WHERE id = ?",
      [userId]
    );

    if (result.affectedRows > 0) {
      res.json({
        success: true,
        message: 'Koneksi Telegram berhasil diputus'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }
  } catch (error) {
    console.error('Disconnect telegram error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server'
    });
  }
};

module.exports = {
  handleTelegramWebhook,
  sendNotification,
  getTelegramStatus,
  disconnectTelegram
};