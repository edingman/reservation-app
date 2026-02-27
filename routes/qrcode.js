const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../db');

// GET /api/rooms/:roomId/qrcode — generate QR code PNG for a room
router.get('/rooms/:roomId/qrcode', async (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Get base URL from settings or fall back to request host
  const baseUrlSetting = db.prepare("SELECT value FROM settings WHERE key = 'base_url'").get();
  const baseUrl = baseUrlSetting?.value || `${req.protocol}://${req.get('host')}`;

  const bookingUrl = `${baseUrl}/room.html?id=${room.id}`;

  try {
    const qrBuffer = await QRCode.toBuffer(bookingUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    res.set('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// GET /api/rooms/:roomId/qrcode-data — get QR code as data URL (for inline display)
router.get('/rooms/:roomId/qrcode-data', async (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const baseUrlSetting = db.prepare("SELECT value FROM settings WHERE key = 'base_url'").get();
  const baseUrl = baseUrlSetting?.value || `${req.protocol}://${req.get('host')}`;
  const bookingUrl = `${baseUrl}/room.html?id=${room.id}`;

  try {
    const dataUrl = await QRCode.toDataURL(bookingUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });
    res.json({ url: bookingUrl, dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

module.exports = router;
