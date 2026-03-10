require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Ensure directories exist
['uploads', 'data', 'credentials'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Initialize database
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/offices', require('./routes/offices'));
app.use('/api/rooms', require('./routes/rooms'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/floorplans', require('./routes/floorplan'));
app.use('/api', require('./routes/qrcode'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/webhooks', require('./routes/webhooks'));

// Start server
app.listen(PORT, () => {
  console.log(`Bahn Express Room Booking running at http://localhost:${PORT}`);

  // Start auto-backup if enabled
  try {
    const driveBackup = require('./google-drive-backup');
    const autoBackupSetting = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup'").get();
    if (autoBackupSetting && autoBackupSetting.value !== 'false') {
      driveBackup.startAutoBackup(5);
    }
  } catch (err) {
    console.log('[Auto-backup] Not started:', err.message || 'Not configured');
  }

  // Start Google Calendar sync if enabled
  const googleCalendar = require('./google-calendar');
  const syncSetting = db.prepare("SELECT value FROM settings WHERE key = 'google_calendar_sync'").get();
  if (!syncSetting || syncSetting.value !== 'false') {
    // Sync every 60 seconds (fallback polling)
    const SYNC_INTERVAL = 60 * 1000;
    // Initial sync after 10 seconds (let server start up)
    setTimeout(async () => {
      try {
        const result = await googleCalendar.syncFromGoogle();
        if (result.synced) {
          console.log(`[Google Sync] Imported: ${result.imported}, Removed: ${result.removed}, Skipped: ${result.skipped}`);
        }
      } catch (err) {
        console.log('[Google Sync] Initial sync failed:', err.message);
      }

      // Set up push notifications if base_url is configured
      try {
        await googleCalendar.setupWatches();
      } catch (err) {
        console.log('[Google Sync] Push notifications not started:', err.message);
      }
    }, 10000);

    setInterval(async () => {
      try {
        const result = await googleCalendar.syncFromGoogle();
        if (result.synced && (result.imported > 0 || result.removed > 0)) {
          console.log(`[Google Sync] Imported: ${result.imported}, Removed: ${result.removed}`);
        }
      } catch (err) {
        console.log('[Google Sync] Sync failed:', err.message);
      }
    }, SYNC_INTERVAL);
    console.log('[Google Sync] Auto-sync enabled (every 60 seconds)');
  }
});
