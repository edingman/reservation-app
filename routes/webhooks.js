const express = require('express');
const router = express.Router();
const googleCalendar = require('../google-calendar');

// Debounce: avoid running multiple syncs from rapid webhook bursts
let syncPending = false;
let lastWebhookSync = 0;
const MIN_SYNC_GAP = 5000; // minimum 5 seconds between webhook-triggered syncs

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification endpoint.
 * When a watched calendar changes, Google sends a POST here.
 * Headers include:
 *   X-Goog-Channel-ID, X-Goog-Resource-ID, X-Goog-Resource-State,
 *   X-Goog-Channel-Token (our verification token)
 */
router.post('/google-calendar', async (req, res) => {
  // Always respond 200 immediately â Google expects fast responses
  res.status(200).end();

  const state = req.headers['x-goog-resource-state'];
  const token = req.headers['x-goog-channel-token'];

  // Verify the token matches what we set
  const expectedToken = googleCalendar.getWebhookToken();
  if (token !== expectedToken) {
    console.log('[Webhook] Rejected: invalid token');
    return;
  }

  // 'sync' = initial verification, 'exists' = something changed
  if (state === 'sync') {
    console.log('[Webhook] Channel verified by Google');
    return;
  }

  if (state !== 'exists') return;

  // Debounce rapid notifications
  const now = Date.now();
  if (now - lastWebhookSync < MIN_SYNC_GAP || syncPending) {
    return;
  }

  syncPending = true;
  lastWebhookSync = now;

  // Small delay to batch rapid notifications
  setTimeout(async () => {
    try {
      const result = await googleCalendar.syncFromGoogle();
      if (result.synced && (result.imported > 0 || result.removed > 0)) {
        console.log(`[Webhook Sync] Imported: ${result.imported}, Removed: ${result.removed}`);
      }
    } catch (err) {
      console.log('[Webhook Sync] Failed:', err.message);
    } finally {
      syncPending = false;
    }
  }, 2000);
});

module.exports = router;
