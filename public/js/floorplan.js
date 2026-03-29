/* ===== Floors Module ===== */

let floorPlans = [];
let currentFloorPlan = null;
let markers = [];
let editMode = false;
let placementMode = false;
let placingRoomId = null;

// ===== Load Floors =====
async function loadFloorPlans() {
  const officeId = getSelectedOfficeId();
  if (!officeId) {
    floorPlans = [];
    currentFloorPlan = null;
    renderFloorSelector();
    return;
  }
  try {
    const res = await fetch(`${API}/api/floorplans?office_id=${officeId}`);
    floorPlans = await res.json();
    currentFloorPlan = null;
    renderFloorSelector();
  } catch (err) {
    console.error('Failed to load floors:', err);
  }
}

function renderFloorSelector() {
  const select = document.getElementById('floorplan-select');
  const empty = document.getElementById('floorplan-empty');
  const display = document.getElementById('floorplan-display');
  const noImage = document.getElementById('floorplan-no-image');
  const officeId = getSelectedOfficeId();

  select.innerHTML = '<option value="">Select a floor...</option>';
  floorPlans.forEach(fp => {
    const opt = document.createElement('option');
    opt.value = fp.id;
    opt.textContent = `Floor ${fp.floor_number} â ${fp.name}`;
    select.appendChild(opt);
  });

  // Show/hide buttons based on office selection
  const addBtn = document.getElementById('add-floor-btn');
  addBtn.style.display = officeId ? '' : 'none';
  document.getElementById('ai-floorplan-btn').style.display = officeId ? '' : 'none';

  if (floorPlans.length === 0) {
    empty.style.display = 'block';
    display.style.display = 'none';
    noImage.style.display = 'none';
    document.getElementById('edit-markers-btn').style.display = 'none';
    document.getElementById('place-room-btn').style.display = 'none';
    document.getElementById('delete-floorplan-btn').style.display = 'none';
    document.getElementById('upload-floorplan-btn').style.display = 'none';
    if (!officeId) document.getElementById('ai-floorplan-btn').style.display = 'none';

    if (!officeId) {
      empty.innerHTML = `
        <i data-lucide="layers" style="width:48px;height:48px"></i>
        <h3>Select an office</h3>
        <p>Choose an office from the dropdown to view or add floors</p>
      `;
    } else {
      empty.innerHTML = `
        <i data-lucide="layers" style="width:48px;height:48px"></i>
        <h3>No floors yet</h3>
        <p>Add a floor to get started</p>
      `;
    }
    lucide.createIcons();
  } else {
    empty.style.display = 'none';
    // Auto-select first floor
    select.value = floorPlans[0].id;
    selectFloorPlan(floorPlans[0].id);
  }
}

// ===== Select Floor =====
document.getElementById('floorplan-select').addEventListener('change', (e) => {
  if (e.target.value) selectFloorPlan(parseInt(e.target.value));
});

async function selectFloorPlan(id) {
  currentFloorPlan = floorPlans.find(fp => fp.id === id);
  if (!currentFloorPlan) return;

  const display = document.getElementById('floorplan-display');
  const noImage = document.getElementById('floorplan-no-image');
  const img = document.getElementById('floorplan-image');

  document.getElementById('floorplan-empty').style.display = 'none';
  document.getElementById('delete-floorplan-btn').style.display = '';
  document.getElementById('upload-floorplan-btn').style.display = '';

  if (currentFloorPlan.image_path) {
    display.style.display = 'block';
    noImage.style.display = 'none';
    img.src = currentFloorPlan.image_path;
    document.getElementById('edit-markers-btn').style.display = '';
    document.getElementById('place-room-btn').style.display = '';
    await loadMarkers();
  } else {
    display.style.display = 'none';
    noImage.style.display = 'block';
    document.getElementById('edit-markers-btn').style.display = 'none';
    document.getElementById('place-room-btn').style.display = 'none';
    lucide.createIcons();
  }
}

// ===== Load Markers =====
async function loadMarkers() {
  if (!currentFloorPlan) return;

  try {
    const res = await fetch(`${API}/api/floorplans/${currentFloorPlan.id}/markers`);
    markers = await res.json();

    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const bookingsRes = await fetch(`${API}/api/bookings?date=${today}`);
    const allBookings = await bookingsRes.json();
    const now = `${today}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

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

    el.addEventListener('click', (e) => {
      if (editMode) return;
      e.stopPropagation();
      openBookingSidebar(marker.room_id);
    });

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

    const onEnd = async () => {
      if (!isDragging) return;
      isDragging = false;
      el.classList.remove('marker-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);

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
  const floorPlanOfficeId = currentFloorPlan ? currentFloorPlan.office_id : null;
  const placedRoomIds = markers.map(m => m.room_id);
  const unplaced = rooms.filter(r =>
    !placedRoomIds.includes(r.id) &&
    r.office_id === floorPlanOfficeId
  );

  const list = document.getElementById('unplaced-rooms-list');

  if (unplaced.length === 0) {
    list.innerHTML = '<p class="text-muted">All rooms in this office are already placed on a floor.</p>';
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

// ===== Add Floor Modal =====
const floorplanModal = document.getElementById('floorplan-modal');
let pendingFloorplanFile = null;

function openAddFloorModal() {
  const officeId = getSelectedOfficeId();
  if (!officeId) {
    showToast('Select an office first', 'error');
    return;
  }

  document.getElementById('floor-modal-title').textContent = 'Add Floor';
  pendingFloorplanFile = null;
  document.getElementById('floorplan-name').value = '';
  document.getElementById('floorplan-number').value = '';
  document.getElementById('floorplan-preview').style.display = 'none';

  // Auto-suggest next floor number
  const maxFloor = floorPlans.reduce((max, fp) => Math.max(max, fp.floor_number || 0), 0);
  document.getElementById('floorplan-number').value = maxFloor + 1;

  floorplanModal.classList.add('open');
}

function openFloorplanImageUpload() {
  if (!currentFloorPlan) return;
  // Reuse the file input directly
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    if (!input.files.length) return;
    const formData = new FormData();
    formData.append('image', input.files[0]);
    try {
      const res = await fetch(`${API}/api/floorplans/${currentFloorPlan.id}/image`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      showToast('Floor plan image uploaded');
      await loadFloorPlans();
      document.getElementById('floorplan-select').value = currentFloorPlan.id;
      selectFloorPlan(currentFloorPlan.id);
    } catch (err) {
      showToast('Failed to upload image', 'error');
    }
  };
  input.click();
}

document.getElementById('add-floor-btn').addEventListener('click', openAddFloorModal);
document.getElementById('upload-floorplan-btn').addEventListener('click', openFloorplanImageUpload);
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
}

document.getElementById('confirm-floorplan-upload').addEventListener('click', async () => {
  const officeId = getSelectedOfficeId();
  if (!officeId) return showToast('Select an office first', 'error');

  const name = document.getElementById('floorplan-name').value.trim();
  const floorNumber = document.getElementById('floorplan-number').value;
  if (!name) return showToast('Floor name is required', 'error');
  if (!floorNumber) return showToast('Floor number is required', 'error');

  const formData = new FormData();
  if (pendingFloorplanFile) formData.append('image', pendingFloorplanFile);
  formData.append('name', name);
  formData.append('floor_number', floorNumber);
  formData.append('office_id', officeId);

  try {
    const res = await fetch(`${API}/api/floorplans`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      return showToast(err.error || 'Failed to create floor', 'error');
    }

    const plan = await res.json();
    showToast('Floor added');
    floorplanModal.classList.remove('open');
    await loadFloorPlans();

    document.getElementById('floorplan-select').value = plan.id;
    selectFloorPlan(plan.id);
  } catch (err) {
    showToast('Failed to create floor', 'error');
  }
});

// Delete floor
document.getElementById('delete-floorplan-btn').addEventListener('click', async () => {
  if (!currentFloorPlan) return;
  if (!confirm(`Delete "Floor ${currentFloorPlan.floor_number} â ${currentFloorPlan.name}"? Room markers on this floor will be removed.`)) return;

  try {
    await fetch(`${API}/api/floorplans/${currentFloorPlan.id}`, { method: 'DELETE' });
    showToast('Floor deleted');
    currentFloorPlan = null;
    await loadFloorPlans();
  } catch (err) {
    showToast('Failed to delete floor', 'error');
  }
});

// Refresh markers periodically
setInterval(() => {
  if (currentFloorPlan && currentFloorPlan.image_path && !editMode && !placementMode) {
    loadMarkers();
  }
}, 60000);

// ===== AI Floor Plan Creator =====

let aiPhotoFile = null;
let aiResultData = null;

document.getElementById('ai-floorplan-btn').addEventListener('click', openAiModal);
document.getElementById('close-ai-modal').addEventListener('click', closeAiModal);

function openAiModal() {
  const officeId = getSelectedOfficeId();
  if (!officeId) return showToast('Select an office first', 'error');

  // Reset state
  aiPhotoFile = null;
  aiResultData = null;
  document.getElementById('ai-step-input').style.display = '';
  document.getElementById('ai-step-loading').style.display = 'none';
  document.getElementById('ai-step-results').style.display = 'none';
  document.getElementById('ai-photo-section').style.display = 'none';
  document.getElementById('ai-describe-section').style.display = 'none';
  document.getElementById('ai-photo-preview').style.display = 'none';
  document.getElementById('ai-analyze-btn').disabled = true;
  document.getElementById('ai-description').value = '';

  document.getElementById('ai-floorplan-modal').classList.add('open');
  lucide.createIcons();
}

function closeAiModal() {
  document.getElementById('ai-floorplan-modal').classList.remove('open');
}

// Mode toggles
document.getElementById('ai-mode-photo').addEventListener('click', () => {
  document.getElementById('ai-photo-section').style.display = '';
  document.getElementById('ai-describe-section').style.display = 'none';
  document.getElementById('ai-mode-photo').classList.add('btn-primary');
  document.getElementById('ai-mode-photo').classList.remove('btn-outline');
  document.getElementById('ai-mode-describe').classList.add('btn-outline');
  document.getElementById('ai-mode-describe').classList.remove('btn-primary');
});

document.getElementById('ai-mode-describe').addEventListener('click', () => {
  document.getElementById('ai-photo-section').style.display = 'none';
  document.getElementById('ai-describe-section').style.display = '';
  document.getElementById('ai-mode-describe').classList.add('btn-primary');
  document.getElementById('ai-mode-describe').classList.remove('btn-outline');
  document.getElementById('ai-mode-photo').classList.add('btn-outline');
  document.getElementById('ai-mode-photo').classList.remove('btn-primary');
});

// Photo upload
const aiUploadArea = document.getElementById('ai-photo-upload');
const aiFileInput = document.getElementById('ai-photo-file');

aiUploadArea.addEventListener('click', () => aiFileInput.click());
aiUploadArea.addEventListener('dragover', (e) => { e.preventDefault(); aiUploadArea.classList.add('dragover'); });
aiUploadArea.addEventListener('dragleave', () => aiUploadArea.classList.remove('dragover'));
aiUploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  aiUploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length) setAiPhoto(e.dataTransfer.files[0]);
});
aiFileInput.addEventListener('change', () => {
  if (aiFileInput.files.length) setAiPhoto(aiFileInput.files[0]);
});

function setAiPhoto(file) {
  aiPhotoFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById('ai-photo-preview-img').src = e.target.result;
    document.getElementById('ai-photo-preview').style.display = 'block';
    document.getElementById('ai-analyze-btn').disabled = false;
  };
  reader.readAsDataURL(file);
}

// Analyze photo
document.getElementById('ai-analyze-btn').addEventListener('click', async () => {
  if (!aiPhotoFile) return;
  showAiLoading();

  const formData = new FormData();
  formData.append('image', aiPhotoFile);

  try {
    const res = await fetch(`${API}/api/floorplans/ai/analyze`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Analysis failed');
    }
    aiResultData = await res.json();
    showAiResults();
  } catch (err) {
    showToast(err.message, 'error');
    document.getElementById('ai-step-loading').style.display = 'none';
    document.getElementById('ai-step-input').style.display = '';
  }
});

// Generate from description
document.getElementById('ai-generate-btn').addEventListener('click', async () => {
  const desc = document.getElementById('ai-description').value.trim();
  if (!desc) return showToast('Enter a description', 'error');
  showAiLoading();

  try {
    const res = await fetch(`${API}/api/floorplans/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Generation failed');
    }
    aiResultData = await res.json();
    showAiResults();
  } catch (err) {
    showToast(err.message, 'error');
    document.getElementById('ai-step-loading').style.display = 'none';
    document.getElementById('ai-step-input').style.display = '';
  }
});

function showAiLoading() {
  document.getElementById('ai-step-input').style.display = 'none';
  document.getElementById('ai-step-results').style.display = 'none';
  document.getElementById('ai-step-loading').style.display = '';
}

function showAiResults() {
  document.getElementById('ai-step-loading').style.display = 'none';
  document.getElementById('ai-step-results').style.display = '';

  // Render SVG preview
  const svgContainer = document.getElementById('ai-svg-preview');
  if (aiResultData.svg) {
    svgContainer.innerHTML = aiResultData.svg;
    // Scale SVG to fit
    const svg = svgContainer.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = 'auto';
      svg.style.maxHeight = '350px';
    }
  } else {
    svgContainer.innerHTML = '<p style="color:var(--stone);padding:30px">No SVG generated</p>';
  }

  // Render rooms list
  const list = document.getElementById('ai-rooms-list');
  if (aiResultData.rooms && aiResultData.rooms.length > 0) {
    list.innerHTML = aiResultData.rooms.map((r, i) => `
      <div class="resource-item" style="padding:8px 12px">
        <div>
          <div class="resource-item-name">${escapeHtml(r.name)}</div>
          <div class="resource-item-email">Capacity: ${r.capacity} Â· Position: ${Math.round(r.x_percent)}%, ${Math.round(r.y_percent)}%</div>
        </div>
        <i data-lucide="map-pin" style="width:14px;height:14px;color:var(--teal)"></i>
      </div>
    `).join('');
  } else {
    list.innerHTML = '<p class="text-muted text-xs">No rooms detected</p>';
  }

  lucide.createIcons();
}

// Retry
document.getElementById('ai-retry-btn').addEventListener('click', () => {
  aiResultData = null;
  document.getElementById('ai-step-results').style.display = 'none';
  document.getElementById('ai-step-input').style.display = '';
});

// Apply: save SVG as floor plan image and create rooms + markers
document.getElementById('ai-apply-btn').addEventListener('click', async () => {
  if (!aiResultData) return;

  const officeId = getSelectedOfficeId();
  if (!officeId) return showToast('Select an office first', 'error');

  const btn = document.getElementById('ai-apply-btn');
  btn.disabled = true;
  btn.textContent = 'Applying...';

  try {
    // 1. Create a floor
    const maxFloor = floorPlans.reduce((max, fp) => Math.max(max, fp.floor_number || 0), 0);
    const floorNumber = maxFloor + 1;

    const formData = new FormData();
    formData.append('name', `AI Floor ${floorNumber}`);
    formData.append('floor_number', floorNumber);
    formData.append('office_id', officeId);

    // Convert SVG to a blob and attach as image if present
    if (aiResultData.svg) {
      const svgBlob = new Blob([aiResultData.svg], { type: 'image/svg+xml' });
      formData.append('image', svgBlob, 'ai-floorplan.svg');
    }

    const floorRes = await fetch(`${API}/api/floorplans`, { method: 'POST', body: formData });
    if (!floorRes.ok) throw new Error('Failed to create floor');
    const floor = await floorRes.json();

    // 2. Create rooms and place markers
    if (aiResultData.rooms && aiResultData.rooms.length > 0) {
      for (const room of aiResultData.rooms) {
        // Create room
        const roomRes = await fetch(`${API}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: room.name,
            capacity: room.capacity || 4,
            office_id: parseInt(officeId)
          })
        });

        if (roomRes.ok) {
          const createdRoom = await roomRes.json();
          // Place marker
          await fetch(`${API}/api/rooms/${createdRoom.id}/marker`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              floor_plan_id: floor.id,
              x_percent: room.x_percent,
              y_percent: room.y_percent
            })
          });
        }
      }
    }

    showToast(`Floor created with ${aiResultData.rooms?.length || 0} rooms`);
    closeAiModal();

    // Reload and select the new floor
    await loadFloorPlans();
    await loadRooms();
    document.getElementById('floorplan-select').value = floor.id;
    selectFloorPlan(floor.id);
  } catch (err) {
    showToast(err.message || 'Failed to apply', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Apply as Floor Plan';
    lucide.createIcons();
  }
});
