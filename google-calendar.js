const { google } = require('googleapis');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

let calendarClient = null;
let adminClient = null;

// Webhook verification token â generated once and persisted
function getWebhookToken() {
  let token = getSetting('google_webhook_token');
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_webhook_token', ?)").run(token);
  }
  return token;
}

// Track active watch channels for renewal
let watchRenewalTimer = null;

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

async function getAuth() {
  const keyPath = getKeyPath();
  if (!fs.existsSync(keyPath)) {
    throw new Error('Google service account key not uploaded');
  }

  const delegatedUser = getSetting('google_delegated_user');
  if (!delegatedUser) {
    throw new Error('Google delegated user not configured');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
    clientOptions: {
      subject: delegatedUser
    }
  });

  return auth;
}

async function getCalendarClient() {
  if (calendarClient) return calendarClient;
  const auth = await getAuth();
  calendarClient = google.calendar({ version: 'v3', auth });
  return calendarClient;
}

async function getAdminClient() {
  if (adminClient) return adminClient;
  const auth = await getAuth();
  adminClient = google.admin({ version: 'directory_v1', auth });
  return adminClient;
}

function resetClient() {
  calendarClient = null;
  adminClient = null;
}

async function createEvent(room, booking) {
  if (!isConfigured() || !room.google_resource_email) return null;

  const calendar = await getCalendarClient();
  const timezone = getSetting('timezone') || 'UTC';

  const event = {
    summary: `${booking.description || 'Room Booking'} â ${room.name}`,
    description: `Booked by: ${booking.booked_by}\nRoom: ${room.name}`,
    location: room.name,
    start: { dateTime: booking.start_time, timeZone: timezone },
    end: { dateTime: booking.end_time, timeZone: timezone },
    attendees: [
      { email: room.google_resource_email, resource: true }
    ]
  };

  const delegatedUser = getSetting('google_delegated_user');
  const result = await calendar.events.insert({
    calendarId: delegatedUser,
    resource: event,
    sendUpdates: 'none'
  });

  return result.data.id;
}

async function deleteEvent(googleEventId) {
  if (!isConfigured()) return;

  const calendar = await getCalendarClient();
  const delegatedUser = getSetting('google_delegated_user');

  await calendar.events.delete({
    calendarId: delegatedUser,
    eventId: googleEventId,
    sendUpdates: 'none'
  });
}

async function checkConnection() {
  if (!isConfigured()) {
    const keyExists = fs.existsSync(getKeyPath());
    const delegatedUser = getSetting('google_delegated_user');
    return {
      connected: false,
      keyUploaded: keyExists,
      delegatedUser: !!delegatedUser,
      error: !keyExists ? 'Service account key not uploaded' :
             !delegatedUser ? 'Delegated user email not set' : 'Unknown'
    };
  }

  try {
    const calendar = await getCalendarClient();
    const delegatedUser = getSetting('google_delegated_user');
    await calendar.calendarList.list({ maxResults: 1 });

    // Read key file for display info
    const keyData = JSON.parse(fs.readFileSync(getKeyPath(), 'utf-8'));

    return {
      connected: true,
      clientEmail: keyData.client_email,
      projectId: keyData.project_id,
      delegatedUser
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

async function listRoomResources() {
  if (!isConfigured()) {
    throw new Error('Google Calendar not configured');
  }

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  const result = await admin.resources.calendars.list({
    customer: customerId,
    maxResults: 200
  });

  return (result.data.items || []).map(r => ({
    id: r.resourceId,
    name: r.resourceName,
    email: r.resourceEmail,
    type: r.resourceType,
    description: r.userVisibleDescription,
    capacity: r.capacity,
    building: r.buildingId,
    floor: r.floorName
  }));
}

/**
 * Purge Google Workspace resources not tracked in the portal.
 * Deletes any calendar resources whose email doesn't match a portal room,
 * and any buildings whose ID doesn't match a portal office.
 * Returns a summary of what was removed.
 */
async function purgeOrphanedResources() {
  if (!isConfigured()) return { purged: false };

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';
  const removed = { rooms: [], buildings: [] };

  // --- Purge orphaned room resources ---
  const resourceResult = await admin.resources.calendars.list({
    customer: customerId,
    maxResults: 500
  });
  const googleResources = resourceResult.data.items || [];

  // Get all resource emails tracked in the portal
  const portalEmails = new Set(
    db.prepare('SELECT google_resource_email FROM rooms WHERE google_resource_email IS NOT NULL').all()
      .map(r => r.google_resource_email)
  );

  for (const resource of googleResources) {
    if (!portalEmails.has(resource.resourceEmail)) {
      try {
        await admin.resources.calendars.delete({
          customer: customerId,
          calendarResourceId: resource.resourceId
        });
        removed.rooms.push(resource.resourceName || resource.resourceEmail);
      } catch (err) {
        console.warn(`Failed to purge orphaned resource "${resource.resourceName}":`, err.message);
      }
    }
  }

  // --- Purge orphaned buildings ---
  const buildingResult = await admin.resources.buildings.list({
    customer: customerId,
    maxResults: 500
  });
  const googleBuildings = buildingResult.data.buildings || [];

  const portalBuildingIds = new Set(
    db.prepare('SELECT google_building_id FROM offices WHERE google_building_id IS NOT NULL').all()
      .map(o => o.google_building_id)
  );

  for (const building of googleBuildings) {
    if (!portalBuildingIds.has(building.buildingId)) {
      try {
        await admin.resources.buildings.delete({
          customer: customerId,
          buildingId: building.buildingId
        });
        removed.buildings.push(building.buildingName || building.buildingId);
      } catch (err) {
        console.warn(`Failed to purge orphaned building "${building.buildingName}":`, err.message);
      }
    }
  }

  return { purged: true, removed };
}

/**
 * Create a building (office) in Google Workspace.
 * Returns the buildingId.
 */
async function createBuilding(officeName, slug) {
  if (!isConfigured()) return null;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  const buildingId = slug + '-' + Date.now();

  const result = await admin.resources.buildings.insert({
    customer: customerId,
    requestBody: {
      buildingId,
      buildingName: officeName,
      description: `Office: ${officeName}`
    }
  });

  return result.data.buildingId;
}

/**
 * Delete a building from Google Workspace.
 */
async function deleteBuilding(buildingId) {
  if (!isConfigured() || !buildingId) return;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  await admin.resources.buildings.delete({
    customer: customerId,
    buildingId
  });
}

/**
 * Add or update floor names on a Google Workspace building.
 */
async function updateBuildingFloors(buildingId, floorNames) {
  if (!isConfigured() || !buildingId) return;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  await admin.resources.buildings.patch({
    customer: customerId,
    buildingId,
    requestBody: {
      floorNames
    }
  });
}

/**
 * Create a room resource in Google Workspace.
 * Links to building and floor if provided.
 * Returns the resource email.
 */
async function createRoomResource(roomName, capacity, officeName, buildingId, floorName) {
  if (!isConfigured()) return null;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  const resourceId = roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();

  const resource = {
    resourceId,
    resourceName: officeName ? `${roomName} (${officeName})` : roomName,
    resourceType: 'CONFERENCE_ROOM',
    capacity: capacity || 1,
    userVisibleDescription: officeName ? `${roomName} â ${officeName}` : roomName
  };

  if (buildingId) resource.buildingId = buildingId;
  if (floorName) resource.floorName = floorName;

  const result = await admin.resources.calendars.insert({
    customer: customerId,
    requestBody: resource
  });

  return result.data.resourceEmail;
}

/**
 * Update a room resource in Google Workspace (name, capacity, building, floor).
 */
async function updateRoomResource(resourceEmail, { name, capacity, officeName, buildingId, floorName }) {
  if (!isConfigured() || !resourceEmail) return;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  // Find the resource by email
  const list = await admin.resources.calendars.list({
    customer: customerId,
    maxResults: 500
  });

  const resource = (list.data.items || []).find(r => r.resourceEmail === resourceEmail);
  if (!resource) return;

  const patch = {};
  if (name) patch.resourceName = officeName ? `${name} (${officeName})` : name;
  if (capacity) patch.capacity = capacity;
  if (name && officeName) patch.userVisibleDescription = `${name} â ${officeName}`;
  if (buildingId !== undefined) patch.buildingId = buildingId || '';
  if (floorName !== undefined) patch.floorName = floorName || '';

  await admin.resources.calendars.patch({
    customer: customerId,
    calendarResourceId: resource.resourceId,
    requestBody: patch
  });
}

/**
 * Delete a room resource from Google Workspace.
 */
async function deleteRoomResource(resourceEmail) {
  if (!isConfigured() || !resourceEmail) return;

  const admin = await getAdminClient();
  const customerId = getSetting('google_customer_id') || 'my_customer';

  // Find the resource by email
  const list = await admin.resources.calendars.list({
    customer: customerId,
    maxResults: 500
  });

  const resource = (list.data.items || []).find(r => r.resourceEmail === resourceEmail);
  if (!resource) return;

  await admin.resources.calendars.delete({
    customer: customerId,
    calendarResourceId: resource.resourceId
  });
}

/**
 * Fetch events from a room's resource calendar within a time range.
 */
async function fetchRoomEvents(resourceEmail, timeMin, timeMax) {
  if (!isConfigured()) return [];

  const calendar = await getCalendarClient();
  const events = [];
  let pageToken = null;

  do {
    const result = await calendar.events.list({
      calendarId: resourceEmail,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken
    });

    if (result.data.items) {
      events.push(...result.data.items);
    }
    pageToken = result.data.nextPageToken;
  } while (pageToken);

  return events;
}

/**
 * Sync events FROM Google Calendar into the local database.
 * Imports room bookings made directly in Google Calendar.
 * Returns stats about what was synced.
 */
async function syncFromGoogle() {
  if (!isConfigured()) {
    return { synced: false, reason: 'Google Calendar not configured' };
  }

  const rooms = db.prepare('SELECT * FROM rooms WHERE google_resource_email IS NOT NULL AND google_resource_email != ""').all();
  if (rooms.length === 0) {
    return { synced: false, reason: 'No rooms linked to Google Calendar resources' };
  }

  const delegatedUser = getSetting('google_delegated_user');

  // Sync window: from now to 30 days ahead (and 1 day back for recent changes)
  const now = new Date();
  const timeMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  let imported = 0;
  let removed = 0;
  let skipped = 0;
  const errors = [];

  for (const room of rooms) {
    try {
      const events = await fetchRoomEvents(room.google_resource_email, timeMin, timeMax);

      // Get all google_event_ids for imported bookings for this room
      const existingImports = db.prepare(
        "SELECT google_event_id FROM bookings WHERE room_id = ? AND google_event_id IS NOT NULL"
      ).all(room.id).map(b => b.google_event_id);

      const existingSet = new Set(existingImports);
      const googleEventIds = new Set();

      for (const event of events) {
        if (!event.id || event.status === 'cancelled') continue;

        googleEventIds.add(event.id);

        // Skip if we already have this event
        if (existingSet.has(event.id)) {
          skipped++;
          continue;
        }

        // Extract start/end times
        const startTime = event.start?.dateTime || event.start?.date;
        const endTime = event.end?.dateTime || event.end?.date;
        if (!startTime || !endTime) continue;

        // Respect private/confidential events â show who, but not what
        const isPrivate = event.visibility === 'private' || event.visibility === 'confidential';
        const rawName = event.organizer?.displayName || event.creator?.displayName || null;
        const rawEmail = event.organizer?.email || event.creator?.email || null;
        // Extract first name: from displayName ("Edvin Ingman" â "Edvin") or email ("edvin.ingman@..." â "Edvin")
        const firstName = rawName
          ? rawName.split(/\s/)[0]
          : rawEmail
            ? rawEmail.split('@')[0].split(/[._-]/)[0].replace(/^./, c => c.toUpperCase())
            : null;
        const bookedBy = isPrivate
          ? (firstName || 'Private')
          : (rawName || rawEmail || 'Google Calendar');
        const description = isPrivate
          ? `${firstName ? firstName + "'s" : ''} Confidential Meeting`.trim()
          : (event.summary || 'Google Calendar Booking');

        // Check for time conflicts with local bookings
        const conflict = db.prepare(`
          SELECT COUNT(*) as count FROM bookings
          WHERE room_id = ? AND start_time < ? AND end_time > ? AND source = 'local'
        `).get(room.id, endTime, startTime);

        if (conflict.count > 0) {
          skipped++;
          continue;
        }

        // Insert the imported booking
        db.prepare(`
          INSERT INTO bookings (room_id, booked_by, description, start_time, end_time, google_event_id, source)
          VALUES (?, ?, ?, ?, ?, ?, 'google_calendar')
        `).run(room.id, bookedBy, description, startTime, endTime, event.id);

        imported++;
      }

      // Remove imported bookings that no longer exist in Google Calendar
      const importedBookings = db.prepare(
        "SELECT id, google_event_id FROM bookings WHERE room_id = ? AND source = 'google_calendar' AND google_event_id IS NOT NULL AND start_time >= ?"
      ).all(room.id, timeMin);

      for (const booking of importedBookings) {
        if (!googleEventIds.has(booking.google_event_id)) {
          db.prepare('DELETE FROM bookings WHERE id = ?').run(booking.id);
          removed++;
        }
      }
    } catch (err) {
      errors.push(`Room "${room.name}": ${err.message}`);
    }
  }

  // Store last sync time
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_google_sync', ?)").run(new Date().toISOString());

  return { synced: true, imported, removed, skipped, errors };
}

// ===== Push Notifications (Watch Channels) =====

/**
 * Set up watch channels for all linked room resource calendars.
 * Google will POST to our webhook when events change.
 * Requires base_url to be configured (server must be reachable from internet).
 */
async function setupWatches() {
  if (!isConfigured()) {
    throw new Error('Google Calendar not configured');
  }

  const baseUrl = getSetting('base_url');
  if (!baseUrl) {
    throw new Error('Base URL not configured â required for push notifications');
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhooks/google-calendar`;
  const rooms = db.prepare('SELECT * FROM rooms WHERE google_resource_email IS NOT NULL AND google_resource_email != ""').all();

  if (rooms.length === 0) {
    throw new Error('No rooms linked to Google Calendar resources');
  }

  const calendar = await getCalendarClient();
  const token = getWebhookToken();
  let watchCount = 0;
  const errors = [];

  // Stop existing watches first
  await stopAllWatches();

  for (const room of rooms) {
    try {
      const channelId = `room-${room.id}-${Date.now()}`;
      // Watch expires in 7 days (Google max is ~30 days, 7 is safe)
      const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;

      const result = await calendar.events.watch({
        calendarId: room.google_resource_email,
        requestBody: {
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          token: token,
          expiration: String(expiration)
        }
      });

      // Store channel info for renewal/cleanup
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
      `).run(`watch_channel_${room.id}`, JSON.stringify({
        channelId: result.data.id,
        resourceId: result.data.resourceId,
        expiration: result.data.expiration,
        roomEmail: room.google_resource_email
      }));

      watchCount++;
    } catch (err) {
      errors.push(`Room "${room.name}": ${err.message}`);
    }
  }

  // Schedule renewal before expiry (renew after 6 days)
  if (watchCount > 0) {
    const RENEWAL_INTERVAL = 6 * 24 * 60 * 60 * 1000;
    if (watchRenewalTimer) clearTimeout(watchRenewalTimer);
    watchRenewalTimer = setTimeout(async () => {
      try {
        console.log('[Google Sync] Renewing push notification watches...');
        await setupWatches();
      } catch (err) {
        console.log('[Google Sync] Watch renewal failed:', err.message);
      }
    }, RENEWAL_INTERVAL);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('push_notifications_active', 'true')").run();
    console.log(`[Google Sync] Push notifications active for ${watchCount} room(s) â webhook: ${webhookUrl}`);
  }

  return { watchCount, errors };
}

/**
 * Stop all active watch channels.
 */
async function stopAllWatches() {
  if (!isConfigured()) return;

  const calendar = await getCalendarClient();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'watch_channel_%'").all();

  for (const row of rows) {
    try {
      const channel = JSON.parse(row.value);
      await calendar.channels.stop({
        requestBody: {
          id: channel.channelId,
          resourceId: channel.resourceId
        }
      });
    } catch (err) {
      // Channel may already be expired â that's fine
    }
    db.prepare("DELETE FROM settings WHERE key = ?").run(row.key);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('push_notifications_active', 'false')").run();

  if (watchRenewalTimer) {
    clearTimeout(watchRenewalTimer);
    watchRenewalTimer = null;
  }
}

/**
 * Get push notification status for the frontend.
 */
function getPushStatus() {
  const active = getSetting('push_notifications_active') === 'true';
  const channels = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'watch_channel_%'").all();
  return {
    active,
    channelCount: channels.length,
    channels: channels.map(r => {
      try {
        const ch = JSON.parse(r.value);
        return { roomEmail: ch.roomEmail, expiration: ch.expiration };
      } catch { return null; }
    }).filter(Boolean)
  };
}

module.exports = {
  createEvent,
  deleteEvent,
  checkConnection,
  listRoomResources,
  createBuilding,
  deleteBuilding,
  updateBuildingFloors,
  createRoomResource,
  deleteRoomResource,
  updateRoomResource,
  purgeOrphanedResources,
  resetClient,
  syncFromGoogle,
  getWebhookToken,
  setupWatches,
  stopAllWatches,
  getPushStatus,
  isConfigured
};
