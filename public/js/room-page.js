/* ===== Mobile Room Booking Page ===== */

const API_BASE = '';
const HOUR_START = 7;
const HOUR_END = 20;

const params = new URLSearchParams(window.location.search);
const roomId = params.get('id');

let roomData = null;
let todayBookings = [];
let selectedStart = null;
let selectedEnd = null;

if (!roomId) {
  document.getElementById('loading').innerHTML = '<p style="color:var(--red)">No room ID specified</p>';
} else {
  loadRoom();
}

async function loadRoom() {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}/status`);
    if (!res.ok) throw new Error('Room not found');
    const data = await res.json();

    roomData = data.room;
    todayBookings = data.todaySchedule;

    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display = 'block';

    render();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:var(--red)">${err.message || 'Failed to load room'}</p>`;
  }
}

function render() {
  // Header
  document.getElementById('room-name-display').textContent = roomData.name;
  document.getElementById('room-capacity-display').textContent = `${roomData.capacity} seats`;

  // Status banner
  const banner = document.getElementById('status-banner');
  const now = new Date();
  const currentBooking = todayBookings.find(b =>
    new Date(b.start_time) <= now && new Date(b.end_time) > now
  );

  if (currentBooking) {
    banner.className = 'status-banner occupied';
    document.getElementById('status-text').textContent = 'OCCUPIED';
    document.getElementById('status-sub').textContent =
      `${currentBooking.booked_by} · Until ${fmtTime(currentBooking.end_time)}`;
  } else {
    banner.className = 'status-banner available';
    document.getElementById('status-text').textContent = 'AVAILABLE';

    const nextBooking = todayBookings.find(b => new Date(b.start_time) > now);
    document.getElementById('status-sub').textContent = nextBooking
      ? `Next: ${fmtTime(nextBooking.start_time)} — ${nextBooking.booked_by}`
      : 'No more bookings today';
  }

  // Time slots
  renderTimeSlots();
}

function renderTimeSlots() {
  const grid = document.getElementById('time-grid');
  grid.innerHTML = '';

  const today = new Date().toISOString().slice(0, 10);

  for (let h = HOUR_START; h < HOUR_END; h++) {
    for (let m = 0; m < 60; m += 30) {
      const slotStart = `${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      const slotEndH = m + 30 >= 60 ? h + 1 : h;
      const slotEndM = (m + 30) % 60;
      const slotEnd = `${today}T${String(slotEndH).padStart(2, '0')}:${String(slotEndM).padStart(2, '0')}:00`;

      const booking = todayBookings.find(b =>
        b.start_time < slotEnd && b.end_time > slotStart
      );

      const el = document.createElement('div');
      const timeLabel = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const endLabel = `${String(slotEndH).padStart(2, '0')}:${String(slotEndM).padStart(2, '0')}`;

      if (booking) {
        el.className = 'time-slot booked';
        el.innerHTML = `
          <div class="time-slot-time">${timeLabel} – ${endLabel}</div>
          <div class="time-slot-info">${escHtml(booking.booked_by)}</div>
        `;

        el.addEventListener('click', () => {
          if (confirm(`Cancel booking by ${booking.booked_by}?\n${fmtTime(booking.start_time)} – ${fmtTime(booking.end_time)}`)) {
            cancelBooking(booking.id);
          }
        });
      } else {
        const isSelected = selectedStart === slotStart || (selectedStart && selectedStart <= slotStart && selectedEnd && selectedEnd >= slotEnd);
        el.className = `time-slot available${isSelected ? ' selected' : ''}`;
        el.innerHTML = `
          <div class="time-slot-time">${timeLabel} – ${endLabel}</div>
          <div class="time-slot-info">Available</div>
        `;

        el.addEventListener('click', () => selectSlot(slotStart, slotEnd, h, m));
      }

      grid.appendChild(el);
    }
  }
}

function selectSlot(start, end, h, m) {
  selectedStart = start;
  selectedEnd = end;

  const today = new Date().toISOString().slice(0, 10);
  const startTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const endH = m + 30 >= 60 ? h + 1 : h;
  const endM = (m + 30) % 60;
  const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

  // Show booking form
  const form = document.getElementById('booking-form');
  form.classList.add('visible');
  document.getElementById('form-selected-time').textContent = `${startTime} – ${endTime}`;
  document.getElementById('form-start').value = startTime;
  document.getElementById('form-end').value = endTime;
  document.getElementById('form-name').focus();

  renderTimeSlots();

  // Scroll form into view
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideForm() {
  selectedStart = null;
  selectedEnd = null;
  document.getElementById('booking-form').classList.remove('visible');
  document.getElementById('form-name').value = '';
  document.getElementById('form-desc').value = '';
  renderTimeSlots();
}

document.getElementById('btn-cancel-form').addEventListener('click', hideForm);

document.getElementById('btn-confirm-book').addEventListener('click', async () => {
  const name = document.getElementById('form-name').value.trim();
  if (!name) return mobileToast('Enter your name', 'error');

  const today = new Date().toISOString().slice(0, 10);
  const startTime = document.getElementById('form-start').value;
  const endTime = document.getElementById('form-end').value;
  const desc = document.getElementById('form-desc').value.trim();

  const btn = document.getElementById('btn-confirm-book');
  btn.disabled = true;
  btn.textContent = 'Booking...';

  try {
    const res = await fetch(`${API_BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: parseInt(roomId),
        booked_by: name,
        description: desc,
        start_time: `${today}T${startTime}:00`,
        end_time: `${today}T${endTime}:00`
      })
    });

    if (!res.ok) {
      const err = await res.json();
      mobileToast(err.error || 'Booking failed', 'error');
      return;
    }

    mobileToast('Room booked!', 'success');
    hideForm();
    await loadRoom();
  } catch (err) {
    mobileToast('Booking failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book Room';
  }
});

async function cancelBooking(id) {
  try {
    await fetch(`${API_BASE}/api/bookings/${id}`, { method: 'DELETE' });
    mobileToast('Booking cancelled', 'success');
    await loadRoom();
  } catch (err) {
    mobileToast('Failed to cancel', 'error');
  }
}

// ===== Helpers =====
function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function mobileToast(msg, type = 'success') {
  const existing = document.querySelector('.mobile-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `mobile-toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Auto-refresh every 60 seconds
setInterval(loadRoom, 60000);
