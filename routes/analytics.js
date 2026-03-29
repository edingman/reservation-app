const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper: build WHERE clause for office filtering on bookings
function officeBookingFilter(officeId) {
  if (!officeId) return { where: '', params: [] };
  return {
    where: ' AND b.room_id IN (SELECT id FROM rooms WHERE office_id = ?)',
    params: [officeId]
  };
}

// GET /api/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD&office_id=N
router.get('/', (req, res) => {
  const { start, end, office_id } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end date query parameters required (YYYY-MM-DD)' });
  }

  const startISO = start + 'T00:00:00';
  const endISO = end + 'T23:59:59';
  const officeFilter = office_id ? ' WHERE r.office_id = ?' : '';
  const officeParams = office_id ? [parseInt(office_id)] : [];

  const totalRooms = db.prepare('SELECT COUNT(*) as count FROM rooms' + (office_id ? ' WHERE office_id = ?' : '')).get(...officeParams).count;

  // Room IDs for this office (or all)
  const roomFilter = office_id
    ? ' AND room_id IN (SELECT id FROM rooms WHERE office_id = ?)'
    : '';
  const rp = office_id ? [parseInt(office_id)] : [];

  // 1. Summary stats
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_bookings,
      COALESCE(SUM(
        (julianday(MIN(end_time, ?)) - julianday(MAX(start_time, ?))) * 24
      ), 0) as total_hours,
      COALESCE(AVG(
        (julianday(end_time) - julianday(start_time)) * 24 * 60
      ), 0) as avg_duration_minutes,
      COUNT(DISTINCT room_id) as active_rooms
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
  `).get(endISO, startISO, endISO, startISO, ...rp);

  const dayCount = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1);
  const totalAvailableHours = dayCount * totalRooms * 13;
  const utilizationRate = totalAvailableHours > 0
    ? Math.min(100, (summary.total_hours / totalAvailableHours) * 100)
    : 0;

  // 2. By source
  const bySource = db.prepare(`
    SELECT
      COALESCE(source, 'local') as source,
      COUNT(*) as count,
      COALESCE(SUM((julianday(end_time) - julianday(start_time)) * 24), 0) as hours
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY COALESCE(source, 'local')
    ORDER BY count DESC
  `).all(endISO, startISO, ...rp);

  // 3. By room
  const byRoom = db.prepare(`
    SELECT
      r.id as room_id,
      r.name as room_name,
      r.capacity,
      COUNT(b.id) as bookings_count,
      COALESCE(SUM((julianday(b.end_time) - julianday(b.start_time)) * 24), 0) as hours
    FROM rooms r
    LEFT JOIN bookings b ON b.room_id = r.id AND b.start_time < ? AND b.end_time > ?
    ${office_id ? 'WHERE r.office_id = ?' : ''}
    GROUP BY r.id
    ORDER BY bookings_count DESC
  `).all(endISO, startISO, ...officeParams);

  const roomAvailableHours = dayCount * 13;
  byRoom.forEach(r => {
    r.utilization = roomAvailableHours > 0
      ? Math.min(100, (r.hours / roomAvailableHours) * 100)
      : 0;
  });

  // 4. By day
  const byDay = db.prepare(`
    SELECT date(start_time) as date, COUNT(*) as count,
      COALESCE(SUM((julianday(end_time) - julianday(start_time)) * 24), 0) as hours
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY date(start_time) ORDER BY date
  `).all(endISO, startISO, ...rp);

  // 5. By hour
  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', start_time) AS INTEGER) as hour, COUNT(*) as count
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY hour ORDER BY hour
  `).all(endISO, startISO, ...rp);

  // 6. By weekday
  const byWeekday = db.prepare(`
    SELECT CAST(strftime('%w', start_time) AS INTEGER) as weekday, COUNT(*) as count
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY weekday ORDER BY weekday
  `).all(endISO, startISO, ...rp);

  // 7. Avg per room per day
  const avgBookingsPerRoomPerDay = totalRooms > 0 && dayCount > 0
    ? summary.total_bookings / totalRooms / dayCount : 0;

  // 8. Duration distribution
  const durationDistribution = db.prepare(`
    SELECT
      CASE
        WHEN (julianday(end_time) - julianday(start_time)) * 24 * 60 <= 15 THEN '0-15 min'
        WHEN (julianday(end_time) - julianday(start_time)) * 24 * 60 <= 30 THEN '16-30 min'
        WHEN (julianday(end_time) - julianday(start_time)) * 24 * 60 <= 60 THEN '31-60 min'
        WHEN (julianday(end_time) - julianday(start_time)) * 24 * 60 <= 90 THEN '61-90 min'
        WHEN (julianday(end_time) - julianday(start_time)) * 24 * 60 <= 120 THEN '91-120 min'
        ELSE '120+ min'
      END as duration_range,
      COUNT(*) as count
    FROM bookings
    WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY duration_range
    ORDER BY MIN((julianday(end_time) - julianday(start_time)) * 24 * 60)
  `).all(endISO, startISO, ...rp);

  const mostPopularRoom = byRoom.length > 0 ? byRoom[0] : null;

  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const todayBookings = db.prepare(`
    SELECT COUNT(*) as count FROM bookings
    WHERE date(start_time) = ?${roomFilter}
  `).get(today, ...rp).count;

  res.json({
    period: { start, end, days: dayCount },
    summary: {
      totalBookings: summary.total_bookings,
      totalHours: Math.round(summary.total_hours * 10) / 10,
      avgDurationMinutes: Math.round(summary.avg_duration_minutes),
      utilizationRate: Math.round(utilizationRate * 10) / 10,
      activeRooms: summary.active_rooms,
      totalRooms,
      avgBookingsPerRoomPerDay: Math.round(avgBookingsPerRoomPerDay * 10) / 10,
      bookingsToday: todayBookings,
      mostPopularRoom: mostPopularRoom ? mostPopularRoom.room_name : 'N/A'
    },
    bySource,
    byRoom,
    byDay,
    byHour,
    byWeekday,
    durationDistribution
  });
});

// GET /api/analytics/insights?start=YYYY-MM-DD&end=YYYY-MM-DD&office_id=N
router.get('/insights', async (req, res) => {
  const { start, end, office_id } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end required' });
  }

  const startISO = start + 'T00:00:00';
  const endISO = end + 'T23:59:59';
  const roomFilter = office_id
    ? ' AND room_id IN (SELECT id FROM rooms WHERE office_id = ?)'
    : '';
  const rp = office_id ? [parseInt(office_id)] : [];
  const officeParams = office_id ? [parseInt(office_id)] : [];

  const totalRooms = db.prepare('SELECT COUNT(*) as count FROM rooms' + (office_id ? ' WHERE office_id = ?' : '')).get(...officeParams).count;
  const dayCount = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24)) + 1);

  const byRoom = db.prepare(`
    SELECT r.name, COUNT(b.id) as bookings,
      COALESCE(SUM((julianday(b.end_time) - julianday(b.start_time)) * 24), 0) as hours
    FROM rooms r
    LEFT JOIN bookings b ON b.room_id = r.id AND b.start_time < ? AND b.end_time > ?
    ${office_id ? 'WHERE r.office_id = ?' : ''}
    GROUP BY r.id ORDER BY bookings DESC
  `).all(endISO, startISO, ...officeParams);

  const bySource = db.prepare(`
    SELECT COALESCE(source, 'local') as source, COUNT(*) as count
    FROM bookings WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY source ORDER BY count DESC
  `).all(endISO, startISO, ...rp);

  const byHour = db.prepare(`
    SELECT CAST(strftime('%H', start_time) AS INTEGER) as hour, COUNT(*) as count
    FROM bookings WHERE start_time < ? AND end_time > ?${roomFilter}
    GROUP BY hour ORDER BY count DESC LIMIT 3
  `).all(endISO, startISO, ...rp);

  const totalBookings = db.prepare(`
    SELECT COUNT(*) as count FROM bookings WHERE start_time < ? AND end_time > ?${roomFilter}
  `).get(endISO, startISO, ...rp).count;

  // Rule-based insights
  const insights = [];

  const underutilized = byRoom.filter(r => {
    const utilization = (r.hours / (dayCount * 13)) * 100;
    return utilization < 15 && totalBookings > 0;
  });
  if (underutilized.length > 0) {
    insights.push({
      type: 'underutilized', icon: 'trending-down', title: 'Underutilized Rooms',
      text: `${underutilized.map(r => r.name).join(', ')} ${underutilized.length === 1 ? 'has' : 'have'} less than 15% utilization. Consider repurposing or promoting ${underutilized.length === 1 ? 'this space' : 'these spaces'}.`
    });
  }

  if (byRoom.length > 0 && byRoom[0].bookings > 0) {
    const top = byRoom[0];
    const topUtil = Math.round((top.hours / (dayCount * 13)) * 100);
    if (topUtil > 70) {
      insights.push({
        type: 'hot-room', icon: 'flame', title: 'High Demand Room',
        text: `${top.name} is at ${topUtil}% utilization with ${top.bookings} bookings. Consider adding overflow capacity or similar-sized alternatives.`
      });
    }
  }

  if (byHour.length > 0) {
    const peakHours = byHour.slice(0, 2).map(h => `${h.hour}:00`);
    insights.push({
      type: 'peak-hours', icon: 'clock', title: 'Peak Booking Hours',
      text: `Most bookings happen around ${peakHours.join(' and ')}. Encourage scheduling outside peak times to reduce conflicts.`
    });
  }

  const ipadBookings = bySource.find(s => s.source === 'ipad');
  const qrBookings = bySource.find(s => s.source === 'qr');
  if (totalBookings > 5) {
    if (!ipadBookings || ipadBookings.count === 0) {
      insights.push({ type: 'adoption', icon: 'tablet', title: 'iPad Booking Unused',
        text: 'No bookings via iPad displays yet. Ensure iPads are set up outside meeting rooms for quick walk-up booking.' });
    }
    if (!qrBookings || qrBookings.count === 0) {
      insights.push({ type: 'adoption', icon: 'qr-code', title: 'QR Code Booking Unused',
        text: 'No bookings via QR codes yet. Print and place QR codes next to room doors for mobile booking.' });
    }
  }

  const avgDuration = db.prepare(`
    SELECT AVG((julianday(end_time) - julianday(start_time)) * 24 * 60) as avg_min
    FROM bookings WHERE start_time < ? AND end_time > ?${roomFilter}
  `).get(endISO, startISO, ...rp);

  if (avgDuration.avg_min && avgDuration.avg_min > 75) {
    insights.push({ type: 'duration', icon: 'timer', title: 'Long Average Meetings',
      text: `Average meeting duration is ${Math.round(avgDuration.avg_min)} minutes. Consider encouraging shorter, more focused meetings to improve room availability.` });
  }

  if (totalBookings === 0) {
    insights.push({ type: 'no-data', icon: 'bar-chart', title: 'No Booking Data',
      text: 'No bookings found for this period. Start booking rooms to see utilization insights.' });
  }

  // Claude API insights (optional)
  let aiSummary = null;
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").get();

  if (apiKey && apiKey.value && totalBookings > 0) {
    try {
      const analyticsContext = {
        period: { start, end, days: dayCount },
        totalBookings, totalRooms,
        rooms: byRoom.map(r => ({ name: r.name, bookings: r.bookings, hours: Math.round(r.hours * 10) / 10 })),
        sources: bySource,
        peakHours: byHour,
        avgDurationMinutes: Math.round(avgDuration.avg_min || 0)
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.value,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `You are an office space analytics assistant. Based on this meeting room usage data, provide a brief 2-3 sentence executive summary and 2-3 actionable suggestions. Be concise and specific. Data: ${JSON.stringify(analyticsContext)}`
          }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        aiSummary = data.content[0].text;
      }
    } catch (err) {
      console.log('[Analytics] Claude API insight failed:', err.message);
    }
  }

  res.json({ insights, aiSummary, hasApiKey: !!(apiKey && apiKey.value) });
});

module.exports = router;
