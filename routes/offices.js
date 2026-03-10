const express = require('express');
const router = express.Router();
const db = require('../db');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/offices â list all offices
router.get('/', (req, res) => {
  const offices = db.prepare(`
    SELECT o.*, COUNT(r.id) as room_count
    FROM offices o
    LEFT JOIN rooms r ON r.office_id = o.id
    GROUP BY o.id
    ORDER BY o.name
  `).all();
  res.json(offices);
});

// GET /api/offices/:id â get single office
router.get('/:id', (req, res) => {
  const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(req.params.id);
  if (!office) return res.status(404).json({ error: 'Office not found' });
  res.json(office);
});

// POST /api/offices â create an office
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const slug = slugify(name.trim());
  if (!slug) return res.status(400).json({ error: 'Invalid office name' });

  try {
    const result = db.prepare('INSERT INTO offices (name, slug) VALUES (?, ?)').run(name.trim(), slug);
    const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(office);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An office with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/offices/:id â update an office
router.put('/:id', (req, res) => {
  const { name } = req.body;
  const existing = db.prepare('SELECT * FROM offices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Office not found' });

  const newName = name ? name.trim() : existing.name;
  const newSlug = slugify(newName);

  try {
    db.prepare('UPDATE offices SET name = ?, slug = ? WHERE id = ?').run(newName, newSlug, req.params.id);
    const office = db.prepare('SELECT * FROM offices WHERE id = ?').get(req.params.id);
    res.json(office);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An office with that name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/offices/:id â delete an office
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM offices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Office not found' });

  // CASCADE will delete rooms, floor_plans, and their bookings/markers
  db.prepare('DELETE FROM offices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
