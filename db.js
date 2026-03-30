const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'database.sqlite'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'Europe/Stockholm',
    google_building_id TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 1,
    amenities TEXT DEFAULT '',
    google_resource_email TEXT DEFAULT NULL,
    office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    room_number INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_office ON rooms(office_id, room_number);

  CREATE TABLE IF NOT EXISTS floor_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    floor_number INTEGER NOT NULL DEFAULT 1,
    image_path TEXT DEFAULT NULL,
    office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_floor_plans_office ON floor_plans(office_id);

  CREATE TABLE IF NOT EXISTS room_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL UNIQUE,
    floor_plan_id INTEGER NOT NULL,
    x_percent REAL NOT NULL,
    y_percent REAL NOT NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (floor_plan_id) REFERENCES floor_plans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    booked_by TEXT NOT NULL,
    description TEXT DEFAULT '',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    google_event_id TEXT DEFAULT NULL,
    source TEXT DEFAULT 'local',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_bookings_room_time
    ON bookings(room_id, start_time, end_time);

  CREATE INDEX IF NOT EXISTS idx_bookings_google_event
    ON bookings(google_event_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migrations: add timezone to offices
try {
  db.prepare("SELECT timezone FROM offices LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE offices ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Stockholm'");
}

// Migrations: add floor_number and make image_path nullable
try {
  db.prepare("SELECT floor_number FROM floor_plans LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE floor_plans ADD COLUMN floor_number INTEGER NOT NULL DEFAULT 1");
}

// Migrate floor_plans to allow NULL image_path (SQLite can't ALTER COLUMN, so rebuild)
try {
  const colInfo = db.prepare("PRAGMA table_info(floor_plans)").all();
  const imgCol = colInfo.find(c => c.name === 'image_path');
  if (imgCol && imgCol.notnull === 1) {
    db.exec(`
      CREATE TABLE floor_plans_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        floor_number INTEGER NOT NULL DEFAULT 1,
        image_path TEXT DEFAULT NULL,
        office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO floor_plans_new (id, name, floor_number, image_path, office_id, created_at)
        SELECT id, name, floor_number, image_path, office_id, created_at FROM floor_plans;
      DROP TABLE floor_plans;
      ALTER TABLE floor_plans_new RENAME TO floor_plans;
      CREATE INDEX IF NOT EXISTS idx_floor_plans_office ON floor_plans(office_id);
    `);
  }
} catch (e) {
  // Already migrated or fresh DB
}

module.exports = db;
