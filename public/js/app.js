/* ===== Bahn Express Room Booking — Main App ===== */

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

    if (btn.dataset.tab === 'rooms') loadRooms();
    if (btn.dataset.tab === 'qrcodes') loadQRCodes();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'floorplan') loadFloorPlans();
  });
});

// ===== Rooms State =====
let rooms = [];
let googleResources = [];

async function loadRooms() {
  try {
    const res = await fetch(`${API}/api/rooms`);
    rooms = await res.json();
    renderRooms();
  } catch (err) {
    showToast('Failed to load rooms', 'error');
  }
}

function renderRooms() {
  const grid = document.getElementById('rooms-grid');
  const empty = document.getElementById('rooms-empty');

  if (rooms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = rooms.map(room => `
    <div class="room-card" data-room-id="${room.id}">
      <div class="room-card-header">
        <span class="room-card-name">${escapeHtml(room.name)}</span>
        <span class="room-card-capacity"><i data-lucide="users" style="width:12px;height:12px"></i> ${room.capacity}</span>
      </div>
      ${room.amenities ? `
        <div class="room-card-amenities">
          ${room.amenities.split(',').filter(a => a.trim()).map(a => `<span class="amenity-tag">${escapeHtml(a.trim())}</span>`).join('')}
        </div>
      ` : ''}
      ${room.google_resource_email
        ? `<div class="google-linked"><span class="status-dot green"></span> Google Calendar linked</div>`
        : `<div class="google-unlinked"><span class="status-dot gray"></span> Not linked to Google</div>`
      }
      <div class="room-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="editRoom(${room.id})">
          <i data-lucide="pencil" style="width:14px;height:14px"></i> Edit
        </button>
        <button class="btn btn-ghost btn-sm" onclick="deleteRoom(${room.id})">
          <i data-lucide="trash-2" style="width:14px;height:14px"></i>
        </button>
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

// ===== Room Modal =====
const roomModal = document.getElementById('room-modal');

function openRoomModal(room = null) {
  document.getElementById('room-modal-title').textContent = room ? 'Edit Room' : 'Add Room';
  document.getElementById('room-edit-id').value = room ? room.id : '';
  document.getElementById('room-name').value = room ? room.name : '';
  document.getElementById('room-capacity').value = room ? room.capacity : 4;
  document.getElementById('room-amenities').value = room ? room.amenities : '';

  // Populate Google resources dropdown
  const select = document.getElementById('room-google-resource');
  select.innerHTML = '<option value="">None (not linked)</option>';
  googleResources.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.email;
    opt.textContent = `${r.name} (${r.email})`;
    if (room && room.google_resource_email === r.email) opt.selected = true;
    select.appendChild(opt);
  });

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
  const data = {
    name: document.getElementById('room-name').value.trim(),
    capacity: parseInt(document.getElementById('room-capacity').value) || 1,
    amenities: document.getElementById('room-amenities').value.trim(),
    google_resource_email: document.getElementById('room-google-resource').value || null
  };

  if (!data.name) return showToast('Room name is required', 'error');

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

    showToast(id ? 'Room updated' : 'Room created');
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
  if (rooms.length === 0) await loadRooms();

  const grid = document.getElementById('qr-grid');
  const empty = document.getElementById('qr-empty');

  if (rooms.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = rooms.map(room => `
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

// ===== Settings =====
async function loadSettings() {
  try {
    const res = await fetch(`${API}/api/settings`);
    const settings = await res.json();

    document.getElementById('setting-delegated-user').value = settings.google_delegated_user || '';
    document.getElementById('setting-customer-id').value = settings.google_customer_id || 'my_customer';
    document.getElementById('setting-base-url').value = settings.base_url || '';
    if (settings.timezone) document.getElementById('setting-timezone').value = settings.timezone;

    // Update key upload status
    if (settings.google_key_uploaded) {
      document.getElementById('google-key-status').innerHTML =
        '<i data-lucide="check-circle" style="width:16px;height:16px;vertical-align:middle;color:var(--teal)"></i> Service account key uploaded';
      lucide.createIcons();
    }

    // Check connection status
    checkGoogleStatus();

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

      // Load resources
      loadGoogleResources();
    } else {
      badge.className = 'connection-badge disconnected';
      badge.innerHTML = '<span class="status-dot gray"></span> Not connected';
      document.getElementById('google-resources-section').style.display = 'none';
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
  const data = {
    base_url: document.getElementById('setting-base-url').value.trim(),
    timezone: document.getElementById('setting-timezone').value
  };

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
          ${result.restartRequired ? '<br><strong style="color:var(--red)">⚠ Restart the server to apply database changes</strong>' : ''}
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
document.addEventListener('DOMContentLoaded', () => {
  loadRooms();
  loadFloorPlans();
  lucide.createIcons();
});
