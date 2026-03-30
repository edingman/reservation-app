/* ===== Mobile Floor Plan View ===== */

const API = '';
const params = new URLSearchParams(window.location.search);
const officeSlug = params.get('office');

let floors = [];
let currentFloorId = null;
let currentFloorData = null; // { floor, timezone, rooms }
let selectedRoomData = null;
let selectedDuration = null;
let officeTimezone = null;

if (!officeSlug) {
  document.getElementById('fv-loading').innerHTML =
    '<p style="color:#FF2F00">No office specified.<br>Use floorview.html?office=stockholm</p>';
} else {
  init();
}

async function init() {
  try {
    // Load floors for this office
    const res = await fetch(`${API}/api/floorplans?office=${encodeURIComponent(officeSlug)}`);
    if (!res.ok) throw new Error('Office not found');
    floors = await res.json();

    if (floors.length === 0) {
      document.getElementById('fv-loading').innerHTML =
        '<p style="color:#ACA19A">No floors configured for this office.</p>';
      return;
    }

    document.getElementById('fv-loading').style.display = 'none';
    document.getElementById('fv-app').style.display = 'block';

    // Office name from first floor
    document.getElementById('fv-office-name').textContent = floors[0].office_name || officeSlug;

    // Render floor tabs
    renderFloorTabs();

    // Select first floor
    selectFloor(floors[0].id);

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Auto-refresh every 30 seconds
    setInterval(() => { if (currentFloorId) loadFloorStatus(currentFloorId); }, 30000);

    // Bind sheet
    document.getElementById('fv-sheet-overlay').addEventListener('click', closeSheet);
    document.getElementById('fv-sheet-close').addEventListener('click', closeSheet);
    document.getElementById('fv-book-btn').addEventListener('click', confirmBooking);
    document.getElementById('fv-book-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBooking();
    });
  } catch (err) {
    document.getElementById('fv-loading').innerHTML =
      `<p style="color:#FF2F00">${err.message || 'Failed to load'}</p>`;
  }
}

function renderFloorTabs() {
  const tabs = document.getElementById('fv-floor-tabs');
  tabs.innerHTML = floors.map(f =>
    `<button class="fv-floor-tab" data-id="${f.id}">Floor ${f.floor_number}</button>`
  ).join('');

  tabs.querySelectorAll('.fv-floor-tab').forEach(btn => {
    btn.addEventListener('click', () => selectFloor(parseInt(btn.dataset.id)));
  });
}

async function selectFloor(floorId) {
  currentFloorId = floorId;

  // Update active tab
  document.querySelectorAll('.fv-floor-tab').forEach(t =>
    t.classList.toggle('active', parseInt(t.dataset.id) === floorId)
  );

  await loadFloorStatus(floorId);
}

async function loadFloorStatus(floorId) {
  try {
    const res = await fetch(`${API}/api/floorplans/${floorId}/status`);
    if (!res.ok) throw new Error('Failed to load floor');
    currentFloorData = await res.json();
    officeTimezone = currentFloorData.timezone || null;
    renderFloor();
  } catch (err) {
    document.getElementById('fv-map-wrap').innerHTML =
      `<div class="fv-no-image" style="color:#FF2F00">${err.message}</div>`;
  }
}

function renderFloor() {
  const { floor, rooms } = currentFloorData;
  const wrap = document.getElementById('fv-map-wrap');

  if (floor.image_path) {
    // Map with markers
    let html = `<img src="${floor.image_path}" alt="Floor ${floor.floor_number}">`;

    rooms.forEach(r => {
      const cls = r.available ? 'available' : 'occupied';
      html += `
        <div class="fv-marker" style="left:${r.x_percent}%;top:${r.y_percent}%"
             onclick="openSheet(${r.room_id})">
          <div class="fv-marker-dot ${cls}">${r.room_number || ''}</div>
          <div class="fv-marker-label">${escHtml(r.room_name)}</div>
        </div>
      `;
    });

    wrap.innerHTML = html;
  } else {
    wrap.innerHTML = '<div class="fv-no-image">No floor plan image uploaded</div>';
  }

  // Room list
  const list = document.getElementById('fv-room-list');
  if (rooms.length === 0) {
    list.innerHTML = '<div style="color:#ACA19A;font-size:0.85rem;padding:8px 0">No rooms on this floor</div>';
    return;
  }

  list.innerHTML = rooms.map(r => {
    let statusText = '';
    if (r.available) {
      if (r.next_booking) {
        const mins = minutesUntil(r.next_booking.start_time);
        statusText = `Available Â· Next in ${mins} min`;
      } else {
        statusText = 'Available all day';
      }
    } else if (r.current_booking) {
      const mins = minutesUntil(r.current_booking.end_time);
      statusText = `${r.current_booking.booked_by} Â· ${mins} min left`;
    }

    return `
      <div class="fv-room-card" onclick="openSheet(${r.room_id})">
        <div class="fv-room-dot ${r.available ? 'available' : 'occupied'}"></div>
        <div class="fv-room-info">
          <div class="fv-room-name">${escHtml(r.room_name)}</div>
          <div class="fv-room-status">${statusText}</div>
        </div>
        <div class="fv-room-cap">${r.capacity} seats</div>
      </div>
    `;
  }).join('');
}

// ===== Booking Sheet =====

function openSheet(roomId) {
  const room = currentFloorData.rooms.find(r => r.room_id === roomId);
  if (!room) return;

  selectedRoomData = room;
  selectedDuration = null;

  document.getElementById('fv-sheet-room-name').textContent = room.room_name;
  document.getElementById('fv-sheet-cap').textContent = `${room.capacity} seats`;

  const badgeEl = document.getElementById('fv-sheet-status-badge');
  const infoEl = document.getElementById('fv-sheet-info');
  const bookSection = document.getElementById('fv-sheet-book-section');

  if (room.available) {
    badgeEl.innerHTML = '<span class="fv-sheet-status available">AVAILABLE</span>';

    if (room.next_booking) {
      const mins = minutesUntil(room.next_booking.start_time);
      infoEl.textContent = `Free for ${mins} minutes Â· Next: ${fmtTime(room.next_booking.start_time)}`;
    } else {
      infoEl.textContent = 'No more bookings today';
    }

    // Show booking controls
    bookSection.style.display = '';
    renderDurationButtons(room);
    document.getElementById('fv-book-name').value = '';
    document.getElementById('fv-book-btn').disabled = true;
    document.getElementById('fv-book-btn').textContent = 'Select a duration';
  } else {
    badgeEl.innerHTML = '<span class="fv-sheet-status occupied">OCCUPIED</span>';

    if (room.current_booking) {
      const mins = minutesUntil(room.current_booking.end_time);
      infoEl.textContent = `${room.current_booking.booked_by} Â· Free in ${mins} min`;
    } else {
      infoEl.textContent = 'Currently in use';
    }

    bookSection.style.display = 'none';
  }

  document.getElementById('fv-sheet-overlay').classList.add('open');
  document.getElementById('fv-sheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('fv-sheet-overlay').classList.remove('open');
  document.getElementById('fv-sheet').classList.remove('open');
  selectedRoomData = null;
  selectedDuration = null;
}

function renderDurationButtons(room) {
  const grid = document.getElementById('fv-dur-grid');
  const minutesFree = room.next_booking
    ? minutesUntil(room.next_booking.start_time)
    : 90;

  const durations = [15, 30, 60];
  const buttons = durations.map(mins => ({
    mins,
    label: `${mins} min`,
    disabled: mins > minutesFree
  }));

  // Dynamic max option
  const dynamicMins = Math.min(minutesFree, 90);
  if (dynamicMins >= 5 && !durations.includes(dynamicMins)) {
    buttons.push({ mins: dynamicMins, label: `${dynamicMins} min (max)`, disabled: false });
  }

  grid.innerHTML = buttons.map(b => `
    <button class="fv-dur-btn" data-mins="${b.mins}" ${b.disabled ? 'disabled' : ''}>
      ${b.mins}<div class="fv-dur-label">${b.label}</div>
    </button>
  `).join('');

  grid.querySelectorAll('.fv-dur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDuration = parseInt(btn.dataset.mins);
      grid.querySelectorAll('.fv-dur-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('fv-book-btn').disabled = false;
      document.getElementById('fv-book-btn').textContent = `Book for ${selectedDuration} min`;
    });
  });
}

async function confirmBooking() {
  if (!selectedDuration || !selectedRoomData) return;

  const nameInput = document.getElementById('fv-book-name');
  const name = nameInput.value.trim();
  const bookedBy = name || 'Quick Booking';
  const description = name ? `${name}'s Meeting` : 'Quick Booking';

  const startTime = nowISO();
  const endMs = new Date(startTime).getTime() + selectedDuration * 60000;
  const endTime = toTimezoneISO(new Date(endMs), officeTimezone);

  const btn = document.getElementById('fv-book-btn');
  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const res = await fetch(`${API}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: selectedRoomData.room_id,
        booked_by: bookedBy,
        description,
        start_time: startTime,
        end_time: endTime,
        source: 'qr'
      })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Booking failed', 'error');
      return;
    }

    showToast('Room booked!', 'success');
    closeSheet();
    await loadFloorStatus(currentFloorId);
  } catch (err) {
    showToast('Booking failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book Room';
  }
}

// ===== Helpers =====

function updateClock() {
  const now = nowISO();
  document.getElementById('fv-clock').textContent = now.slice(11, 16);
}

function minutesUntil(isoTime) {
  const now = nowISO();
  return Math.max(0, Math.floor((new Date(isoTime) - new Date(now)) / 60000));
}

function fmtTime(iso) {
  return iso.slice(11, 16);
}

function toTimezoneISO(date, tz) {
  if (!tz) {
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

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.fv-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `fv-toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
