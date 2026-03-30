/* ===== Bahn Express Room Booking â Main App ===== */

const API = '';

// ===== Toast Notifications =====
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i data-lucide="${type === 'error' ? 'alert-circle' : 'check-circle'}" style="width:16px;height:16px"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);
  lucide.createIcons({ nodes: [toast] });
  setTimeout(() => { toast.remove(); }, 3500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Tab Navigation =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    if (btn.dataset.tab === 'dashboard' && typeof loadDashboard === 'function') loadDashboard();
    if (btn.dataset.tab === 'rooms') loadRooms();
    if (btn.dataset.tab === 'qrcodes') loadQRCodes();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'floorplan') loadFloorPlans();
  });
});

// ===== Office State =====
let offices = [];
let selectedOfficeId = '';

async function loadOffices() {
  try {
    const res = await fetch(`${API}/api/offices`);
    offices = await res.json();
    renderOfficeSelector();
  } catch (err) {
    console.warn('Failed to load offices:', err);
  }
}

function renderOfficeSelector() {
  const select = document.getElementById('office-select');
  const current = select.value;
  select.innerHTML = '<option value="">Select Office</option>';
  offices.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    if (String(o.id) === current) opt.selected = true;
    select.appendChild(opt);
  });
}

document.getElementById('office-select').addEventListener('change', (e) => {
  selectedOfficeId = e.target.value;
  loadRooms();
  if (typeof loadFloorPlans === 'function') loadFloorPlans();
  if (typeof loadDashboard === 'function') loadDashboard();
});

function getSelectedOfficeId() {
  return selectedOfficeId || '';
}

// ===== Office Management Modal =====
document.getElementById('manage-offices-btn').addEventListener('click', () => {
  document.getElementById('offices-modal').classList.add('open');
  renderOfficesList();
});
document.getElementById('close-offices-modal').addEventListener('click', () => {
  document.getElementById('offices-modal').classList.remove('open');
});

document.getElementById('add-office-btn').addEventListener('click', async () => {
  const input = document.getElementById('new-office-name');
  const name = input.value.trim();
  if (!name) return;

  const timezone = document.getElementById('new-office-timezone').value;

  try {
    const res = await fetch(`${API}/api/offices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, timezone })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || 'Failed to create office', 'error');
    }
    input.value = '';
    showToast('Office created');
    await loadOffices();
    renderOfficesList();
  } catch (err) {
    showToast('Failed to create office', 'error');
  }
});

document.getElementById('new-office-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-office-btn').click();
});

function renderOfficesList() {
  const list = document.getElementById('offices-list');
  if (offices.length === 0) {
    list.innerHTML = '<div style="color:var(--stone);padding:16px;text-align:center;font-size:0.85rem">No offices yet. Add your first office above.</div>';
    return;
  }
  list.innerHTML = offices.map(o => `
    <div class="office-list-item">
      <div style="flex:1">
        <div class="office-name">${escapeHtml(o.name)}</div>
        <div class="office-slug">/${o.slug} Â· ${o.timezone || 'Europe/Stockholm'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="office-room-count">${o.room_count} room${o.room_count !== 1 ? 's' : ''}</span>
        <button class="btn btn-ghost btn-sm" onclick="editOfficeTimezone(${o.id})" title="Edit timezone" style="color:var(--stone)">
          <i data-lucide="clock" style="width:14px;height:14px"></i>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteOffice(${o.id})" style="color:var(--red)">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

async function editOfficeTimezone(id) {
  const office = offices.find(o => o.id === id);
  if (!office) return;
  const tz = prompt(`Timezone for "${office.name}":`, office.timezone || 'Europe/Stockholm');
  if (tz === null || tz === office.timezone) return;

  try {
    const res = await fetch(`${API}/api/offices/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz })
    });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || 'Failed to update timezone', 'error');
    }
    showToast('Timezone updated');
    await loadOffices();
    renderOfficesList();
  } catch (err) {
    showToast('Failed to update timezone', 'error');
  }
}

async function deleteOffice(id) {
  const office = offices.find(o => o.id === id);
  if (!office || !confirm(`Delete office "${office.name}"?\n\nThis will also delete all rooms, floor plans, and bookings for this office.`)) return;

  try {
    await fetch(`${API}/api/offices/${id}`, { method: 'DELETE' });
    showToast('Office deleted');
    if (selectedOfficeId === String(id)) {
      selectedOfficeId = '';
      document.getElementById('office-select').value = '';
    }
    await loadOffices();
    renderOfficesList();
    loadRooms();
  } catch (err) {
    showToast('Failed to delete office', 'error');
  }
}

// ===== Rooms State =====
let rooms = [];
let googleResources = [];

async function loadRooms() {
  const prompt = document.getElementById('rooms-select-office');
  const content = document.getElementById('rooms-content');
  if (!getSelectedOfficeId()) {
    prompt.style.display = '';
    content.style.display = 'none';
    lucide.createIcons({ nodes: [prompt] });
    return;
  }
  prompt.style.display = 'none';
  content.style.display = '';

  try {
    const res = await fetch(`${API}/api/rooms?office_id=${getSelectedOfficeId()}`);
    rooms = await res.json();
    renderRooms();
  } catch (err) {
    showToast('Failed to load rooms', 'error');
  }
}

function getDisplayUrl(room) {
  if (room.office_slug && room.room_number) {
    return `/display.html?office=${room.office_slug}&room=${room.room_number}`;
  }
  return `/display.html?id=${room.id}`;
}

function getRoomUrl(room) {
  if (room.office_slug && room.room_number) {
    return `/room.html?office=${room.office_slug}&room=${room.room_number}`;
  }
  return `/room.html?id=${room.id}`;
}

function renderRooms() {
  const grid = document.getElementById('rooms-grid');
  const empty = document.getElementById('rooms-empty');
  const label = document.getElementById('rooms-office-label');

  const office = offices.find(o => String(o.id) === getSelectedOfficeId());
  label.textContent = office ? office.name : '';

  if (rooms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = rooms.map(room => {
    const displayUrl = getDisplayUrl(room);
    const officeLabel = room.office_name ? `<span class="amenity-tag" style="background:var(--stone-lightest);color:var(--stone);font-weight:500">${escapeHtml(room.office_name)}</span>` : '';
    const roomNumLabel = room.room_number ? `<span class="mono text-xs" style="color:var(--stone);margin-left:auto">#${room.room_number}</span>` : '';

    return `
    <div class="room-card" data-room-id="${room.id}">
      <div class="room-card-header">
        <span class="room-card-name">${escapeHtml(room.name)}</span>
        ${roomNumLabel}
        <span class="room-card-capacity"><i data-lucide="users" style="width:12px;height:12px"></i> ${room.capacity}</span>
      </div>
      ${room.amenities || room.office_name ? `
        <div class="room-card-amenities">
          ${officeLabel}
          ${(room.amenities || '').split(',').filter(a => a.trim()).map(a => `<span class="amenity-tag">${escapeHtml(a.trim())}</span>`).join('')}
        </div>
      ` : ''}
      ${room.google_resource_email
        ? `<div class="google-linked"><span class="status-dot green"></span> Google Calendar linked</div>`
        : `<div class="google-unlinked"><span class="status-dot gray"></span> Not linked to Google</div>`
      }
      <div class="room-url-row">
        <span class="url-label">Display</span>
        <span class="url-text">${escapeHtml(displayUrl)}</span>
        <button class="copy-url-btn" onclick="copyUrl('${escapeHtml(displayUrl)}', this)">Copy</button>
      </div>
      <div class="room-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="editRoom(${room.id})">
          <i data-lucide="pencil" style="width:14px;height:14px"></i> Edit
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteRoom(${room.id})">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  `}).join('');

  lucide.createIcons();
}

function copyUrl(path, btn) {
  const fullUrl = window.location.origin + path;
  navigator.clipboard.writeText(fullUrl).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.color = 'var(--teal)';
    btn.style.borderColor = 'var(--teal)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; btn.style.borderColor = ''; }, 1500);
  });
}

// ===== Room Modal =====
const roomModal = document.getElementById('room-modal');

async function populateFloorDropdown(room) {
  const select = document.getElementById('room-floor');
  const officeId = document.getElementById('room-office').value;
  select.innerHTML = '<option value="">No floor assigned</option>';
  if (!officeId) return;

  try {
    const res = await fetch(`${API}/api/floorplans?office_id=${officeId}`);
    const plans = await res.json();
    plans.forEach(fp => {
      const opt = document.createElement('option');
      opt.value = fp.id;
      opt.textContent = `Floor ${fp.floor_number} â ${fp.name}`;
      if (room && room.floor_plan_id && room.floor_plan_id === fp.id) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (err) {
    // ignore
  }
}

function openRoomModal(room = null) {
  if (!room && offices.length === 0) {
    showToast('Create an office first before adding rooms', 'error');
    return;
  }

  document.getElementById('room-modal-title').textContent = room ? 'Edit Room' : 'Add Room';
  document.getElementById('room-edit-id').value = room ? room.id : '';
  document.getElementById('room-name').value = room ? room.name : '';
  document.getElementById('room-capacity').value = room ? room.capacity : 4;
  document.getElementById('room-amenities').value = room ? room.amenities : '';

  // Populate office dropdown (required)
  const officeSelect = document.getElementById('room-office');
  officeSelect.innerHTML = '<option value="">Select office...</option>';
  offices.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    if (room && room.office_id === o.id) opt.selected = true;
    else if (!room && getSelectedOfficeId() && String(o.id) === getSelectedOfficeId()) opt.selected = true;
    officeSelect.appendChild(opt);
  });

  // Populate floor dropdown based on selected office
  populateFloorDropdown(room);

  // Re-populate floors when office changes
  officeSelect.onchange = () => populateFloorDropdown(room);

  roomModal.classList.add('open');
}

function closeRoomModal() {
  roomModal.classList.remove('open');
  document.getElementById('room-form').reset();
}

document.getElementById('add-room-btn').addEventListener('click', () => openRoomModal());
document.getElementById('add-room-empty-btn')?.addEventListener('click', () => openRoomModal());
document.getElementById('close-room-modal').addEventListener('click', closeRoomModal);
document.getElementById('cancel-room-modal').addEventListener('click', closeRoomModal);

document.getElementById('room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('room-edit-id').value;
  const officeVal = document.getElementById('room-office').value;
  const floorPlanId = document.getElementById('room-floor').value || null;
  const data = {
    name: document.getElementById('room-name').value.trim(),
    capacity: parseInt(document.getElementById('room-capacity').value) || 1,
    amenities: document.getElementById('room-amenities').value.trim(),
    office_id: officeVal ? parseInt(officeVal) : null
  };

  if (!data.name) return showToast('Room name is required', 'error');
  if (!data.office_id) return showToast('Office is required', 'error');

  try {
    const res = await fetch(`${API}/api/rooms${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || 'Failed to save room', 'error');
    }

    const result = await res.json();
    const roomId = result.id;

    // Assign floor plan marker if a floor was selected (center of floor plan)
    if (floorPlanId) {
      await fetch(`${API}/api/rooms/${roomId}/marker`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floor_plan_id: parseInt(floorPlanId), x_percent: 50, y_percent: 50 })
      });
    } else if (id) {
      // If editing and floor cleared, remove marker
      await fetch(`${API}/api/rooms/${roomId}/marker`, { method: 'DELETE' });
    }

    if (!id && result.google_auto_created) {
      showToast('Room created and linked to Google Calendar');
    } else {
      showToast(id ? 'Room updated' : 'Room created');
    }
    closeRoomModal();
    loadRooms();
  } catch (err) {
    showToast('Failed to save room', 'error');
  }
});

function editRoom(id) {
  const room = rooms.find(r => r.id === id);
  if (room) openRoomModal(room);
}

async function deleteRoom(id) {
  const room = rooms.find(r => r.id === id);
  if (!room || !confirm(`Delete "${room.name}"? All bookings will also be removed.`)) return;

  try {
    await fetch(`${API}/api/rooms/${id}`, { method: 'DELETE' });
    showToast('Room deleted');
    loadRooms();
  } catch (err) {
    showToast('Failed to delete room', 'error');
  }
}

// ===== QR Codes =====
async function loadQRCodes() {
  const prompt = document.getElementById('qrcodes-select-office');
  const content = document.getElementById('qrcodes-content');
  if (!getSelectedOfficeId()) {
    prompt.style.display = '';
    content.style.display = 'none';
    lucide.createIcons({ nodes: [prompt] });
    return;
  }
  prompt.style.display = 'none';
  content.style.display = '';

  if (rooms.length === 0) await loadRooms();
  if (offices.length === 0) await loadOffices();

  const grid = document.getElementById('qr-grid');
  const empty = document.getElementById('qr-empty');

  if (rooms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  // Office floor plan QR codes (only when a specific office is selected)
  let html = '';
  const selectedOffice = getSelectedOfficeId() ? offices.find(o => String(o.id) === getSelectedOfficeId()) : null;
  if (selectedOffice) {
    html += '<div class="qr-section-label">Floor Plan View</div>';
    html += [selectedOffice].map(office => `
      <div class="qr-card">
        <div class="qr-card-name">${escapeHtml(office.name)}</div>
        <div class="text-muted text-xs mono">Office Floor Plan</div>
        <img src="${API}/api/offices/${office.slug}/floorview-qrcode" alt="QR Code for ${escapeHtml(office.name)} floor plan" loading="lazy">
        <div class="qr-card-actions">
          <button class="btn btn-outline btn-sm" onclick="downloadFloorQR('${escapeHtml(office.slug)}', '${escapeHtml(office.name)}')">
            <i data-lucide="download" style="width:14px;height:14px"></i> Download
          </button>
          <button class="btn btn-outline btn-sm" onclick="printFloorQR('${escapeHtml(office.slug)}', '${escapeHtml(office.name)}')">
            <i data-lucide="printer" style="width:14px;height:14px"></i> Print
          </button>
        </div>
      </div>
    `).join('');
  }

  // Room QR codes
  if (rooms.length > 0) {
    html += '<div class="qr-section-label">Room Booking</div>';
    html += rooms.map(room => `
      <div class="qr-card">
        <div class="qr-card-name">${escapeHtml(room.name)}</div>
        <div class="text-muted text-xs mono">Capacity: ${room.capacity}</div>
        <img src="${API}/api/rooms/${room.id}/qrcode" alt="QR Code for ${escapeHtml(room.name)}" loading="lazy">
        <div class="qr-card-actions">
          <button class="btn btn-outline btn-sm" onclick="downloadQR(${room.id}, '${escapeHtml(room.name)}')">
            <i data-lucide="download" style="width:14px;height:14px"></i> Download
          </button>
          <button class="btn btn-outline btn-sm" onclick="printQR(${room.id}, '${escapeHtml(room.name)}')">
            <i data-lucide="printer" style="width:14px;height:14px"></i> Print
          </button>
        </div>
      </div>
    `).join('');
  }

  grid.innerHTML = html;
  lucide.createIcons();
}

function downloadQR(roomId, roomName) {
  const link = document.createElement('a');
  link.href = `${API}/api/rooms/${roomId}/qrcode`;
  link.download = `qr-${roomName.replace(/\s+/g, '-').toLowerCase()}.png`;
  link.click();
}

function printQR(roomId, roomName) {
  const printArea = document.getElementById('qr-print-area');
  printArea.innerHTML = `
    <h1>${escapeHtml(roomName)}</h1>
    <img src="${API}/api/rooms/${roomId}/qrcode" alt="QR Code">
    <p class="qr-url">Scan to book this room</p>
  `;
  printArea.style.display = 'block';
  window.print();
  setTimeout(() => { printArea.style.display = 'none'; }, 1000);
}

function downloadFloorQR(slug, name) {
  const link = document.createElement('a');
  link.href = `${API}/api/offices/${slug}/floorview-qrcode`;
  link.download = `qr-floorplan-${slug}.png`;
  link.click();
}

function printFloorQR(slug, name) {
  const printArea = document.getElementById('qr-print-area');
  printArea.innerHTML = `
    <h1>${escapeHtml(name)} â Floor Plan</h1>
    <img src="${API}/api/offices/${slug}/floorview-qrcode" alt="QR Code">
    <p class="qr-url">Scan to view floor plan & book rooms</p>
  `;
  printArea.style.display = 'block';
  window.print();
  setTimeout(() => { printArea.style.display = 'none'; }, 1000);
}

// ===== Settings =====
async function loadSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    const settings = await res.json();

    document.getElementById('setting-delegated-user').value = settings.google_delegated_user || '';
    document.getElementById('setting-customer-id').value = settings.google_customer_id || 'my_customer';
    document.getElementById('setting-base-url').value = settings.base_url || '';
    if (settings.timezone) document.getElementById('setting-timezone').value = settings.timezone;
    if (settings.anthropic_api_key) document.getElementById('setting-anthropic-key').value = settings.anthropic_api_key;

    // Update key upload status
    if (settings.google_key_uploaded) {
      document.getElementById('google-key-status').innerHTML =
        '<i data-lucide="check-circle" style="width:16px;height:16px;vertical-align:middle;color:var(--teal)"></i> Service account key uploaded';
      lucide.createIcons();
    }

    // Check connection status
    checkGoogleStatus();

    // Load sync status
    loadSyncStatus();

    // Load backup status
    loadBackupStatus();
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function checkGoogleStatus() {
  try {
    const res = await fetch(`${API}/api/settings/google-status`);
    const status = await res.json();
    const badge = document.getElementById('google-status-badge');

    if (status.connected) {
      badge.className = 'connection-badge connected';
      badge.innerHTML = '<span class="status-dot green"></span> Connected';

      // Show sync section
      document.getElementById('google-sync-section').style.display = 'block';
    } else {
      badge.className = 'connection-badge disconnected';
      badge.innerHTML = '<span class="status-dot gray"></span> Not connected';
      document.getElementById('google-resources-section').style.display = 'none';
      document.getElementById('google-sync-section').style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to check Google status:', err);
  }
}

async function loadGoogleResources() {
  try {
    const res = await fetch(`${API}/api/settings/google-resources`);
    if (!res.ok) throw new Error('Failed to load resources');
    googleResources = await res.json();

    const section = document.getElementById('google-resources-section');
    const list = document.getElementById('google-resources-list');

    if (googleResources.length > 0) {
      section.style.display = 'block';
      list.innerHTML = googleResources.map(r => `
        <div class="resource-item">
          <div>
            <div class="resource-item-name">${escapeHtml(r.name)}</div>
            <div class="resource-item-email">${escapeHtml(r.email)}</div>
          </div>
          <span class="text-xs mono" style="color:var(--stone)">${r.capacity ? r.capacity + ' seats' : ''}</span>
        </div>
      `).join('');
    } else {
      section.style.display = 'block';
      list.innerHTML = '<div class="resource-item text-muted">No room resources found in your Google Workspace</div>';
    }
  } catch (err) {
    console.warn('Could not load Google resources:', err);
  }
}

// Google key upload
const googleKeyUpload = document.getElementById('google-key-upload');
const googleKeyInput = document.getElementById('google-key-input');

googleKeyUpload.addEventListener('click', () => googleKeyInput.click());
googleKeyUpload.addEventListener('dragover', (e) => { e.preventDefault(); googleKeyUpload.classList.add('dragover'); });
googleKeyUpload.addEventListener('dragleave', () => googleKeyUpload.classList.remove('dragover'));
googleKeyUpload.addEventListener('drop', (e) => {
  e.preventDefault();
  googleKeyUpload.classList.remove('dragover');
  if (e.dataTransfer.files.length) uploadGoogleKey(e.dataTransfer.files[0]);
});
googleKeyInput.addEventListener('change', () => {
  if (googleKeyInput.files.length) uploadGoogleKey(googleKeyInput.files[0]);
});

async function uploadGoogleKey(file) {
  const formData = new FormData();
  formData.append('keyfile', file);

  try {
    const res = await fetch(`${API}/api/settings/google-key`, { method: 'POST', body: formData });
    const result = await res.json();

    if (res.ok) {
      showToast(`Key uploaded: ${result.client_email}`);
      document.getElementById('google-key-status').innerHTML =
        `<i data-lucide="check-circle" style="width:16px;height:16px;vertical-align:middle;color:var(--teal)"></i> Key uploaded (${escapeHtml(result.client_email)})`;
      lucide.createIcons();
    } else {
      showToast(result.error || 'Upload failed', 'error');
    }
  } catch (err) {
    showToast('Upload failed', 'error');
  }
}

// Save Google settings
document.getElementById('save-google-settings').addEventListener('click', async () => {
  const data = {
    google_delegated_user: document.getElementById('setting-delegated-user').value.trim(),
    google_customer_id: document.getElementById('setting-customer-id').value.trim()
  };

  try {
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    showToast('Google settings saved');
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
});

// Test Google connection
document.getElementById('test-google-connection').addEventListener('click', async () => {
  const resultDiv = document.getElementById('google-test-result');
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

  try {
    const res = await fetch(`${API}/api/settings/google-status`);
    const status = await res.json();

    if (status.connected) {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(0,147,163,0.08);border-radius:8px;border:1px solid var(--teal)">
          <strong style="color:var(--teal)">Connected successfully!</strong><br>
          <span class="mono text-xs">Account: ${escapeHtml(status.clientEmail)}</span><br>
          <span class="mono text-xs">Project: ${escapeHtml(status.projectId)}</span>
        </div>
      `;
      checkGoogleStatus();
    } else {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
          <strong style="color:var(--red)">Connection failed</strong><br>
          <span class="text-small">${escapeHtml(status.error || 'Unknown error')}</span>
        </div>
      `;
    }
  } catch (err) {
    resultDiv.innerHTML = `
      <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
        <strong style="color:var(--red)">Connection failed</strong><br>
        <span class="text-small">${escapeHtml(err.message)}</span>
      </div>
    `;
  }
});

// Save general settings
document.getElementById('save-general-settings').addEventListener('click', async () => {
  const apiKeyVal = document.getElementById('setting-anthropic-key').value.trim();
  const data = {
    base_url: document.getElementById('setting-base-url').value.trim(),
    timezone: document.getElementById('setting-timezone').value
  };
  if (apiKeyVal) data.anthropic_api_key = apiKeyVal;

  try {
    await fetch(`${API}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    showToast('Settings saved');
  } catch (err) {
    showToast('Failed to save settings', 'error');
  }
});

// ===== Google Calendar Sync =====
async function loadSyncStatus() {
  try {
    const res = await fetch(`${API}/api/settings/google-sync-status`);
    const data = await res.json();
    const el = document.getElementById('last-sync-time');
    if (data.lastSync) {
      const d = new Date(data.lastSync);
      el.textContent = `Last sync: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    } else {
      el.textContent = 'Not synced yet';
    }

    // Update push notification status
    const badge = document.getElementById('push-status-badge');
    const enableBtn = document.getElementById('enable-push-btn');
    const disableBtn = document.getElementById('disable-push-btn');

    if (data.push && data.push.active) {
      badge.className = 'connection-badge connected';
      badge.innerHTML = `<span class="status-dot green"></span> Active (${data.push.channelCount} room${data.push.channelCount !== 1 ? 's' : ''})`;
      enableBtn.style.display = 'none';
      disableBtn.style.display = '';
    } else {
      badge.className = 'connection-badge disconnected';
      badge.innerHTML = '<span class="status-dot gray"></span> Off';
      enableBtn.style.display = '';
      disableBtn.style.display = 'none';
    }
  } catch (err) {
    console.warn('Failed to load sync status:', err);
  }
}

// Enable push notifications
document.getElementById('enable-push-btn').addEventListener('click', async () => {
  const btn = document.getElementById('enable-push-btn');
  const resultDiv = document.getElementById('push-result');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></div> Setting up...';

  try {
    const res = await fetch(`${API}/api/settings/google-push`, { method: 'POST' });
    const result = await res.json();

    resultDiv.style.display = 'block';
    if (res.ok) {
      resultDiv.innerHTML = `
        <div style="padding:8px;background:rgba(0,147,163,0.08);border-radius:6px;border:1px solid var(--teal)">
          <span class="mono text-xs" style="color:var(--teal)">Push enabled for ${result.watchCount} room(s)</span>
          ${result.errors.length ? `<br><span class="text-xs" style="color:var(--red)">${escapeHtml(result.errors.join(', '))}</span>` : ''}
        </div>
      `;
      showToast('Push notifications enabled');
    } else {
      resultDiv.innerHTML = `
        <div style="padding:8px;background:rgba(255,47,0,0.06);border-radius:6px;border:1px solid var(--red)">
          <span class="text-xs" style="color:var(--red)">${escapeHtml(result.error)}</span>
        </div>
      `;
    }
    loadSyncStatus();
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `<span class="text-xs" style="color:var(--red)">${escapeHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="bell" style="width:14px;height:14px"></i> Enable Push';
    lucide.createIcons();
  }
});

// Disable push notifications
document.getElementById('disable-push-btn').addEventListener('click', async () => {
  const btn = document.getElementById('disable-push-btn');
  btn.disabled = true;

  try {
    await fetch(`${API}/api/settings/google-push`, { method: 'DELETE' });
    showToast('Push notifications disabled');
    document.getElementById('push-result').style.display = 'none';
    loadSyncStatus();
  } catch (err) {
    showToast('Failed to disable push', 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('manual-sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('manual-sync-btn');
  const resultDiv = document.getElementById('sync-result');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></div> Syncing...';

  try {
    const res = await fetch(`${API}/api/settings/google-sync`, { method: 'POST' });
    const result = await res.json();

    resultDiv.style.display = 'block';
    if (result.synced) {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(0,147,163,0.08);border-radius:8px;border:1px solid var(--teal);margin-bottom:12px">
          <strong style="color:var(--teal)">Sync complete</strong><br>
          <span class="mono text-xs">Imported: ${result.imported} Â· Removed: ${result.removed} Â· Unchanged: ${result.skipped}</span>
          ${result.errors.length ? `<br><span class="text-xs" style="color:var(--red)">${result.errors.join(', ')}</span>` : ''}
        </div>
      `;
      showToast(`Synced: ${result.imported} imported, ${result.removed} removed`);
    } else {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red);margin-bottom:12px">
          <strong style="color:var(--red)">Sync not available</strong><br>
          <span class="text-small">${escapeHtml(result.reason || 'Unknown reason')}</span>
        </div>
      `;
    }
    loadSyncStatus();
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red);margin-bottom:12px">
        <strong style="color:var(--red)">Sync failed</strong><br>
        <span class="text-small">${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="refresh-cw" style="width:14px;height:14px"></i> Sync Now';
    lucide.createIcons();
  }
});

// ===== Backup / Restore =====
async function loadBackupStatus() {
  try {
    const res = await fetch(`${API}/api/settings/backup-status`);
    const status = await res.json();
    const badge = document.getElementById('backup-status-badge');
    const toggle = document.getElementById('auto-backup-toggle');
    const lastTime = document.getElementById('last-backup-time');

    if (status.configured) {
      if (status.autoBackupRunning) {
        badge.className = 'connection-badge connected';
        badge.innerHTML = '<span class="status-dot green"></span> Auto-backup active';
      } else {
        badge.className = 'connection-badge disconnected';
        badge.innerHTML = '<span class="status-dot gray"></span> Ready';
      }
      toggle.checked = status.autoBackupEnabled;
    } else {
      badge.className = 'connection-badge disconnected';
      badge.innerHTML = '<span class="status-dot gray"></span> Connect Google first';
      toggle.disabled = true;
    }

    if (status.lastBackup) {
      const d = new Date(status.lastBackup);
      lastTime.textContent = `Last: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }
  } catch (err) {
    console.warn('Failed to load backup status:', err);
  }
}

// Auto-backup toggle
document.getElementById('auto-backup-toggle').addEventListener('change', async (e) => {
  try {
    await fetch(`${API}/api/settings/auto-backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: e.target.checked })
    });
    showToast(e.target.checked ? 'Auto-backup enabled' : 'Auto-backup disabled');
    loadBackupStatus();
  } catch (err) {
    showToast('Failed to update auto-backup', 'error');
  }
});

// Manual backup
document.getElementById('manual-backup-btn').addEventListener('click', async () => {
  const btn = document.getElementById('manual-backup-btn');
  const resultDiv = document.getElementById('backup-result');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></div> Backing up...';
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

  try {
    const res = await fetch(`${API}/api/settings/backup`, { method: 'POST' });
    const result = await res.json();

    if (res.ok) {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(0,147,163,0.08);border-radius:8px;border:1px solid var(--teal)">
          <strong style="color:var(--teal)">Backup complete!</strong><br>
          <span class="mono text-xs">${result.files.length} files backed up to Google Drive</span><br>
          <span class="mono text-xs">${result.timestamp}</span>
        </div>
      `;
      showToast('Backup complete');
      loadBackupStatus();
    } else {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
          <strong style="color:var(--red)">Backup failed</strong><br>
          <span class="text-small">${escapeHtml(result.error)}</span>
        </div>
      `;
    }
  } catch (err) {
    resultDiv.innerHTML = `
      <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
        <strong style="color:var(--red)">Backup failed</strong><br>
        <span class="text-small">${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="upload-cloud" style="width:14px;height:14px"></i> Backup Now';
    lucide.createIcons();
  }
});

// Manual restore
document.getElementById('manual-restore-btn').addEventListener('click', async () => {
  if (!confirm('Restore from Google Drive?\n\nThis will download your backed-up data. A server restart may be required for the database to fully take effect.')) return;

  const btn = document.getElementById('manual-restore-btn');
  const resultDiv = document.getElementById('backup-result');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></div> Restoring...';
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div class="spinner" style="margin:8px auto"></div>';

  try {
    const res = await fetch(`${API}/api/settings/restore`, { method: 'POST' });
    const result = await res.json();

    if (res.ok) {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(0,147,163,0.08);border-radius:8px;border:1px solid var(--teal)">
          <strong style="color:var(--teal)">Restore complete!</strong><br>
          <span class="mono text-xs">${result.files.length} files restored from Google Drive</span>
          ${result.restartRequired ? '<br><strong style="color:var(--red)">â  Restart the server to apply database changes</strong>' : ''}
        </div>
      `;
      showToast('Restore complete');
    } else {
      resultDiv.innerHTML = `
        <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
          <strong style="color:var(--red)">Restore failed</strong><br>
          <span class="text-small">${escapeHtml(result.error)}</span>
        </div>
      `;
    }
  } catch (err) {
    resultDiv.innerHTML = `
      <div style="padding:12px;background:rgba(255,47,0,0.06);border-radius:8px;border:1px solid var(--red)">
        <strong style="color:var(--red)">Restore failed</strong><br>
        <span class="text-small">${escapeHtml(err.message)}</span>
      </div>
    `;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="download-cloud" style="width:14px;height:14px"></i> Restore from Drive';
    lucide.createIcons();
  }
});

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadOffices();
  loadRooms();
  if (typeof loadDashboard === 'function') loadDashboard();
  lucide.createIcons();
});
