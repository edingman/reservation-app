const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const googleCalendar = require('../google-calendar');

// Configure multer for Google service account key upload
const keyStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const credDir = path.join(__dirname, '..', 'credentials');
    if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
    cb(null, credDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'google-service-account.json');
  }
});

const uploadKey = multer({
  storage: keyStorage,
  limits: { fileSize: 1024 * 1024 }, // 1MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/json' || path.extname(file.originalname) === '.json') {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  }
});

// GET /api/settings — get all settings
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });

  // Check if key file exists
  const keyPath = path.join(__dirname, '..', 'credentials', 'google-service-account.json');
  settings.google_key_uploaded = fs.existsSync(keyPath);

  res.json(settings);
});

// PUT /api/settings — update settings
router.put('/', (req, res) => {
  const allowedKeys = ['base_url', 'timezone', 'google_delegated_user', 'google_customer_id'];
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const transaction = db.transaction((entries) => {
    for (const [key, value] of entries) {
      if (allowedKeys.includes(key)) {
        upsert.run(key, value);
      }
    }
  });

  transaction(Object.entries(req.body));

  // Reset Google Calendar client so it picks up new settings
  googleCalendar.resetClient();

  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

// POST /api/settings/google-key — upload Google service account JSON key
router.post('/google-key', uploadKey.single('keyfile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'JSON key file required' });

  // Validate the JSON structure
  try {
    const keyData = JSON.parse(fs.readFileSync(req.file.path, 'utf-8'));
    if (!keyData.client_email || !keyData.private_key) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid service account key: missing client_email or private_key' });
    }

    // Reset Google Calendar client so it picks up the new key
    googleCalendar.resetClient();

    res.json({
      success: true,
      client_email: keyData.client_email,
      project_id: keyData.project_id
    });
  } catch (err) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ error: 'Invalid JSON file: ' + err.message });
  }
});

// GET /api/settings/google-status — check Google Calendar connection
router.get('/google-status', async (req, res) => {
  try {
    const status = await googleCalendar.checkConnection();
    res.json(status);
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// GET /api/google/resources — list Google Workspace room resources
router.get('/google-resources', async (req, res) => {
  try {
    const resources = await googleCalendar.listRoomResources();
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
