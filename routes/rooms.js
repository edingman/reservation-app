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

// GET /api/rooms/:id/alternatives â suggest other rooms in the same office
// Sorts by a composite score balancing availability and physical proximity
router.get('/:id/alternatives', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (!room.office_id) return res.json([]);

  const now = toLocalISO(new Date());
  const todayEnd = now.slice(0, 10) + 'T23:59:59';

  // Get marker position of the current room (for proximity calculation)
  const thisMarker = db.prepare(`
    SELECT rm.*, fp.name as floor_name
    FROM room_markers rm
    JOIN floor_plans fp ON fp.id = rm.floor_plan_id
    WHERE rm.room_id = ?
  `).get(req.params.id);

  // Build an ordered list of floor plan IDs for this office (for floor distance calc)
  const officeFloors = db.prepare(`
    SELECT id, name FROM floor_plans WHERE office_id = ? ORDER BY id
  `).all(room.office_id);
  const floorIndex = {};
  officeFloors.forEach((fp, i) => { floorIndex[fp.id] = i; });

  // Get all other rooms in the same office, with their marker positions and floor name
  const otherRooms = db.prepare(`
    SELECT r.*, o.slug as office_slug,
           rm.floor_plan_id, rm.x_percent, rm.y_percent,
           fp.name as floor_name
    FROM rooms r
    LEFT JOIN offices o ON o.id = r.office_id
    LEFT JOIN room_markers rm ON rm.room_id = r.id
    LEFT JOIN floor_plans fp ON fp.id = rm.floor_plan_id
    WHERE r.office_id = ? AND r.id != ?
    ORDER BY r.room_number
  `).all(room.office_id, req.params.id);

  const alternatives = otherRooms.map(r => {
    // --- Availability ---
    const currentBooking = db.prepare(`
      SELECT * FROM bookings
      WHERE room_id = ? AND start_time <= ? AND end_time > ?
      ORDER BY start_time LIMIT 1
    `).get(r.id, now, now);

    const searchFrom = currentBooking ? currentBooking.end_time : now;
    const nextBooking = db.prepare(`
      SELECT * FROM bookings
      WHERE room_id = ? AND start_time > ? AND start_time < ?
      ORDER BY start_time LIMIT 1
    `).get(r.id, searchFrom, todayEnd);

    let available, freeAt, freeAtMins, freeForMins;

    if (currentBooking) {
      freeAt = currentBooking.end_time;
      const backToBack = db.prepare(`
        SELECT * FROM bookings
        WHERE room_id = ? AND start_time <= ? AND end_time > ?
        ORDER BY start_time LIMIT 1
      `).get(r.id, freeAt, freeAt);

      available = false;
      freeAt = backToBack ? null : freeAt;
      freeAtMins = backToBack ? null : Math.ceil((new Date(currentBooking.end_time) - new Date(now)) / 60000);
      freeForMins = backToBack ? 0 : (nextBooking ? Math.floor((new Date(nextBooking.start_time) - new Date(currentBooking.end_time)) / 60000) : null);
    } else {
      available = true;
      freeAt = null;
      freeAtMins = 0;
      freeForMins = nextBooking
        ? Math.floor((new Date(nextBooking.start_time) - new Date(now)) / 60000)
        : null;
    }

    // --- Proximity ---
    let sameFloor = false;
    let floorDistance = null; // how many floors apart (0 = same floor)
    let distance = null;     // euclidean distance on floor plan (same floor only)
    const floorName = r.floor_name || null;

    if (thisMarker && r.floor_plan_id != null) {
      if (thisMarker.floor_plan_id === r.floor_plan_id) {
        sameFloor = true;
        floorDistance = 0;
        const dx = thisMarker.x_percent - r.x_percent;
        const dy = thisMarker.y_percent - r.y_percent;
        distance = Math.sqrt(dx * dx + dy * dy);
      } else {
        sameFloor = false;
        // Calculate how many floors apart based on ordered floor plan list
        const thisIdx = floorIndex[thisMarker.floor_plan_id];
        const otherIdx = floorIndex[r.floor_plan_id];
        floorDistance = (thisIdx != null && otherIdx != null)
          ? Math.abs(thisIdx - otherIdx)
          : 1; // fallback: assume 1 floor apart
      }
    }

    // --- Composite score (lower = better) ---
    const waitMins = available ? 0 : (freeAtMins ?? 999);

    // 10 points per floor of distance; 0 if same floor
    // distance_cost on same floor: ~20% apart â 1 min equivalent
    const floorPenalty = (floorDistance ?? 1) * 10;
    const distanceCost = (sameFloor && distance != null) ? distance * 0.15 : 0;
    const busyAllDay = (!available && freeAt === null) ? 100 : 0;

    const score = waitMins + floorPenalty + distanceCost + busyAllDay;

    return {
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      room_number: r.room_number,
      office_slug: r.office_slug,
      available,
      free_at: freeAt,
      free_at_mins: freeAtMins,
      free_for_mins: freeForMins,
      same_floor: sameFloor,
      floor_name: floorName,
      floors_away: floorDistance,
      distance: distance != null ? Math.round(distance) : null,
      score: Math.round(score * 10) / 10
    };
  });

  alternatives.sort((a, b) => a.score - b.score);

  res.json(alternatives);
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
