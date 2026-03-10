const express = require('express');
const router = express.Router();
const db = require('../db');

function toLocalISO(d) {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}:${s}`;
}

// GET /api/rooms â list all rooms (optionally filter by office_id)
router.get('/', (req, res) => {
  const { office_id } = req.query;
  let sql = `
    SELECT r.*, rm.floor_plan_id, rm.x_percent, rm.y_percent, o.name as office_name, o.slug as office_slug
    FROM rooms r
    LEFT JOIN room_markers rm ON rm.room_id = r.id
    LEFT JOIN offices o ON o.id = r.office_id
  `;
  const params = [];
  if (office_id) {
    sql += ' WHERE r.office_id = ?';
    params.push(office_id);
  }
  sql += ' ORDER BY o.name, r.room_number, r.name';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/rooms/lookup?office=slug&room=number â lookup room by office slug + room number
router.get('/lookup', (req, res) => {
  const { office, room } = req.query;
  if (!office || !room) return res.status(400).json({ error: 'office and room query parameters required' });

  const result = db.prepare(`
    SELECT r.*, o.name as office_name, o.slug as office_slug
    FROM rooms r
    JOIN offices o ON o.id = r.office_id
    WHERE o.slug = ? AND r.room_number = ?
  `).get(office, parseInt(room));

  if (!result) return res.status(404).json({ error: 'Room not found' });
  res.json(result);
});

// GET /api/rooms/:id â get single room
router.get('/:id', (req, res) => {
  const room = db.prepare(`
    SELECT r.*, rm.floor_plan_id, rm.x_percent, rm.y_percent, o.name as office_name, o.slug as office_slug
    FROM rooms r
    LEFT JOIN room_markers rm ON rm.room_id = r.id
    LEFT JOIN offices o ON o.id = r.office_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// GET /api/rooms/:id/status â room status for mobile/display pages
router.get('/:id/status', (req, res) => {
  const room = db.prepare(`
    SELECT r.*, o.name as office_name, o.slug as office_slug
    FROM rooms r
    LEFT JOIN offices o ON o.id = r.office_id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const now = toLocalISO(new Date());
  const todayStart = now.slice(0, 10) + 'T00:00:00';
  const todayEnd = now.slice(0, 10) + 'T23:59:59';

  const currentBooking = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time <= ? AND end_time > ?
    ORDER BY start_time LIMIT 1
  `).get(req.params.id, now, now);

  // Get bookings that overlap with today
  const todayBookings = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(req.params.id, todayEnd, todayStart);

  res.json({
    room,
    currentStatus: {
      available: !currentBooking,
      currentBooking: currentBooking || null
    },
    todaySchedule: todayBookings
  });
});

// GET /api/rooms/:roomId/bookings â bookings for a room on a date
router.get('/:roomId/bookings', (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date query parameter required' });

  const dayStart = date + 'T00:00:00';
  const dayEnd = date + 'T23:59:59';

  const bookings = db.prepare(`
    SELECT * FROM bookings
    WHERE room_id = ? AND start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(req.params.roomId, dayEnd, dayStart);

  res.json(bookings);
});

// POST /api/rooms â create a room
router.post('/', (req, res) => {
  const { name, capacity, amenities, google_resource_email, office_id } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!office_id) return res.status(400).json({ error: 'office_id is required' });

  // Auto-assign room_number within office
  const maxNum = db.prepare('SELECT MAX(room_number) as max FROM rooms WHERE office_id = ?').get(office_id);
  const roomNumber = (maxNum.max || 0) + 1;

  try {
    const result = db.prepare(`
      INSERT INTO rooms (name, capacity, amenities, google_resource_email, office_id, room_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, capacity || 1, amenities || '', google_resource_email || null, office_id, roomNumber);
    const room = db.prepare(`
      SELECT r.*, o.name as office_name, o.slug as office_slug
      FROM rooms r LEFT JOIN offices o ON o.id = r.office_id
      WHERE r.id = ?
    `).get(result.lastInsertRowid);
    res.status(201).json(room);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rooms/:id â update a room
router.put('/:id', (req, res) => {
  const { name, capacity, amenities, google_resource_email, office_id } = req.body;
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Room not found' });

  // If office_id changes, assign new room_number in that office
  let roomNumber = existing.room_number;
  const newOfficeId = office_id !== undefined ? office_id : existing.office_id;
  if (newOfficeId !== existing.office_id) {
    if (newOfficeId) {
      const maxNum = db.prepare('SELECT MAX(room_number) as max FROM rooms WHERE office_id = ?').get(newOfficeId);
      roomNumber = (maxNum.max || 0) + 1;
    } else {
      roomNumber = null;
    }
  }

  try {
    db.prepare(`
      UPDATE rooms SET name = ?, capacity = ?, amenities = ?, google_resource_email = ?, office_id = ?, room_number = ?
      WHERE id = ?
    `).run(
      name || existing.name,
      capacity ?? existing.capacity,
      amenities ?? existing.amenities,
      google_resource_email !== undefined ? google_resource_email : existing.google_resource_email,
      newOfficeId,
      roomNumber,
      req.params.id
    );
    const room = db.prepare(`
      SELECT r.*, o.name as office_name, o.slug as office_slug
      FROM rooms r LEFT JOIN offices o ON o.id = r.office_id
      WHERE r.id = ?
    `).get(req.params.id);
    res.json(room);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A room with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/rooms/:id â delete a room
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Room not found' });

  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PUT /api/rooms/:roomId/marker â set/update marker position
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

// DELETE /api/rooms/:roomId/marker â remove marker
router.delete('/:roomId/marker', (req, res) => {
  db.prepare('DELETE FROM room_markers WHERE room_id = ?').run(req.params.roomId);
  res.json({ success: true });
});

module.exports = router;
