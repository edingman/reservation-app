/* ===== Dashboard Module ===== */

const SOURCE_COLORS = {
  local: '#000000',
  portal: '#000000',
  qr: '#0093A3',
  ipad: '#ACA19A',
  google_calendar: '#4285F4'
};

const SOURCE_LABELS = {
  local: 'Portal',
  portal: 'Portal',
  qr: 'QR Code',
  ipad: 'iPad',
  google_calendar: 'Google Calendar'
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let dashCharts = {};
let dashboardLoaded = false;

function localDateStr(d) {
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

function getDateRange(preset) {
  const now = new Date();
  const today = localDateStr(now);
  let start, end;

  switch (preset) {
    case 'today':
      start = end = today;
      break;
    case 'week': {
      const day = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      start = localDateStr(monday);
      end = localDateStr(sunday);
      break;
    }
    case 'month': {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      break;
    }
    case '30days': {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start = localDateStr(past);
      end = today;
      break;
    }
    default:
      start = document.getElementById('dash-start').value;
      end = document.getElementById('dash-end').value;
  }
  return { start, end };
}

async function loadDashboard(preset) {
  if (!preset && !dashboardLoaded) preset = 'month';

  const range = preset ? getDateRange(preset) : {
    start: document.getElementById('dash-start').value,
    end: document.getElementById('dash-end').value
  };

  if (!range.start || !range.end) return;

  document.getElementById('dash-start').value = range.start;
  document.getElementById('dash-end').value = range.end;

  // Update active preset button
  if (preset) {
    document.querySelectorAll('.date-preset').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.date-preset[data-range="${preset}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  try {
    const officeParam = typeof getSelectedOfficeId === 'function' && getSelectedOfficeId() ? `&office_id=${getSelectedOfficeId()}` : '';
    const res = await fetch(`${API}/api/analytics?start=${range.start}&end=${range.end}${officeParam}`);
    const data = await res.json();
    renderDashboard(data);
    dashboardLoaded = true;

    // Load insights in parallel
    loadInsights(range.start, range.end);
  } catch (err) {
    console.error('Dashboard load failed:', err);
  }
}

function renderDashboard(data) {
  const s = data.summary;

  // Stat cards
  document.getElementById('stat-total-bookings').textContent = s.totalBookings;
  document.getElementById('stat-utilization').textContent = `${s.utilizationRate}%`;
  document.getElementById('stat-active-rooms').textContent = `${s.activeRooms}/${s.totalRooms}`;
  document.getElementById('stat-avg-duration').textContent = `${s.avgDurationMinutes}m`;
  document.getElementById('stat-today').textContent = s.bookingsToday;
  document.getElementById('stat-popular-room').textContent = s.mostPopularRoom;

  // Destroy existing charts
  Object.values(dashCharts).forEach(c => c.destroy());
  dashCharts = {};

  // Source donut chart
  if (data.bySource.length > 0) {
    // Merge 'local' and 'portal' sources
    const mergedSources = {};
    data.bySource.forEach(s => {
      const key = s.source === 'local' ? 'portal' : s.source;
      if (!mergedSources[key]) mergedSources[key] = { source: key, count: 0, hours: 0 };
      mergedSources[key].count += s.count;
      mergedSources[key].hours += s.hours;
    });
    const sources = Object.values(mergedSources);

    dashCharts.sources = new Chart(document.getElementById('chart-sources'), {
      type: 'doughnut',
      data: {
        labels: sources.map(s => SOURCE_LABELS[s.source] || s.source),
        datasets: [{
          data: sources.map(s => s.count),
          backgroundColor: sources.map(s => SOURCE_COLORS[s.source] || '#999'),
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: "'Geist', sans-serif", size: 12 } } }
        }
      }
    });
  }

  // Daily trend line chart
  if (data.byDay.length > 0) {
    dashCharts.daily = new Chart(document.getElementById('chart-daily'), {
      type: 'line',
      data: {
        labels: data.byDay.map(d => {
          const date = new Date(d.date + 'T12:00:00');
          return `${date.getDate()}/${date.getMonth() + 1}`;
        }),
        datasets: [{
          label: 'Bookings',
          data: data.byDay.map(d => d.count),
          borderColor: '#0093A3',
          backgroundColor: 'rgba(0, 147, 163, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: "'Geist Mono', monospace", size: 11 } } },
          x: { ticks: { font: { family: "'Geist Mono', monospace", size: 10 }, maxRotation: 45 } }
        }
      }
    });
  }

  // Room utilization horizontal bar
  if (data.byRoom.length > 0) {
    const sorted = [...data.byRoom].sort((a, b) => b.utilization - a.utilization);
    dashCharts.rooms = new Chart(document.getElementById('chart-rooms'), {
      type: 'bar',
      data: {
        labels: sorted.map(r => r.room_name),
        datasets: [{
          label: 'Utilization %',
          data: sorted.map(r => Math.round(r.utilization * 10) / 10),
          backgroundColor: sorted.map(r => r.utilization > 70 ? '#FF2F00' : r.utilization > 40 ? '#0093A3' : '#ACA19A'),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { max: 100, ticks: { callback: v => v + '%', font: { family: "'Geist Mono', monospace", size: 11 } } },
          y: { ticks: { font: { family: "'Geist', sans-serif", size: 12 } } }
        }
      }
    });
  }

  // Peak hours bar chart
  if (data.byHour.length > 0) {
    // Fill in missing hours 7-20
    const hourMap = {};
    data.byHour.forEach(h => { hourMap[h.hour] = h.count; });
    const hours = [];
    for (let h = 7; h <= 20; h++) {
      hours.push({ hour: h, count: hourMap[h] || 0 });
    }

    dashCharts.hours = new Chart(document.getElementById('chart-hours'), {
      type: 'bar',
      data: {
        labels: hours.map(h => `${String(h.hour).padStart(2, '0')}:00`),
        datasets: [{
          label: 'Bookings',
          data: hours.map(h => h.count),
          backgroundColor: hours.map(h => h.count > 0 ? '#0093A3' : '#EEEAE7'),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: "'Geist Mono', monospace", size: 11 } } },
          x: { ticks: { font: { family: "'Geist Mono', monospace", size: 10 }, maxRotation: 45 } }
        }
      }
    });
  }

  // Weekday bar chart
  if (data.byWeekday.length > 0) {
    const weekdayMap = {};
    data.byWeekday.forEach(w => { weekdayMap[w.weekday] = w.count; });
    const weekdays = [];
    for (let d = 0; d < 7; d++) {
      weekdays.push({ day: WEEKDAY_LABELS[d], count: weekdayMap[d] || 0 });
    }

    dashCharts.weekdays = new Chart(document.getElementById('chart-weekdays'), {
      type: 'bar',
      data: {
        labels: weekdays.map(w => w.day),
        datasets: [{
          label: 'Bookings',
          data: weekdays.map(w => w.count),
          backgroundColor: weekdays.map((w, i) => (i === 0 || i === 6) ? '#EEEAE7' : '#000'),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: "'Geist Mono', monospace", size: 11 } } },
          x: { ticks: { font: { family: "'Geist', sans-serif", size: 12 } } }
        }
      }
    });
  }

  // Duration distribution bar chart
  if (data.durationDistribution.length > 0) {
    dashCharts.durations = new Chart(document.getElementById('chart-durations'), {
      type: 'bar',
      data: {
        labels: data.durationDistribution.map(d => d.duration_range),
        datasets: [{
          label: 'Count',
          data: data.durationDistribution.map(d => d.count),
          backgroundColor: '#ACA19A',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: "'Geist Mono', monospace", size: 11 } } },
          x: { ticks: { font: { family: "'Geist Mono', monospace", size: 10 } } }
        }
      }
    });
  }
}

async function loadInsights(start, end) {
  const list = document.getElementById('insights-list');
  const aiDiv = document.getElementById('ai-summary');

  list.innerHTML = '<div style="color:var(--stone);font-size:0.85rem">Loading insights...</div>';
  aiDiv.style.display = 'none';

  try {
    const officeParam = typeof getSelectedOfficeId === 'function' && getSelectedOfficeId() ? `&office_id=${getSelectedOfficeId()}` : '';
    const res = await fetch(`${API}/api/analytics/insights?start=${start}&end=${end}${officeParam}`);
    const data = await res.json();

    if (data.insights.length === 0) {
      list.innerHTML = '<div style="color:var(--stone);font-size:0.85rem">No insights available for this period.</div>';
    } else {
      list.innerHTML = data.insights.map(i => `
        <div class="insight-item">
          <div class="insight-icon">
            <i data-lucide="${i.icon}" style="width:18px;height:18px;color:var(--stone)"></i>
          </div>
          <div class="insight-content">
            <div class="insight-title">${escapeHtml(i.title)}</div>
            <div class="insight-text">${escapeHtml(i.text)}</div>
          </div>
        </div>
      `).join('');
      lucide.createIcons();
    }

    // AI Summary
    if (data.aiSummary) {
      aiDiv.style.display = 'block';
      aiDiv.innerHTML = `
        <div class="ai-summary-box">
          <h4><i data-lucide="sparkles" style="width:14px;height:14px"></i> AI Summary</h4>
          <p>${escapeHtml(data.aiSummary)}</p>
        </div>
      `;
      lucide.createIcons();
    } else if (data.hasApiKey) {
      aiDiv.style.display = 'block';
      aiDiv.innerHTML = `
        <div class="ai-summary-box" style="opacity:0.6">
          <h4><i data-lucide="sparkles" style="width:14px;height:14px"></i> AI Summary</h4>
          <p>Not enough data to generate an AI summary.</p>
        </div>
      `;
      lucide.createIcons();
    }
  } catch (err) {
    list.innerHTML = '<div style="color:var(--red);font-size:0.85rem">Failed to load insights.</div>';
  }
}

// Date preset buttons
document.querySelectorAll('.date-preset').forEach(btn => {
  btn.addEventListener('click', () => loadDashboard(btn.dataset.range));
});

// Custom date range
document.getElementById('dash-start').addEventListener('change', () => {
  document.querySelectorAll('.date-preset').forEach(b => b.classList.remove('active'));
  loadDashboard();
});
document.getElementById('dash-end').addEventListener('change', () => {
  document.querySelectorAll('.date-preset').forEach(b => b.classList.remove('active'));
  loadDashboard();
});
