const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../db');

function getRoomUrl(room, baseUrl) {
  if (room.office_slug && room.room_number) {
    return `${baseUrl}/room.html?office=${room.office_slug}&room=${room.room_number}`;
  }
  return `${baseUrl}/room.html?id=${room.id}`;
}

// GET /api/rooms/:roomId/qrcode â generate QR code PNG for a room
router.get('/rooms/:roomId/qrcode', async (req, res) => {
  const room = db.prepare(`
    SELECT r.*, o.slug as office_slug
    FROM rooms r LEFT JOIN offices o ON o.id = r.office_id
    WHERE r.id = ?
  `).get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const baseUrlSetting = db.prepare("SELECT value FROM settings WHERE key = 'base_url'").get();
  const baseUrl = baseUrlSetting?.value || `${req.protocol}://${req.get('host')}`;
  const bookingUrl = getRoomUrl(room, baseUrl);

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

// GET /api/rooms/:roomId/qrcode-data â get QR code as data URL (for inline display)
router.get('/rooms/:roomId/qrcode-data', async (req, res) => {
  const room = db.prepare(`
    SELECT r.*, o.slug as office_slug
    FROM rooms r LEFT JOIN offices o ON o.id = r.office_id
    WHERE r.id = ?
  `).get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const baseUrlSetting = db.prepare("SELECT value FROM settings WHERE key = 'base_url'").get();
  const baseUrl = baseUrlSetting?.value || `${req.protocol}://${req.get('host')}`;
  const bookingUrl = getRoomUrl(room, baseUrl);

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
