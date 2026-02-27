const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

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

// GET /api/floorplans — list all floor plans
router.get('/', (req, res) => {
  const plans = db.prepare('SELECT * FROM floor_plans ORDER BY created_at DESC').all();
  res.json(plans);
});

// POST /api/floorplans — upload a floor plan
router.post('/', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const name = req.body.name || 'Unnamed Floor Plan';

  const imagePath = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO floor_plans (name, image_path) VALUES (?, ?)
  `).run(name, imagePath);

  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(plan);
});

// DELETE /api/floorplans/:id — delete a floor plan
router.delete('/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM floor_plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Floor plan not found' });

  // Delete the image file
  const filePath = path.join(__dirname, '..', plan.image_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Delete markers associated with this floor plan
  db.prepare('DELETE FROM room_markers WHERE floor_plan_id = ?').run(req.params.id);
  db.prepare('DELETE FROM floor_plans WHERE id = ?').run(req.params.id);

  res.json({ success: true });
});

// GET /api/floorplans/:id/markers — get markers for a floor plan
router.get('/:id/markers', (req, res) => {
  const markers = db.prepare(`
    SELECT rm.*, r.name as room_name, r.capacity, r.amenities
    FROM room_markers rm
    JOIN rooms r ON r.id = rm.room_id
    WHERE rm.floor_plan_id = ?
  `).all(req.params.id);
  res.json(markers);
});

module.exports = router;
