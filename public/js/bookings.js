/* ===== Bookings Module ===== */

let sidebarRoomId = null;
let sidebarDate = null;
let sidebarBookings = [];
let selectedSlotStart = null;
let selectedSlotEnd = null;

const SCHEDULE_START_HOUR = 7;
const SCHEDULE_END_HOUR = 20;

// ===== Sidebar =====
const sidebar = document.getElementById('booking-sidebar');
const backdrop = document.getElementById('sidebar-backdrop');

function openBookingSidebar(roomId) {
  sidebarRoomId = roomId;
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;

  document.getElementById('sidebar-room-name').textContent = room.name;
  document.getElementById('sidebar-room-info').textContent = `Capacity: ${room.capacity}${room.amenities ? ' · ' + room.amenities : ''}`;

  // Set date to today
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('sidebar-date').value = today;
  sidebarDate = today;

  sidebar.classList.add('open');
  backdrop.classList.add('open');
  hideBookingForm();
  loadSidebarBookings();
}

function closeSidebar() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('open');
  sidebarRoomId = null;
}

document.getElementById('close-sidebar').addEventListener('click', closeSidebar);
backdrop.addEventListener('click', closeSidebar);

document.getElementById('sidebar-date').addEventListener('change', (e) => {
  sidebarDate = e.target.value;
  hideBookingForm();
  loadSidebarBookings();
});

// ===== Load Bookings for Sidebar =====
async function loadSidebarBookings() {
  if (!sidebarRoomId || !sidebarDate) return;

  try {
    const res = await fetch(`${API}/api/rooms/${sidebarRoomId}/bookings?date=${sidebarDate}`);
    sidebarBookings = await res.json();
    renderSchedule();
  } catch (err) {
    showToast('Failed to load schedule', 'error');
  }
}

// ===== Render Schedule Timeline =====
function renderSchedule() {
  const container = document.getElementById('sidebar-schedule');
  const hourHeight = 48;
  const totalHours = SCHEDULE_END_HOUR - SCHEDULE_START_HOUR;

  let html = '<div class="schedule-timeline" style="position:relative">';

  // Hour rows
  for (let h = SCHEDULE_START_HOUR; h < SCHEDULE_END_HOUR; h++) {
    const label = String(h).padStart(2, '0') + ':00';
    html += `
      <div class="schedule-hour">
        <div class="schedule-hour-label">${label}</div>
        <div class="schedule-hour-content"></div>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;

  const timeline = container.querySelector('.schedule-timeline');

  // Render bookings as positioned blocks
  sidebarBookings.forEach(booking => {
    const startDate = new Date(booking.start_time);
    const endDate = new Date(booking.end_time);
    const startHour = startDate.getHours() + startDate.getMinutes() / 60;
    const endHour = endDate.getHours() + endDate.getMinutes() / 60;

    const top = (startHour - SCHEDULE_START_HOUR) * hourHeight;
    const height = (endHour - startHour) * hourHeight;

    if (top + height <= 0 || top >= totalHours * hourHeight) return;

    const el = document.createElement('div');
    el.className = 'schedule-booking';
    el.style.cssText = `top:${top}px;height:${Math.max(height, 20)}px;left:56px;right:0;`;
    el.innerHTML = `
      <div class="booking-name">${escapeHtml(booking.booked_by)}</div>
      <div class="booking-time">${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}</div>
      ${booking.description ? `<div class="text-xs" style="opacity:0.8;margin-top:2px">${escapeHtml(booking.description)}</div>` : ''}
    `;

    el.addEventListener('click', () => {
      if (confirm(`Cancel booking by ${booking.booked_by}?\n${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`)) {
        cancelBooking(booking.id);
      }
    });

    timeline.appendChild(el);
  });

  // Click on empty areas to create booking
  const hourContents = container.querySelectorAll('.schedule-hour-content');
  hourContents.forEach((content, idx) => {
    content.addEventListener('click', (e) => {
      const hour = SCHEDULE_START_HOUR + idx;
      const rect = content.getBoundingClientRect();
      const yRatio = (e.clientY - rect.top) / rect.height;
      const minutes = Math.round(yRatio * 60 / 15) * 15;

      const startH = hour;
      const startM = Math.min(minutes, 45);
      const endH = startM + 30 >= 60 ? hour + 1 : hour;
      const endM = (startM + 30) % 60;

      showBookingForm(startH, startM, endH, endM);
    });
  });
}

// ===== Booking Form =====
function showBookingForm(startH, startM, endH, endM) {
  const form = document.getElementById('sidebar-booking-form');
  form.style.display = 'block';

  document.getElementById('booking-start').value = `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
  document.getElementById('booking-end').value = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  document.getElementById('sidebar-selected-time').textContent =
    `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')} – ${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  document.getElementById('booking-name').focus();
}

function hideBookingForm() {
  document.getElementById('sidebar-booking-form').style.display = 'none';
  document.getElementById('booking-name').value = '';
  document.getElementById('booking-description').value = '';
}

document.getElementById('cancel-booking-form').addEventListener('click', hideBookingForm);

document.getElementById('confirm-booking').addEventListener('click', async () => {
  const name = document.getElementById('booking-name').value.trim();
  if (!name) return showToast('Enter your name', 'error');

  const startTime = document.getElementById('booking-start').value;
  const endTime = document.getElementById('booking-end').value;
  const description = document.getElementById('booking-description').value.trim();

  const startISO = `${sidebarDate}T${startTime}:00`;
  const endISO = `${sidebarDate}T${endTime}:00`;

  try {
    const res = await fetch(`${API}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: sidebarRoomId,
        booked_by: name,
        description,
        start_time: startISO,
        end_time: endISO
      })
    });

    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || 'Booking failed', 'error');
    }

    showToast('Room booked!');
    hideBookingForm();
    loadSidebarBookings();
    loadMarkers(); // Refresh marker colors
  } catch (err) {
    showToast('Booking failed', 'error');
  }
});

async function cancelBooking(id) {
  try {
    await fetch(`${API}/api/bookings/${id}`, { method: 'DELETE' });
    showToast('Booking cancelled');
    loadSidebarBookings();
    loadMarkers();
  } catch (err) {
    showToast('Failed to cancel booking', 'error');
  }
}

// ===== Helpers =====
function formatTime(isoString) {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
