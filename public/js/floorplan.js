/* ===== Floor Plan Module ===== */

let floorPlans = [];
let currentFloorPlan = null;
let markers = [];
let editMode = false;
let placementMode = false;
let placingRoomId = null;

// ===== Load Floor Plans =====
async function loadFloorPlans() {
  try {
    const res = await fetch(`${API}/api/floorplans`);
    floorPlans = await res.json();
    renderFloorPlanSelector();
  } catch (err) {
    console.error('Failed to load floor plans:', err);
  }
}

function renderFloorPlanSelector() {
  const select = document.getElementById('floorplan-select');
  const empty = document.getElementById('floorplan-empty');
  const uploadArea = document.getElementById('floorplan-upload-area');
  const display = document.getElementById('floorplan-display');

  select.innerHTML = '<option value="">Select a floor plan...</option>';
  floorPlans.forEach(fp => {
    const opt = document.createElement('option');
    opt.value = fp.id;
    opt.textContent = fp.name;
    select.appendChild(opt);
  });

  if (floorPlans.length === 0) {
    empty.style.display = 'block';
    display.style.display = 'none';
    document.getElementById('edit-markers-btn').style.display = 'none';
    document.getElementById('place-room-btn').style.display = 'none';
    document.getElementById('delete-floorplan-btn').style.display = 'none';
  } else {
    empty.style.display = 'none';
    // Auto-select first floor plan
    if (!currentFloorPlan) {
      select.value = floorPlans[0].id;
      selectFloorPlan(floorPlans[0].id);
    }
  }
}

// ===== Select Floor Plan =====
document.getElementById('floorplan-select').addEventListener('change', (e) => {
  if (e.target.value) selectFloorPlan(parseInt(e.target.value));
});

async function selectFloorPlan(id) {
  currentFloorPlan = floorPlans.find(fp => fp.id === id);
  if (!currentFloorPlan) return;

  const display = document.getElementById('floorplan-display');
  const img = document.getElementById('floorplan-image');

  display.style.display = 'block';
  img.src = currentFloorPlan.image_path;
  document.getElementById('floorplan-empty').style.display = 'none';
  document.getElementById('edit-markers-btn').style.display = '';
  document.getElementById('place-room-btn').style.display = '';
  document.getElementById('delete-floorplan-btn').style.display = '';

  await loadMarkers();
}

// ===== Load Markers =====
async function loadMarkers() {
  if (!currentFloorPlan) return;

  try {
    const res = await fetch(`${API}/api/floorplans/${currentFloorPlan.id}/markers`);
    markers = await res.json();

    // Also load current availability for coloring
    const today = new Date().toISOString().slice(0, 10);
    const bookingsRes = await fetch(`${API}/api/bookings?date=${today}`);
    const allBookings = await bookingsRes.json();
    const now = new Date().toISOString();

    renderMarkers(allBookings, now);
  } catch (err) {
    console.error('Failed to load markers:', err);
  }
}

function renderMarkers(allBookings, now) {
  const layer = document.getElementById('markers-layer');
  layer.innerHTML = '';

  markers.forEach(marker => {
    const isOccupied = allBookings.some(b =>
      b.room_id === marker.room_id &&
      b.start_time <= now &&
      b.end_time > now
    );

    const el = document.createElement('div');
    el.className = 'room-marker';
    el.dataset.roomId = marker.room_id;
    el.style.left = marker.x_percent + '%';
    el.style.top = marker.y_percent + '%';
    el.innerHTML = `
      <div class="marker-dot ${isOccupied ? 'occupied' : 'available'}"></div>
      <span class="marker-label">${escapeHtml(marker.room_name)}</span>
    `;

    // Click to open sidebar
    el.addEventListener('click', (e) => {
      if (editMode) return;
      e.stopPropagation();
      openBookingSidebar(marker.room_id);
    });

    // Drag functionality for edit mode
    setupMarkerDrag(el, marker);

    layer.appendChild(el);
  });
}

// ===== Marker Drag =====
function setupMarkerDrag(el, marker) {
  let isDragging = false;

  const onStart = (e) => {
    if (!editMode) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    el.classList.add('marker-dragging');

    const onMove = (e) => {
      if (!isDragging) return;
      const img = document.getElementById('floorplan-image');
      const rect = img.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      let xPct = ((clientX - rect.left) / rect.width) * 100;
      let yPct = ((clientY - rect.top) / rect.height) * 100;
      xPct = Math.max(0, Math.min(100, xPct));
      yPct = Math.max(0, Math.min(100, yPct));

      el.style.left = xPct + '%';
      el.style.top = yPct + '%';
    };

    const onEnd = async (e) => {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove('marker-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);

      // Save new position
      const xPct = parseFloat(el.style.left);
      const yPct = parseFloat(el.style.top);

      try {
        await fetch(`${API}/api/rooms/${marker.room_id}/marker`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            floor_plan_id: currentFloorPlan.id,
            x_percent: xPct,
            y_percent: yPct
          })
        });
      } catch (err) {
        showToast('Failed to save marker position', 'error');
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  };

  el.addEventListener('mousedown', onStart);
  el.addEventListener('touchstart', onStart, { passive: false });
}

// ===== Edit Mode Toggle =====
document.getElementById('edit-markers-btn').addEventListener('click', () => {
  editMode = !editMode;
  const btn = document.getElementById('edit-markers-btn');
  const container = document.getElementById('floorplan-container');

  if (editMode) {
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-red');
    btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Done Editing';
    container.classList.add('floorplan-edit-mode');
  } else {
    btn.classList.remove('btn-red');
    btn.classList.add('btn-outline');
    btn.innerHTML = '<i data-lucide="move" style="width:14px;height:14px"></i> Edit Layout';
    container.classList.remove('floorplan-edit-mode');
  }
  lucide.createIcons();
});

// ===== Place Room =====
document.getElementById('place-room-btn').addEventListener('click', () => {
  openPlaceRoomModal();
});

function openPlaceRoomModal() {
  // Find rooms not yet placed on this floor plan
  const placedRoomIds = markers.map(m => m.room_id);
  const unplaced = rooms.filter(r => !placedRoomIds.includes(r.id));

  const list = document.getElementById('unplaced-rooms-list');

  if (unplaced.length === 0) {
    list.innerHTML = '<p class="text-muted">All rooms are already placed on this floor plan.</p>';
  } else {
    list.innerHTML = unplaced.map(r => `
      <div class="resource-item" style="cursor:pointer" onclick="startPlacement(${r.id}, '${escapeHtml(r.name)}')">
        <div>
          <div class="resource-item-name">${escapeHtml(r.name)}</div>
          <div class="resource-item-email">Capacity: ${r.capacity}</div>
        </div>
        <i data-lucide="map-pin" style="width:16px;height:16px;color:var(--teal)"></i>
      </div>
    `).join('');
  }

  document.getElementById('place-room-modal').classList.add('open');
  lucide.createIcons();
}

document.getElementById('close-place-modal').addEventListener('click', () => {
  document.getElementById('place-room-modal').classList.remove('open');
});
document.getElementById('cancel-place-room').addEventListener('click', () => {
  document.getElementById('place-room-modal').classList.remove('open');
});

function startPlacement(roomId, roomName) {
  document.getElementById('place-room-modal').classList.remove('open');
  placementMode = true;
  placingRoomId = roomId;

  const container = document.getElementById('floorplan-container');
  container.classList.add('floorplan-placement-mode');
  showToast(`Click on the floor plan to place "${roomName}"`);
}

// Click on floor plan to place marker
document.getElementById('floorplan-container').addEventListener('click', async (e) => {
  if (!placementMode || !placingRoomId) return;

  const img = document.getElementById('floorplan-image');
  const rect = img.getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width) * 100;
  const yPct = ((e.clientY - rect.top) / rect.height) * 100;

  if (xPct < 0 || xPct > 100 || yPct < 0 || yPct > 100) return;

  try {
    await fetch(`${API}/api/rooms/${placingRoomId}/marker`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        floor_plan_id: currentFloorPlan.id,
        x_percent: xPct,
        y_percent: yPct
      })
    });

    showToast('Room placed on floor plan');
    placementMode = false;
    placingRoomId = null;
    document.getElementById('floorplan-container').classList.remove('floorplan-placement-mode');
    await loadMarkers();
  } catch (err) {
    showToast('Failed to place room', 'error');
  }
});

// ===== Floor Plan Upload =====
const floorplanModal = document.getElementById('floorplan-modal');
let pendingFloorplanFile = null;

function openFloorplanUploadModal() {
  pendingFloorplanFile = null;
  document.getElementById('floorplan-name').value = '';
  document.getElementById('floorplan-preview').style.display = 'none';
  floorplanModal.classList.add('open');
}

document.getElementById('upload-floorplan-btn').addEventListener('click', openFloorplanUploadModal);
document.getElementById('upload-floorplan-empty-btn')?.addEventListener('click', openFloorplanUploadModal);
document.getElementById('close-floorplan-modal').addEventListener('click', () => floorplanModal.classList.remove('open'));
document.getElementById('cancel-floorplan-upload').addEventListener('click', () => floorplanModal.classList.remove('open'));

const fpModalUpload = document.getElementById('floorplan-modal-upload');
const fpModalFile = document.getElementById('floorplan-modal-file');

fpModalUpload.addEventListener('click', () => fpModalFile.click());
fpModalUpload.addEventListener('dragover', (e) => { e.preventDefault(); fpModalUpload.classList.add('dragover'); });
fpModalUpload.addEventListener('dragleave', () => fpModalUpload.classList.remove('dragover'));
fpModalUpload.addEventListener('drop', (e) => {
  e.preventDefault();
  fpModalUpload.classList.remove('dragover');
  if (e.dataTransfer.files.length) previewFloorplan(e.dataTransfer.files[0]);
});
fpModalFile.addEventListener('change', () => {
  if (fpModalFile.files.length) previewFloorplan(fpModalFile.files[0]);
});

function previewFloorplan(file) {
  pendingFloorplanFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('floorplan-preview-img').src = e.target.result;
    document.getElementById('floorplan-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);

  if (!document.getElementById('floorplan-name').value) {
    document.getElementById('floorplan-name').value = file.name.replace(/\.[^.]+$/, '');
  }
}

document.getElementById('confirm-floorplan-upload').addEventListener('click', async () => {
  if (!pendingFloorplanFile) return showToast('Select an image first', 'error');

  const name = document.getElementById('floorplan-name').value.trim() || 'Floor Plan';
  const formData = new FormData();
  formData.append('image', pendingFloorplanFile);
  formData.append('name', name);

  try {
    const res = await fetch(`${API}/api/floorplans`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');

    const plan = await res.json();
    showToast('Floor plan uploaded');
    floorplanModal.classList.remove('open');
    await loadFloorPlans();

    document.getElementById('floorplan-select').value = plan.id;
    selectFloorPlan(plan.id);
  } catch (err) {
    showToast('Failed to upload floor plan', 'error');
  }
});

// Delete floor plan
document.getElementById('delete-floorplan-btn').addEventListener('click', async () => {
  if (!currentFloorPlan) return;
  if (!confirm(`Delete floor plan "${currentFloorPlan.name}"?`)) return;

  try {
    await fetch(`${API}/api/floorplans/${currentFloorPlan.id}`, { method: 'DELETE' });
    showToast('Floor plan deleted');
    currentFloorPlan = null;
    await loadFloorPlans();
  } catch (err) {
    showToast('Failed to delete floor plan', 'error');
  }
});

// Refresh markers periodically
setInterval(() => {
  if (currentFloorPlan && !editMode && !placementMode) {
    loadMarkers();
  }
}, 60000);
