const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const googleCalendar = require('../google-calendar');

// Configure multer for floor plan uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `floorplan-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// GET /api/floorplans?office_id=N or ?office=slug â list floors (filtered by office)
router.get('/', (req, res) => {
  const { office_id, office } = req.query;
  if (office) {
    // Lookup by slug
    const o = db.prepare('SELECT id FROM offices WHERE slug = ?').get(office);
    if (!o) return res.status(404).json({ error: 'Office not found' });
    const plans = db.prepare('SELECT fp.*, o.name as office_name, o.slug as office_slug FROM floor_plans fp JOIN offices o ON o.id = fp.office_id WHERE fp.office_id = ? ORDER BY fp.floor_number').all(o.id);
    return res.json(plans);
  }
  if (!office_id) {
    return res.json(db.prepare('SELECT fp.*, o.name as office_name FROM floor_plans fp JOIN offices o ON o.id = fp.office_id ORDER BY fp.office_id, fp.floor_number').all());
  }
  const plans = db.prepare('SELECT fp.*, o.name as office_name FROM floor_plans fp JOIN offices o ON o.id = fp.office_id WHERE fp.office_id = ? ORDER BY fp.floor_number').all(office_id);
  res.json(plans);
});

// POST /api/floorplans â create a floor (image optional)
router.post('/', upload.single('image'), async (req, res) => {
  const name = req.body.name;
  const officeId = req.body.office_id;
  const floorNumber = parseInt(req.body.floor_number);

  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!officeId) return res.status(400).json({ error: 'office_id is required' });
  if (!floorNumber && floorNumber !== 0) return res.status(400).json({ error: 'floor_number is required' });

  const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(officeId);
  if (!office) return res.status(404).json({ error: 'Office not found' });

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  const result = db.prepare(`
    INSERT INTO floor_plans (name, floor_number, image_path, office_id) VALUES (?, ?, ?, ?)
  `).run(name.trim(), floorNumber, imagePath, officeId);

  // Sync floor numbers to Google building
  if (office.google_building_id && googleCalendar.isConfigured()) {
    try {
      const allFloors = db.prepare('SELECT floor_number FROM floor_plans WHERE office_id = ? ORDER BY floor_number').all(officeId);
      await googleCalendar.updateBuildingFloors(
        office.google_building_id,
        allFloors.map(f => String(f.floor_number))
      );
    } catch (err) {
      console.warn('Failed to sync floor numbers to Google:', err.message);
    }
  }

  const plan = db.prepare('SELECT fp.*, o.name as office_name FROM floor_plans fp JOIN offices o ON o.id = fp.office_id WHERE fp.id = ?').get(result.lastInsertRowid);
  res.status(201).json(plan);
});

// PUT /api/floorplans/:id â update a floor (name, number)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Floor not found' });

  const name = req.body.name ? req.body.name.trim() : existing.name;
  const floorNumber = req.body.floor_number !== undefined ? parseInt(req.body.floor_number) : existing.floor_number;

  db.prepare('UPDATE floor_plans SET name = ?, floor_number = ? WHERE id = ?').run(name, floorNumber, req.params.id);

  const plan = db.prepare('SELECT fp.*, o.name as office_name FROM floor_plans fp JOIN offices o ON o.id = fp.office_id WHERE fp.id = ?').get(req.params.id);
  res.json(plan);
});

// POST /api/floorplans/:id/image â upload/replace floor plan image
router.post('/:id/image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });

  const existing = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Floor not found' });

  // Delete old image if exists
  if (existing.image_path) {
    const oldPath = path.join(__dirname, '..', existing.image_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const imagePath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE floor_plans SET image_path = ? WHERE id = ?').run(imagePath, req.params.id);

  const plan = db.prepare('SELECT fp.*, o.name as office_name FROM floor_plans fp JOIN offices o ON o.id = fp.office_id WHERE fp.id = ?').get(req.params.id);
  res.json(plan);
});

// DELETE /api/floorplans/:id â delete a floor
router.delete('/:id', async (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Floor not found' });

  // Delete the image file if exists
  if (plan.image_path) {
    const filePath = path.join(__dirname, '..', plan.image_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  // Delete markers associated with this floor
  db.prepare('DELETE FROM room_markers WHERE floor_plan_id = ?').run(req.params.id);
  db.prepare('DELETE FROM floor_plans WHERE id = ?').run(req.params.id);

  // Sync remaining floor numbers to Google building
  const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(plan.office_id);
  if (office && office.google_building_id && googleCalendar.isConfigured()) {
    try {
      const remainingFloors = db.prepare('SELECT floor_number FROM floor_plans WHERE office_id = ? ORDER BY floor_number').all(plan.office_id);
      await googleCalendar.updateBuildingFloors(
        office.google_building_id,
        remainingFloors.map(f => String(f.floor_number))
      );
    } catch (err) {
      console.warn('Failed to sync floor numbers to Google:', err.message);
    }
  }

  res.json({ success: true });
});

// GET /api/floorplans/:id/image â serve floor plan image
router.get('/:id/image', (req, res) => {
  const plan = db.prepare('SELECT image_path FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan || !plan.image_path) return res.status(404).json({ error: 'No image for this floor' });
  res.sendFile(path.join(__dirname, '..', plan.image_path));
});

// GET /api/floorplans/:id/markers â get markers for a floor
router.get('/:id/markers', (req, res) => {
  const markers = db.prepare(`
    SELECT rm.*, r.name as room_name, r.capacity, r.amenities
    FROM room_markers rm
    JOIN rooms r ON r.id = rm.room_id
    WHERE rm.floor_plan_id = ?
  `).all(req.params.id);
  res.json(markers);
});

// GET /api/floorplans/:id/status â markers with live availability for mobile view
router.get('/:id/status', (req, res) => {
  const floor = db.prepare(`
    SELECT fp.*, o.timezone, o.name as office_name, o.slug as office_slug
    FROM floor_plans fp
    JOIN offices o ON o.id = fp.office_id
    WHERE fp.id = ?
  `).get(req.params.id);
  if (!floor) return res.status(404).json({ error: 'Floor not found' });

  const { nowInTimezone } = require('../tz');
  const tz = floor.timezone || 'Europe/Stockholm';
  const now = nowInTimezone(tz);

  const markers = db.prepare(`
    SELECT rm.*, r.name as room_name, r.capacity, r.amenities, r.room_number,
           o.slug as office_slug
    FROM room_markers rm
    JOIN rooms r ON r.id = rm.room_id
    LEFT JOIN offices o ON o.id = r.office_id
    WHERE rm.floor_plan_id = ?
  `).all(req.params.id);

  const roomStatuses = markers.map(m => {
    const currentBooking = db.prepare(`
      SELECT * FROM bookings
      WHERE room_id = ? AND start_time <= ? AND end_time > ?
      ORDER BY start_time LIMIT 1
    `).get(m.room_id, now, now);

    const nextBooking = db.prepare(`
      SELECT * FROM bookings
      WHERE room_id = ? AND start_time > ? AND start_time < ?
      ORDER BY start_time LIMIT 1
    `).get(m.room_id, now, now.slice(0, 10) + 'T23:59:59');

    return {
      room_id: m.room_id,
      room_name: m.room_name,
      room_number: m.room_number,
      capacity: m.capacity,
      office_slug: m.office_slug,
      x_percent: m.x_percent,
      y_percent: m.y_percent,
      available: !currentBooking,
      current_booking: currentBooking ? {
        booked_by: currentBooking.booked_by,
        end_time: currentBooking.end_time
      } : null,
      next_booking: nextBooking ? {
        start_time: nextBooking.start_time,
        booked_by: nextBooking.booked_by
      } : null
    };
  });

  res.json({
    floor,
    timezone: tz,
    rooms: roomStatuses
  });
});

// POST /api/floorplans/ai/analyze â analyze a floor plan image with AI
router.post('/ai/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });

  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").get();
  if (!apiKey || !apiKey.value) {
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Anthropic API key not configured. Add it in Settings.' });
  }

  try {
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(req.file.originalname).toLowerCase();
    const mediaTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
    const mediaType = mediaTypes[ext] || 'image/png';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.value,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image }
            },
            {
              type: 'text',
              text: `Analyze this floor plan image. Identify all meeting rooms, offices, and bookable spaces.

For each room you detect, provide:
- A suggested name (e.g. "Meeting Room A", "Phone Booth 1", "Board Room")
- The approximate position as x_percent and y_percent (0-100) representing where the center of that room is on the image
- Estimated capacity (number of people)

Also generate an SVG floor plan that represents the layout you see. The SVG should:
- Be 1000x700 viewBox
- Use a dark theme: background #1a1a1a, walls #444, rooms as rounded rectangles with fill #2a2a2a and stroke #555
- Label each room inside with white text
- Show corridors and common areas in lighter gray (#333)
- Keep it clean and minimal

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "rooms": [
    { "name": "Room Name", "x_percent": 25.5, "y_percent": 30.0, "capacity": 6 }
  ],
  "svg": "<svg viewBox='0 0 1000 700' xmlns='http://www.w3.org/2000/svg'>...</svg>"
}`
            }
          ]
        }]
      })
    });

    // Clean up the temp uploaded file
    fs.unlinkSync(req.file.path);

    if (!response.ok) {
      const errBody = await response.text();
      console.log('[AI Analyze] API error:', errBody);
      return res.status(500).json({ error: 'AI analysis failed. Check your API key.' });
    }

    const data = await response.json();
    const text = data.content[0].text;

    // Parse JSON from response (handle potential markdown wrapping)
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Try extracting JSON from markdown code block
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error('Could not parse AI response');
      }
    }

    res.json({
      rooms: parsed.rooms || [],
      svg: parsed.svg || null
    });
  } catch (err) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('[AI Analyze] Error:', err.message);
    res.status(500).json({ error: err.message || 'AI analysis failed' });
  }
});

// POST /api/floorplans/ai/generate â generate a floor plan from scratch with AI
router.post('/ai/generate', express.json(), async (req, res) => {
  const { description } = req.body;
  if (!description) return res.status(400).json({ error: 'Description required' });

  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").get();
  if (!apiKey || !apiKey.value) {
    return res.status(400).json({ error: 'Anthropic API key not configured. Add it in Settings.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.value,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `Generate a floor plan layout based on this description: "${description}"

Create a realistic office floor plan. For each room, provide:
- A name (e.g. "Meeting Room A", "Phone Booth 1", "Board Room")
- Position as x_percent and y_percent (0-100)
- Estimated capacity

Also generate an SVG floor plan. The SVG should:
- Be 1000x700 viewBox
- Use a dark theme: background #1a1a1a, walls #444, rooms as rounded rectangles with fill #2a2a2a and stroke #555
- Label each room inside with white text (font-family: sans-serif, font-size: 14)
- Show corridors and common areas in lighter gray (#333)
- Include door indicators as small gaps in walls
- Keep it clean and architectural

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "rooms": [
    { "name": "Room Name", "x_percent": 25.5, "y_percent": 30.0, "capacity": 6 }
  ],
  "svg": "<svg viewBox='0 0 1000 700' xmlns='http://www.w3.org/2000/svg'>...</svg>"
}`
        }]
      })
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'AI generation failed. Check your API key.' });
    }

    const data = await response.json();
    const text = data.content[0].text;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        throw new Error('Could not parse AI response');
      }
    }

    res.json({
      rooms: parsed.rooms || [],
      svg: parsed.svg || null
    });
  } catch (err) {
    console.error('[AI Generate] Error:', err.message);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

module.exports = router;
