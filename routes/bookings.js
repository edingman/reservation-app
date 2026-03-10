const express = require('express');
const router = express.Router();
const db = require('../db');
const googleCalendar = require('../google-calendar');

// GET /api/bookings?date= â all bookings for a date
router.get('/', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query parameter required' });

  const dayStart = date + 'T00:00:00';
  const dayEnd = date + 'T23:59:59';

  const bookings = db.prepare(`
    SELECT b.*, r.name as room_name
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.start_time < ? AND b.end_time > ?
    ORDER BY b.start_time
  `).all(dayEnd, dayStart);

  res.json(bookings);
});

// POST /api/rooms/:roomId/bookings â create a booking
router.post('/', async (req, res) => {
  const { room_id, booked_by, description, start_time, end_time, source } = req.body;
  const bookingSource = ['portal', 'qr', 'ipad'].includes(source) ? source : 'local';

  if (!room_id || !booked_by || !start_time || !end_time) {
    return res.status(400).json({ error: 'room_id, booked_by, start_time, end_time required' });
  }

  if (new Date(end_time) <= new Date(start_time)) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Check for conflicts
  const conflict = db.prepare(`
    SELECT COUNT(*) as count FROM bookings
    WHERE room_id = ? AND start_time < ? AND end_time > ?
  `).get(room_id, end_time, start_time);

  if (conflict.count > 0) {
    return res.status(409).json({ error: 'Time slot conflicts with an existing booking' });
  }

  // Create Google Calendar event if configured
  let googleEventId = null;
  try {
    googleEventId = await googleCalendar.createEvent(room, {
      booked_by,
      description,
      start_time,
      end_time
    });
  } catch (err) {
    console.warn('Google Calendar sync failed (booking still saved locally):', err.message);
  }

  try {
    const result = db.prepare(`
      INSERT INTO bookings (room_id, booked_by, description, start_time, end_time, google_event_id, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(room_id, booked_by, description || '', start_time, end_time, googleEventId, bookingSource);

    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(booking);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bookings/:id â cancel a booking
router.delete('/:id', async (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // Delete Google Calendar event if exists
  if (booking.google_event_id) {
    try {
      await googleCalendar.deleteEvent(booking.google_event_id);
    } catch (err) {
      console.warn('Failed to delete Google Calendar event:', err.message);
    }
  }

  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
