const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const db = require('./db');

let calendarClient = null;
let adminClient = null;

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
      'https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly'
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
    summary: `${booking.description || 'Room Booking'} — ${room.name}`,
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

module.exports = {
  createEvent,
  deleteEvent,
  checkConnection,
  listRoomResources,
  resetClient
};
