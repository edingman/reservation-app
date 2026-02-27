const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const db = require('./db');

let driveClient = null;
let backupTimer = null;
let lastBackupHash = null;

const BACKUP_FOLDER_NAME = 'BahnExpress-RoomBooking-Backup';
const DB_BACKUP_NAME = 'database.sqlite';
const CREDENTIALS_BACKUP_NAME = 'google-service-account.json';
const SETTINGS_BACKUP_NAME = 'settings.json';
const UPLOADS_MANIFEST_NAME = 'uploads-manifest.json';

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || null;
}

function getKeyPath() {
  return path.join(__dirname, 'credentials', 'google-service-account.json');
}

function isConfigured() {
  const keyPath = getKeyPath();
  const delegatedUser = getSetting('google_delegated_user');
  return fs.existsSync(keyPath) && !!delegatedUser;
}

async function getDriveClient() {
  if (driveClient) return driveClient;

  const keyPath = getKeyPath();
  if (!fs.existsSync(keyPath)) throw new Error('Google service account key not uploaded');

  const delegatedUser = getSetting('google_delegated_user');
  if (!delegatedUser) throw new Error('Google delegated user not configured');

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    clientOptions: { subject: delegatedUser }
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function resetClient() {
  driveClient = null;
}

// ===== Find or create backup folder =====
async function getBackupFolderId() {
  const drive = await getDriveClient();

  // Check if folder ID is cached in settings
  let folderId = getSetting('backup_folder_id');
  if (folderId) {
    try {
      const check = await drive.files.get({ fileId: folderId, fields: 'id,trashed' });
      if (!check.data.trashed) return folderId;
    } catch (e) {
      // Folder doesn't exist anymore, create new one
    }
  }

  // Search for existing folder
  const search = await drive.files.list({
    q: `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive'
  });

  if (search.data.files && search.data.files.length > 0) {
    folderId = search.data.files[0].id;
  } else {
    // Create folder
    const folder = await drive.files.create({
      resource: {
        name: BACKUP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });
    folderId = folder.data.id;
  }

  // Cache the folder ID
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run('backup_folder_id', folderId);

  return folderId;
}

// ===== Upload/update a file in backup folder =====
async function uploadFileToDrive(folderId, fileName, filePath, mimeType = 'application/octet-stream') {
  const drive = await getDriveClient();

  // Check if file already exists in folder
  const search = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive'
  });

  const media = { mimeType, body: fs.createReadStream(filePath) };

  if (search.data.files && search.data.files.length > 0) {
    // Update existing file
    const fileId = search.data.files[0].id;
    await drive.files.update({ fileId, media });
    return fileId;
  } else {
    // Create new file
    const res = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media,
      fields: 'id'
    });
    return res.data.id;
  }
}

// ===== Upload JSON content to Drive =====
async function uploadJsonToDrive(folderId, fileName, data) {
  const drive = await getDriveClient();
  const content = JSON.stringify(data, null, 2);

  const search = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive'
  });

  const media = {
    mimeType: 'application/json',
    body: require('stream').Readable.from([content])
  };

  if (search.data.files && search.data.files.length > 0) {
    const fileId = search.data.files[0].id;
    await drive.files.update({ fileId, media });
    return fileId;
  } else {
    const res = await drive.files.create({
      resource: { name: fileName, parents: [folderId] },
      media,
      fields: 'id'
    });
    return res.data.id;
  }
}

// ===== Download a file from Drive =====
async function downloadFileFromDrive(folderId, fileName, destPath) {
  const drive = await getDriveClient();

  const search = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive'
  });

  if (!search.data.files || search.data.files.length === 0) return false;

  const fileId = search.data.files[0].id;
  const dest = fs.createWriteStream(destPath);

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return new Promise((resolve, reject) => {
    res.data.pipe(dest);
    dest.on('finish', () => resolve(true));
    dest.on('error', reject);
  });
}

// ===== Download JSON from Drive =====
async function downloadJsonFromDrive(folderId, fileName) {
  const drive = await getDriveClient();

  const search = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive'
  });

  if (!search.data.files || search.data.files.length === 0) return null;

  const fileId = search.data.files[0].id;
  const res = await drive.files.get({ fileId, alt: 'media' });
  return res.data;
}

// ===== BACKUP =====
async function performBackup() {
  if (!isConfigured()) throw new Error('Google not configured');

  const folderId = await getBackupFolderId();
  const results = { files: [], timestamp: new Date().toISOString() };

  // 1. Backup database
  const dbPath = path.join(__dirname, 'data', 'database.sqlite');
  if (fs.existsSync(dbPath)) {
    // Use SQLite backup API via a temp copy to avoid locking issues
    const tempPath = dbPath + '.backup';
    db.backup(tempPath).then(async () => {
      // This is async but better-sqlite3 backup returns a promise
    });
    // Fallback: just copy the file
    fs.copyFileSync(dbPath, tempPath);
    await uploadFileToDrive(folderId, DB_BACKUP_NAME, tempPath);
    fs.unlinkSync(tempPath);
    results.files.push('database.sqlite');
  }

  // 2. Backup credentials
  const keyPath = getKeyPath();
  if (fs.existsSync(keyPath)) {
    await uploadFileToDrive(folderId, CREDENTIALS_BACKUP_NAME, keyPath, 'application/json');
    results.files.push('google-service-account.json');
  }

  // 3. Backup all settings as JSON (human-readable)
  const settingsRows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  settingsRows.forEach(r => { settings[r.key] = r.value; });
  await uploadJsonToDrive(folderId, SETTINGS_BACKUP_NAME, settings);
  results.files.push('settings.json');

  // 4. Backup uploaded floor plan images
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const uploadFiles = fs.readdirSync(uploadsDir).filter(f => !f.startsWith('.'));
    const manifest = [];

    for (const file of uploadFiles) {
      const filePath = path.join(uploadsDir, file);
      await uploadFileToDrive(folderId, `upload_${file}`, filePath);
      manifest.push(file);
    }

    await uploadJsonToDrive(folderId, UPLOADS_MANIFEST_NAME, manifest);
    results.files.push(...uploadFiles.map(f => `uploads/${f}`));
  }

  // Save last backup time
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run('last_backup', results.timestamp);

  console.log(`[Backup] Completed: ${results.files.length} files at ${results.timestamp}`);
  return results;
}

// ===== RESTORE =====
async function performRestore() {
  if (!isConfigured()) throw new Error('Google not configured');

  const folderId = await getBackupFolderId();
  const results = { files: [], timestamp: new Date().toISOString() };

  // 1. Restore credentials first (needed for everything else)
  const credDir = path.join(__dirname, 'credentials');
  if (!fs.existsSync(credDir)) fs.mkdirSync(credDir, { recursive: true });
  const credRestored = await downloadFileFromDrive(folderId, CREDENTIALS_BACKUP_NAME, path.join(credDir, 'google-service-account.json'));
  if (credRestored) results.files.push('google-service-account.json');

  // 2. Restore database
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbRestored = await downloadFileFromDrive(folderId, DB_BACKUP_NAME, path.join(dataDir, 'database.sqlite.restore'));
  if (dbRestored) {
    results.files.push('database.sqlite');
    results.dbRestored = true;
    // Note: actual DB swap needs server restart - we copy it for now
    results.restartRequired = true;
  }

  // 3. Restore uploaded files
  const manifest = await downloadJsonFromDrive(folderId, UPLOADS_MANIFEST_NAME);
  if (manifest && Array.isArray(manifest)) {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    for (const file of manifest) {
      const restored = await downloadFileFromDrive(folderId, `upload_${file}`, path.join(uploadsDir, file));
      if (restored) results.files.push(`uploads/${file}`);
    }
  }

  console.log(`[Restore] Completed: ${results.files.length} files`);
  return results;
}

// ===== AUTO-BACKUP =====
function startAutoBackup(intervalMinutes = 5) {
  if (backupTimer) clearInterval(backupTimer);

  backupTimer = setInterval(async () => {
    if (!isConfigured()) return;

    const autoBackupEnabled = getSetting('auto_backup') !== 'false';
    if (!autoBackupEnabled) return;

    try {
      await performBackup();
    } catch (err) {
      console.warn('[Auto-backup] Failed:', err.message);
    }
  }, intervalMinutes * 60 * 1000);

  console.log(`[Auto-backup] Started (every ${intervalMinutes} minutes)`);
}

function stopAutoBackup() {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
    console.log('[Auto-backup] Stopped');
  }
}

// ===== BACKUP STATUS =====
function getBackupStatus() {
  const lastBackup = getSetting('last_backup');
  const autoEnabled = getSetting('auto_backup') !== 'false';

  return {
    lastBackup,
    autoBackupEnabled: autoEnabled,
    autoBackupRunning: !!backupTimer,
    configured: isConfigured()
  };
}

module.exports = {
  performBackup,
  performRestore,
  startAutoBackup,
  stopAutoBackup,
  getBackupStatus,
  resetClient
};
