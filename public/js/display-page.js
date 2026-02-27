/* ===== iPad Door Display Page ===== */

const API = '';
const params = new URLSearchParams(window.location.search);
const roomId = params.get('id');

let roomData = null;
let bookings = [];

if (!roomId) {
  document.getElementById('loading').innerHTML =
    '<div style="text-align:center"><p style="color:var(--red)">No room ID specified.<br>Use display.html?id=1</p></div>';
} else {
  init();
}

async function init() {
  await loadData();

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Auto-refresh every 30 seconds
  setInterval(loadData, 30000);
}

async function loadData() {
  try {
    const res = await fetch(`${API}/api/rooms/${roomId}/status`);
    if (!res.ok) throw new Error('Room not found');
    const data = await res.json();

    roomData = data.room;
    bookings = data.todaySchedule;

    document.getElementById('loading').style.display = 'none';
    const app = document.getElementById('app');
    app.style.display = 'flex';

    render();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<div style="text-align:center"><p style="color:var(--red)">${err.message}</p></div>`;
  }
}

function render() {
  // Room name
  document.getElementById('d-room-name').textContent = roomData.name;

  // QR code
  document.getElementById('d-qr').src = `${API}/api/rooms/${roomId}/qrcode`;

  // Status
  const now = new Date();
  const statusEl = document.getElementById('d-status');
  const currentBooking = bookings.find(b =>
    new Date(b.start_time) <= now && new Date(b.end_time) > now
  );

  if (currentBooking) {
    statusEl.className = 'display-status occupied';
    document.getElementById('d-status-text').textContent = 'IN USE';
    document.getElementById('d-status-sub').textContent =
      currentBooking.description || currentBooking.booked_by;

    const endTime = new Date(currentBooking.end_time);
    const minsLeft = Math.ceil((endTime - now) / 60000);
    document.getElementById('d-status-detail').textContent =
      `${currentBooking.booked_by} · ${minsLeft} min remaining · Until ${fmtTime(currentBooking.end_time)}`;
  } else {
    statusEl.className = 'display-status available';
    document.getElementById('d-status-text').textContent = 'AVAILABLE';

    const nextBooking = bookings.find(b => new Date(b.start_time) > now);
    if (nextBooking) {
      const minsUntil = Math.ceil((new Date(nextBooking.start_time) - now) / 60000);
      document.getElementById('d-status-sub').textContent =
        `Available for ${minsUntil} minutes`;
      document.getElementById('d-status-detail').textContent =
        `Next: ${fmtTime(nextBooking.start_time)} — ${nextBooking.booked_by}`;
    } else {
      document.getElementById('d-status-sub').textContent = 'All day';
      document.getElementById('d-status-detail').textContent = 'No more bookings today';
    }
  }

  // Schedule
  const scheduleEl = document.getElementById('d-schedule');
  const upcoming = bookings.filter(b => new Date(b.end_time) > now);

  if (upcoming.length === 0) {
    scheduleEl.innerHTML = '<div class="no-bookings">No more bookings today</div>';
  } else {
    scheduleEl.innerHTML = upcoming.slice(0, 6).map(b => {
      const isCurrent = new Date(b.start_time) <= now && new Date(b.end_time) > now;
      return `
        <div class="display-schedule-item ${isCurrent ? 'schedule-item-current' : ''}">
          <div class="schedule-item-time">${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</div>
          <div class="schedule-item-name">${escHtml(b.booked_by)}</div>
          ${b.description ? `<div class="schedule-item-desc">${escHtml(b.description)}</div>` : ''}
        </div>
      `;
    }).join('');
  }
}

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('d-clock').textContent = `${h}:${m}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
