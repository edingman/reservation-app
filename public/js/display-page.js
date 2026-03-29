/* ===== iPad Door Display Page ===== */

const API = '';
const params = new URLSearchParams(window.location.search);
let roomId = params.get('id');
const officeSlug = params.get('office');
const roomNumber = params.get('room');

let roomData = null;
let bookings = [];
let selectedDuration = null;
let officeTimezone = null;

// Navigation data
let currentMarkerData = null;
let alternativesData = [];

// Inactivity timer
let lastActivityTime = Date.now();
const INACTIVITY_TIMEOUT = 120000; // 120 seconds

// Support both ?id=N and ?office=slug&room=N
if (!roomId && (!officeSlug || !roomNumber)) {
  document.getElementById('loading').innerHTML =
    '<div style="text-align:center"><p style="color:var(--red)">No room specified.<br>Use display.html?office=stockholm&room=1</p></div>';
} else {
  if (!roomId) {
    // Lookup room by office slug + room number
    resolveRoom().then(init).catch(err => {
      document.getElementById('loading').innerHTML =
        `<div style="text-align:center"><p style="color:var(--red)">${err.message}</p></div>`;
    });
  } else {
    init();
  }
}

async function resolveRoom() {
  const res = await fetch(`${API}/api/rooms/lookup?office=${encodeURIComponent(officeSlug)}&room=${roomNumber}`);
  if (!res.ok) throw new Error('Room not found');
  const room = await res.json();
  roomId = String(room.id);
}

async function init() {
  await loadData();

  // Keep screen on
  requestWakeLock();

  // Start clock
  updateClock();
  setInterval(updateClock, 1000);

  // Auto-refresh every 30 seconds
  setInterval(loadData, 30000);

  // Inactivity check every second
  setInterval(checkInactivity, 1000);

  // Track activity
  document.addEventListener('touchstart', resetActivity);
  document.addEventListener('click', resetActivity);

  // Bind Book Now button
  document.getElementById('d-book-now').addEventListener('click', openBookingOverlay);
  document.getElementById('cancel-booking').addEventListener('click', closeBookingOverlay);
  document.getElementById('confirm-book-btn').addEventListener('click', confirmBooking);

  // Bind navigation close
  document.getElementById('nav-close').addEventListener('click', closeNavOverlay);

  // Allow pressing Enter in name field to confirm
  document.getElementById('booker-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmBooking();
  });
}

// ===== Inactivity Auto-Reset =====

function resetActivity() {
  lastActivityTime = Date.now();
}

function checkInactivity() {
  if (Date.now() - lastActivityTime > INACTIVITY_TIMEOUT) {
    // Close any open overlays
    closeBookingOverlay();
    closeNavOverlay();
    // Reset activity timer so we don't keep firing
    lastActivityTime = Date.now();
  }
}

async function loadData() {
  try {
    const res = await fetch(`${API}/api/rooms/${roomId}/status`);
    if (!res.ok) throw new Error('Room not found');
    const data = await res.json();

    roomData = data.room;
    bookings = data.todaySchedule;
    officeTimezone = data.timezone || null;

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
  const now = nowISO();
  const statusEl = document.getElementById('d-status');
  const bookNowBtn = document.getElementById('d-book-now');
  const currentBooking = bookings.find(b =>
    b.start_time <= now && b.end_time > now
  );

  if (currentBooking) {
    statusEl.className = 'display-status occupied';
    document.getElementById('d-status-text').textContent = 'IN USE';
    document.getElementById('d-status-sub').textContent =
      currentBooking.description || currentBooking.booked_by;

    const minsLeft = Math.ceil((new Date(currentBooking.end_time) - new Date(now)) / 60000);
    document.getElementById('d-status-detail').textContent =
      `${currentBooking.booked_by} Â· ${minsLeft} min remaining Â· Until ${fmtTime(currentBooking.end_time)}`;

    // Hide Book Now when occupied
    bookNowBtn.style.display = 'none';
  } else {
    statusEl.className = 'display-status available';
    document.getElementById('d-status-text').textContent = 'AVAILABLE';

    const nextBooking = bookings.find(b => b.start_time > now);
    const minutesFree = nextBooking
      ? Math.floor((new Date(nextBooking.start_time) - new Date(now)) / 60000)
      : 90; // Cap at 90 when no upcoming meetings

    if (nextBooking) {
      document.getElementById('d-status-sub').textContent =
        `Available for ${minutesFree} minutes`;
      document.getElementById('d-status-detail').textContent =
        `Next: ${fmtTime(nextBooking.start_time)} â ${nextBooking.booked_by}`;
    } else {
      document.getElementById('d-status-sub').textContent = 'All day';
      document.getElementById('d-status-detail').textContent = 'No more bookings today';
    }

    // Show Book Now only if >= 5 minutes free
    bookNowBtn.style.display = minutesFree >= 5 ? '' : 'none';
  }

  // Schedule
  const scheduleEl = document.getElementById('d-schedule');
  const upcoming = bookings.filter(b => b.end_time > now);

  if (upcoming.length === 0) {
    scheduleEl.innerHTML = '<div class="no-bookings">No more bookings today</div>';
  } else {
    scheduleEl.innerHTML = upcoming.slice(0, 6).map(b => {
      const isCurrent = b.start_time <= now && b.end_time > now;
      return `
        <div class="display-schedule-item ${isCurrent ? 'schedule-item-current' : ''}">
          <div class="schedule-item-time">${fmtTime(b.start_time)} â ${fmtTime(b.end_time)}</div>
          <div class="schedule-item-name">${escHtml(b.booked_by)}</div>
          ${b.description ? `<div class="schedule-item-desc">${escHtml(b.description)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // Load room suggestions when occupied
  if (currentBooking) {
    loadSuggestions();
  } else {
    document.getElementById('d-suggestions').style.display = 'none';
  }
}

// ===== Room Suggestions =====

async function loadSuggestions() {
  const section = document.getElementById('d-suggestions');
  const list = document.getElementById('d-suggestions-list');

  try {
    const res = await fetch(`${API}/api/rooms/${roomId}/alternatives`);
    if (!res.ok) { section.style.display = 'none'; return; }
    const data = await res.json();

    const alternatives = data.alternatives || [];
    currentMarkerData = data.currentMarker || null;
    alternativesData = alternatives;

    if (alternatives.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = alternatives.slice(0, 3).map((r, idx) => {
      let detail = '';
      if (r.available) {
        detail = r.free_for_mins === null ? 'Free all day' : `Free ${r.free_for_mins} min`;
      } else if (r.free_at && r.free_at_mins != null && r.free_at_mins <= 30) {
        detail = `Free in ${r.free_at_mins} min`;
      } else if (r.free_at) {
        detail = `Free at ${fmtTime(r.free_at)}`;
      } else {
        detail = 'Busy';
      }

      const floorTag = r.floor_number != null ? ` Â· Floor ${r.floor_number}` : '';

      return `
        <div class="suggestion-item" onclick="openNavOverlay(${idx})">
          <div class="suggestion-dot ${r.available ? 'avail' : 'busy'}"></div>
          <span class="suggestion-name">${escHtml(r.name)}</span>
          <span class="suggestion-detail">${detail}${floorTag}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    section.style.display = 'none';
  }
}

// ===== Navigation Overlay =====

function openNavOverlay(idx) {
  resetActivity();
  const alt = alternativesData[idx];
  if (!alt) return;

  const overlay = document.getElementById('nav-overlay');
  const mapContainer = document.getElementById('nav-map-container');
  const diffFloor = document.getElementById('nav-diff-floor');

  // Set header
  document.getElementById('nav-room-name').textContent = alt.name;
  let detailText = '';
  if (alt.available) {
    detailText = alt.free_for_mins === null ? 'Available all day' : `Available for ${alt.free_for_mins} min`;
  } else if (alt.free_at) {
    detailText = `Free at ${fmtTime(alt.free_at)}`;
  }
  document.getElementById('nav-room-detail').textContent = detailText;

  const sameFloor = alt.same_floor && currentMarkerData && alt.floor_plan_id === currentMarkerData.floor_plan_id;

  if (sameFloor && alt.x_percent != null && alt.y_percent != null && currentMarkerData) {
    // Same floor â show map with both markers and path
    mapContainer.style.display = '';
    diffFloor.style.display = 'none';

    document.getElementById('nav-floor-label').textContent =
      `Floor ${alt.floor_number || ''}${alt.floor_name ? ' â ' + alt.floor_name : ''}`;

    const mapImg = document.getElementById('nav-map-img');
    mapImg.src = `${API}/api/floorplans/${alt.floor_plan_id}/image`;

    // Position markers
    const here = document.getElementById('nav-marker-here');
    here.style.left = currentMarkerData.x_percent + '%';
    here.style.top = currentMarkerData.y_percent + '%';

    const target = document.getElementById('nav-marker-target');
    target.style.left = alt.x_percent + '%';
    target.style.top = alt.y_percent + '%';
    document.getElementById('nav-marker-target-label').textContent = alt.name;

    // Draw path line
    const line = document.getElementById('nav-path-line');
    line.setAttribute('x1', currentMarkerData.x_percent + '%');
    line.setAttribute('y1', currentMarkerData.y_percent + '%');
    line.setAttribute('x2', alt.x_percent + '%');
    line.setAttribute('y2', alt.y_percent + '%');
  } else if (alt.floor_plan_id && currentMarkerData && !sameFloor) {
    // Different floor â show floor arrow
    mapContainer.style.display = 'none';
    diffFloor.style.display = '';

    const fromFloor = currentMarkerData.floor_number || '?';
    const toFloor = alt.floor_number || '?';
    document.getElementById('nav-from-floor').textContent = `You are on Floor ${fromFloor}`;
    document.getElementById('nav-to-floor').textContent = `Go to Floor ${toFloor}`;
    document.getElementById('nav-floor-label').textContent = `${alt.floors_away || 1} floor${(alt.floors_away || 1) > 1 ? 's' : ''} away`;
  } else {
    // No position data â just show the name/detail (no map)
    mapContainer.style.display = 'none';
    diffFloor.style.display = 'none';
    document.getElementById('nav-floor-label').textContent =
      alt.floor_number != null ? `Floor ${alt.floor_number}` : '';
  }

  overlay.classList.add('open');
}

function closeNavOverlay() {
  document.getElementById('nav-overlay').classList.remove('open');
}

// ===== Book Now Overlay =====

function getMinutesFree() {
  const now = nowISO();
  const nextBooking = bookings.find(b => b.start_time > now);
  if (!nextBooking) return 90; // No upcoming = cap at 90
  return Math.floor((new Date(nextBooking.start_time) - new Date(now)) / 60000);
}

function openBookingOverlay() {
  resetActivity();
  selectedDuration = null;
  const minutesFree = getMinutesFree();

  document.getElementById('overlay-room-name').textContent = roomData.name;

  // Build duration buttons
  const grid = document.getElementById('duration-grid');
  const standardDurations = [30, 60, 90];
  const buttons = [];

  standardDurations.forEach(mins => {
    const disabled = mins > minutesFree;
    buttons.push({ mins, label: `${mins} min`, disabled });
  });

  // Dynamic option: only if it differs from 30/60/90 and is >= 5
  const dynamicMins = Math.min(minutesFree, 90);
  if (dynamicMins >= 5 && !standardDurations.includes(dynamicMins)) {
    buttons.push({ mins: dynamicMins, label: `${dynamicMins} min`, disabled: false, dynamic: true });
  }

  grid.innerHTML = buttons.map(b => `
    <button class="duration-btn" data-mins="${b.mins}" ${b.disabled ? 'disabled' : ''}>
      ${b.mins}<div class="dur-label">${b.label}${b.dynamic ? ' (max)' : ''}</div>
    </button>
  `).join('');

  // Bind duration clicks
  grid.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      resetActivity();
      selectedDuration = parseInt(btn.dataset.mins);
      grid.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');

      // Show name step
      document.getElementById('name-step').classList.add('visible');
      document.getElementById('booker-name').focus();
    });
  });

  // Reset
  document.getElementById('name-step').classList.remove('visible');
  document.getElementById('booker-name').value = '';
  document.getElementById('duration-step').style.display = '';

  document.getElementById('booking-overlay').classList.add('open');
}

function closeBookingOverlay() {
  document.getElementById('booking-overlay').classList.remove('open');
  selectedDuration = null;
}

async function confirmBooking() {
  resetActivity();
  if (!selectedDuration) return;

  const nameInput = document.getElementById('booker-name');
  const name = nameInput.value.trim();
  const bookedBy = name ? name : 'Mysterious Meeting';
  const description = name ? `${name}'s Meeting` : 'Mysterious Meeting';

  const startTime = nowISO(); // exact current time in office timezone, no rounding
  const endMs = new Date(startTime).getTime() + selectedDuration * 60000;
  const endTime = toTimezoneISO(new Date(endMs), officeTimezone);

  const btn = document.getElementById('confirm-book-btn');
  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const res = await fetch(`${API}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: parseInt(roomId),
        booked_by: bookedBy,
        description,
        start_time: startTime,
        end_time: endTime,
        source: 'ipad'
      })
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Booking failed');
      return;
    }

    closeBookingOverlay();
    await loadData();
  } catch (err) {
    alert('Booking failed. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm';
  }
}

// ===== Wake Lock (keep screen on) =====

let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
      console.warn('Wake Lock failed:', err.message);
    }
  } else {
    // Fallback: play a tiny silent video in a loop to prevent sleep
    startNoSleepFallback();
  }
}

// Re-acquire wake lock when page becomes visible again (e.g. after tab switch)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) {
    requestWakeLock();
  }
});

// Fallback for older iPads that don't support Wake Lock API
function startNoSleepFallback() {
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.setAttribute('loop', '');
  video.style.position = 'fixed';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0.01';
  // Minimal valid mp4 (silent, 1s) encoded as data URI
  video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0AAAA1m1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAQQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjU4Ljc2LjEwMA==';
  document.body.appendChild(video);
  video.play().catch(() => {});
}

// ===== Helpers =====

function updateClock() {
  const now = nowISO();
  const h = now.slice(11, 13);
  const m = now.slice(14, 16);
  document.getElementById('d-clock').textContent = `${h}:${m}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toTimezoneISO(date, tz) {
  if (!tz) {
    // Fallback to browser local time
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${Y}-${M}-${D}T${h}:${m}:${s}`;
  }
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date).forEach(({ type, value }) => { parts[type] = value; });
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

function nowISO() {
  return toTimezoneISO(new Date(), officeTimezone);
}

function todayStr() {
  return nowISO().slice(0, 10);
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
