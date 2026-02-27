const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/rooms — list all rooms
router.get('/', (req, res) => {
  const rooms = db.prepare(`
    SELECT r.*, rm.floor_plan_id, rm.x_percent, rm.y_percent
    FROM rooms r
    LEFT JOIN room_markers rm ON rm.room_id = r.id
    ORDER BY r.name
  `).all();
  res.json(rooms);
});

// GET /api/rooms/:id — get single room
router.get('/:id', (req, res) => {
  const room = db.prepare(`
    SELECT r.*, rm.floor_plan_id, rm.x_percent, rm.y_percent
    FROM rooms r
    LEFT JOIN room_markers rm ON rm.room_id = r.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// GET /api/rooms/:id/status — room status for mobile/display pages
router.get('/:id/status', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const now = new Date().toISOString();
  const todayStart = now.slice(0, 10) + 'T00:00:00';
  const todayEnd = now.slice(0, 10) + 'T23:59:59';

  const currentBooking = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time <= ? AND end_time > ?
    ORDER BY start_time LIMIT 1
  `).get(req.params.id, now, now);

  const todaySchedule = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time >= ? AND end_time <= ?
    ORDER BY start_time
  `).all(req.params.id, todayStart, todayEnd + 'Z');

  // Also get bookings that overlap with today but may start before or end after
  const todayBookings = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(req.params.id, todayEnd + 'Z', todayStart);

  res.json({
    room,
    currentStatus: {
      available: !currentBooking,
      currentBooking: currentBooking || null
    },
    todaySchedule: todayBookings
  });
});

// GET /api/rooms/:roomId/bookings — bookings for a room on a date
router.get('/:roomId/bookings', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query parameter required' });

  const dayStart = date + 'T00:00:00';
  const dayEnd = date + 'T23:59:59Z';

  const bookings = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(req.params.roomId, dayEnd, dayStart);

  res.json(bookings);
});

// POST /api/rooms — create a room
router.post('/', (req, res) => {
  const { name, capacity, amenities, google_resource_email } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  try {
    const result = db.prepare(`
      INSERT INTO rooms (name, capacity, amenities, google_resource_email)
      VALUES (?, ?, ?, ?)
    `).run(name, capacity || 1, amenities || '', google_resource_email || null);
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(room);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rooms/:id — update a room
router.put('/:id', (req, res) => {
  const { name, capacity, amenities, google_resource_email } = req.body;
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Room not found' });

  try {
    db.prepare(`
      UPDATE rooms SET name = ?, capacity = ?, amenities = ?, google_resource_email = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      capacity ?? existing.capacity,
      amenities ?? existing.amenities,
      google_resource_email !== undefined ? google_resource_email : existing.google_resource_email,
      req.params.id
    );
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    res.json(room);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rooms/:id — delete a room
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Room not found' });

  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /api/rooms/:roomId/marker — set/update marker position
router.put('/:roomId/marker', (req, res) => {
  const { floor_plan_id, x_percent, y_percent } = req.body;
  if (!floor_plan_id || x_percent == null || y_percent == null) {
    return res.status(400).json({ error: 'floor_plan_id, x_percent, y_percent required' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const existing = db.prepare('SELECT * FROM room_markers WHERE room_id = ?').get(req.params.roomId);
  if (existing) {
    db.prepare(`
      UPDATE room_markers SET floor_plan_id = ?, x_percent = ?, y_percent = ?
      WHERE room_id = ?
    `).run(floor_plan_id, x_percent, y_percent, req.params.roomId);
  } else {
    db.prepare(`
      INSERT INTO room_markers (room_id, floor_plan_id, x_percent, y_percent)
      VALUES (?, ?, ?, ?)
    `).run(req.params.roomId, floor_plan_id, x_percent, y_percent);
  }

  res.json({ success: true });
});

// DELETE /api/rooms/:roomId/marker — remove marker
router.delete('/:roomId/marker', (req, res) => {
  db.prepare('DELETE FROM room_markers WHERE room_id = ?').run(req.params.roomId);
  res.json({ success: true });
});

module.exports = router;
