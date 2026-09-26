/* ============================================================
   SENTINEL — Analytics Page JS  (analytics.js)
   ============================================================ */

'use strict';

/* ── CONFIG ── */
const TYPE_COLORS = {
  fire:     '#FF4444',
  med:      '#F5C400',
  sec:      '#B394FF',
  accident: '#FF9500',
};

const TYPE_LABELS = {
  fire:     'Fire',
  med:      'Medical',
  sec:      'Security',
  accident: 'Accident',
};

const STATUS_COLORS = {
  active:        { fill: '#FF4444', label: 'Active' },
  resolved:      { fill: '#4CAF50', label: 'Resolved' },
};

const LOCATION_LABELS = {
  main_building:    'Main Building',
  main_canteen:     'Main Canteen',
  garden:           'Garden',
  parking_lot:      'Parking Lot',
  gate:             'Gate',
  flagpole:         'Flagpole',
  shs_building:     'SHS Building',
  event_center:     'Event Center',
  basketball_court: 'Basketball Court',
  ched_building:    'CHED Building',
  new_building:     'New Building',
  new_canteen:      'New Canteen',
};

/* ── GLOBAL STATE ── */
let allIncidents   = [];
let rangeIncidents = [];

const trendFilter = { type: 'all', status: 'all' };
const donutFilter = { status: 'all' };

let activeDays = 30;

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initReveal();
  initRangeButtons();
  initTrendFilters();
  initDonutFilters();
  fetchAndRender();
  document.getElementById('anlExportBtn')?.addEventListener('click', exportReport);
});

/* ══════════════════════════════════════════════
   DATA FETCH
══════════════════════════════════════════════ */
async function fetchAndRender() {
  showTrendLoading(true);
  try {
    const res = await fetch('/api/incidents/');
    if (!res.ok) throw new Error('Network error');
    allIncidents = await res.json();
  } catch (e) {
    console.error('Analytics fetch error:', e);
    allIncidents = [];
  }
  applyRange(activeDays);
  showTrendLoading(false);
}

/* ── DATE RANGE ── */
function applyRange(days) {
  activeDays = days;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  rangeIncidents = allIncidents.filter(i => i.timeRaw >= cutoff);
  renderAll();
}

function initRangeButtons() {
  document.getElementById('rangeButtons')?.addEventListener('click', e => {
    const btn = e.target.closest('.anl-range-btn');
    if (!btn) return;
    document.querySelectorAll('.anl-range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const days = +btn.dataset.range;
    const labels = { 7: 'Last 7 Days', 30: 'Last 30 Days', 90: 'Last 90 Days', 365: 'Last Year' };
    document.getElementById('dateRangeLabel').textContent = labels[days] || `Last ${days} Days`;
    applyRange(days);
  });
}

/* ── RENDER ALL ── */
function renderAll() {
  renderKPIs();
  renderTrendChart();
  renderDonut();
  renderTypeList();
  renderLocationList();
  renderStatusFunnel();
  renderHourlyChart();
}

/* ── PER-WIDGET SUBSET HELPERS ── */
function getTrendData() {
  let d = [...rangeIncidents];
  if (trendFilter.type   !== 'all') d = d.filter(i => i.type   === trendFilter.type);
  if (trendFilter.status !== 'all') d = d.filter(i => i.status === trendFilter.status);
  return d;
}

function getDonutData() {
  let d = [...rangeIncidents];
  if (donutFilter.status !== 'all') d = d.filter(i => i.status === donutFilter.status);
  return d;
}

/* ══════════════════════════════════════════════
   TREND FILTERS
══════════════════════════════════════════════ */
function initTrendFilters() {
  document.getElementById('trendTypeFilter')?.addEventListener('click', e => {
    const btn = e.target.closest('.anl-chip');
    if (!btn) return;
    document.querySelectorAll('#trendTypeFilter .anl-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trendFilter.type = btn.dataset.type;
    renderTrendChart();
    updateTrendFooter();
  });

  document.getElementById('trendStatusFilter')?.addEventListener('change', e => {
    trendFilter.status = e.target.value;
    renderTrendChart();
    updateTrendFooter();
  });
}

function updateTrendFooter() {
  const el = document.getElementById('trendFootLabel');
  if (!el) return;
  const parts = [];
  if (trendFilter.type   !== 'all') parts.push(TYPE_LABELS[trendFilter.type]);
  if (trendFilter.status !== 'all') parts.push(trendFilter.status);
  el.textContent = parts.length
    ? `Showing ${parts.join(' · ')} incidents over selected period`
    : 'Daily incident counts by type over selected period';
}

/* ══════════════════════════════════════════════
   DONUT FILTERS
══════════════════════════════════════════════ */
function initDonutFilters() {
  document.getElementById('donutStatusFilter')?.addEventListener('change', e => {
    donutFilter.status = e.target.value;
    renderDonut();
    renderTypeList();
  });
}

/* ══════════════════════════════════════════════
   KPIs
══════════════════════════════════════════════ */
function renderKPIs() {
  const inc      = rangeIncidents;
  const total    = inc.length;
  const active   = inc.filter(i => i.status === 'active').length;
  const resolved = inc.filter(i => i.status === 'resolved').length;
  const rate     = total ? Math.round((resolved / total) * 100) : 0;

  animateKPI('kpiTotal',    total);
  animateKPI('kpiActive',   active);
  animateKPI('kpiResolved', resolved);
  animateKPI('kpiRate',     rate, '%');

  setBar('kpiTotalBar',    total    / Math.max(allIncidents.length, 1) * 100);
  setBar('kpiActiveBar',   active   / Math.max(total, 1) * 100);
  setBar('kpiResolvedBar', resolved / Math.max(total, 1) * 100);
  setBar('kpiRateBar',     rate);
}

function animateKPI(id, target, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  const dur   = 700;
  const from  = parseFloat(el.dataset.cur || '0') || 0;
  el.dataset.cur = target;
  function step(now) {
    const t    = Math.min((now - start) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * ease) + suffix;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) setTimeout(() => { el.style.width = Math.min(pct, 100) + '%'; }, 80);
}

/* ══════════════════════════════════════════════
   TREND CHART  (overlapping, non-stacked)
══════════════════════════════════════════════ */
function renderTrendChart() {
  const canvas = document.getElementById('trendCanvas');
  if (!canvas) return;

  const parent  = canvas.parentElement;
  const CHART_H = 200;                    // fixed height — no feedback loop
  canvas.width  = parent.offsetWidth || 600;
  canvas.height = CHART_H;

  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = CHART_H;
  const PAD = { top: 14, right: 14, bottom: 26, left: 34 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;
  const inc = getTrendData();

  ctx.clearRect(0, 0, W, H);

  const days    = activeDays;
  const buckets = buildDailyBuckets(inc, days);

  const isSingleType = trendFilter.type !== 'all';
  const types = isSingleType
    ? [trendFilter.type]
    : ['accident', 'sec', 'med', 'fire'];

  // Each type is independent — maxVal is the highest single-type count on any day
  const maxVal = Math.max(
    ...buckets.flatMap(b => types.map(t => b[t] || 0)),
    1
  );

  /* ── Grid lines + Y labels ── */
  const gridCount = 4;
  ctx.strokeStyle = '#2B1A55';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 4]);
  for (let g = 0; g <= gridCount; g++) {
    const y = PAD.top + cH - (g / gridCount) * cH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + cW, y);
    ctx.stroke();
    ctx.fillStyle = '#7A6A9A';
    ctx.font      = '9px IBM Plex Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round((g / gridCount) * maxVal), PAD.left - 5, y + 3);
  }
  ctx.setLineDash([]);

  /* ── X labels ── */
  const labelEvery = days <= 7 ? 1 : days <= 30 ? 5 : days <= 90 ? 14 : 60;
  ctx.fillStyle = '#7A6A9A';
  ctx.font      = '8px IBM Plex Mono, monospace';
  ctx.textAlign = 'center';
  buckets.forEach((b, i) => {
    if (i % labelEvery !== 0) return;
    const x = PAD.left + (i / (buckets.length - 1 || 1)) * cW;
    const d = new Date(b.dateMs);
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, x, H - 5);
  });

  /* ── Draw each type independently (overlapping, not stacked) ── */
  const chartBottom = PAD.top + cH;

  types.forEach(type => {
    // Area fill
    ctx.beginPath();
    buckets.forEach((b, i) => {
      const x = PAD.left + (i / Math.max(buckets.length - 1, 1)) * cW;
      const y = PAD.top + cH - ((b[type] || 0) / maxVal) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    for (let i = buckets.length - 1; i >= 0; i--) {
      const x = PAD.left + (i / Math.max(buckets.length - 1, 1)) * cW;
      ctx.lineTo(x, chartBottom);
    }
    ctx.closePath();
    ctx.fillStyle = hexToRgba(TYPE_COLORS[type], isSingleType ? 0.35 : 0.15);
    ctx.fill();

    // Line
    ctx.beginPath();
    buckets.forEach((b, i) => {
      const x = PAD.left + (i / Math.max(buckets.length - 1, 1)) * cW;
      const y = PAD.top + cH - ((b[type] || 0) / maxVal) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = TYPE_COLORS[type];
    ctx.lineWidth   = isSingleType ? 2 : 1.5;
    ctx.stroke();
  });

  /* ── Current-hour marker ── */
  const curH = new Date().getHours();
  const hx   = PAD.left + (curH / 23) * cW;
  ctx.strokeStyle = 'rgba(245,196,0,0.18)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(hx, PAD.top);
  ctx.lineTo(hx, PAD.top + cH);
  ctx.stroke();
  ctx.setLineDash([]);
}

function buildDailyBuckets(incidents, days) {
  const now = Date.now();
  return Array.from({ length: days }, (_, d) => {
    const dayStart = new Date(now - (days - 1 - d) * 86400000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const b = { dateMs: dayStart.getTime(), fire: 0, med: 0, sec: 0, accident: 0 };
    incidents.forEach(inc => {
      if (inc.timeRaw >= dayStart.getTime() && inc.timeRaw < dayEnd.getTime()) {
        b[inc.type] = (b[inc.type] || 0) + 1;
      }
    });
    return b;
  });
}

function showTrendLoading(show) {
  const el = document.getElementById('trendLoading');
  if (el) el.style.display = show ? 'flex' : 'none';
}

/* ══════════════════════════════════════════════
   DONUT CHART
══════════════════════════════════════════════ */
function renderDonut() {
  const canvas = document.getElementById('donutCanvas');
  if (!canvas) return;

  const inc    = getDonutData();
  const counts = { fire: 0, med: 0, sec: 0, accident: 0 };
  inc.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  document.getElementById('donutTotal').textContent = total;

  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;
  const cx  = W / 2;
  const cy  = H / 2;
  const R   = Math.min(W, H) / 2 - 8;
  const r   = R * 0.58;

  ctx.clearRect(0, 0, W, H);

  if (!total) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#2B1A55';
    ctx.lineWidth   = R - r;
    ctx.stroke();
    return;
  }

  let angle = -Math.PI / 2;
  ['fire', 'med', 'sec', 'accident'].forEach(type => {
    const slice = counts[type] / total * Math.PI * 2;
    if (!slice) return;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + slice);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, r, cx, cy, R);
    g.addColorStop(0, hexToRgba(TYPE_COLORS[type], 0.5));
    g.addColorStop(1, hexToRgba(TYPE_COLORS[type], 0.9));
    ctx.fillStyle = g;
    ctx.fill();
    angle += slice;
  });

  // Cutout
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#100824';
  ctx.fill();

  // Thin ring
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = '#2B1A55';
  ctx.lineWidth   = 0.5;
  ctx.stroke();
}

/* ── TYPE LIST ── */
function renderTypeList() {
  const inc    = getDonutData();
  const counts = { fire: 0, med: 0, sec: 0, accident: 0 };
  inc.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const el    = document.getElementById('typeList');
  if (!el) return;

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  el.innerHTML = sorted.map(([type, count]) => `
    <div class="anl-type-row">
      <span class="anl-type-dot" style="background:${TYPE_COLORS[type]}"></span>
      <span class="anl-type-name">${TYPE_LABELS[type]}</span>
      <span class="anl-type-count">${count}</span>
      <span class="anl-type-pct">${total ? Math.round(count / total * 100) : 0}%</span>
    </div>
  `).join('');
}

/* ══════════════════════════════════════════════
   LOCATION LIST
══════════════════════════════════════════════ */
function renderLocationList() {
  const inc    = rangeIncidents;
  const counts = {};
  inc.forEach(i => { const l = i.location || 'unknown'; counts[l] = (counts[l] || 0) + 1; });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max    = sorted[0]?.[1] || 1;
  const el     = document.getElementById('locationList');
  if (!el) return;

  document.getElementById('locationTotal').textContent = `${inc.length} total`;

  if (!sorted.length) {
    el.innerHTML = emptyState('search_off', 'No data', 'No incidents in this range.');
    return;
  }

  el.innerHTML = sorted.map(([loc, count], i) => `
    <div class="anl-loc-row">
      <span class="anl-loc-rank">${i + 1}</span>
      <span class="anl-loc-name">${(LOCATION_LABELS[loc] || loc).replace(/_/g, ' ')}</span>
      <div class="anl-loc-bar-wrap">
        <div class="anl-loc-bar-fill" style="width:0%" data-pct="${Math.round(count / max * 100)}"></div>
      </div>
      <span class="anl-loc-count">${count}</span>
    </div>
  `).join('');

  setTimeout(() => {
    el.querySelectorAll('.anl-loc-bar-fill').forEach(b => { b.style.width = b.dataset.pct + '%'; });
  }, 80);
}

/* ══════════════════════════════════════════════
   STATUS FUNNEL
══════════════════════════════════════════════ */
function renderStatusFunnel() {
  const inc    = rangeIncidents;
  const counts = {};
  inc.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1; });

  const order = ['active', 'resolved'];
  const max   = Math.max(...Object.values(counts), 1);
  const el    = document.getElementById('statusFunnel');
  if (!el) return;

  if (!inc.length) {
    el.innerHTML = emptyState('search_off', 'No data', 'No incidents in this range.');
    return;
  }

  el.innerHTML = order.map(status => {
    const count = counts[status] || 0;
    const pct   = Math.round(count / max * 100);
    const cfg   = STATUS_COLORS[status] || { fill: '#7A6A9A', label: status };
    return `
      <div class="anl-funnel-row">
        <span class="anl-funnel-label">${cfg.label}</span>
        <div class="anl-funnel-bar-wrap">
          <div class="anl-funnel-bar-fill" style="width:0%;background:${cfg.fill}" data-pct="${pct}">
            ${count ? `<span class="anl-funnel-num">${count}</span>` : ''}
          </div>
        </div>
        <span class="anl-funnel-count">${count}</span>
      </div>
    `;
  }).join('');

  setTimeout(() => {
    el.querySelectorAll('.anl-funnel-bar-fill').forEach(b => { b.style.width = b.dataset.pct + '%'; });
  }, 80);
}

/* ══════════════════════════════════════════════
   HOURLY CHART
══════════════════════════════════════════════ */
function renderHourlyChart() {
  const inc    = rangeIncidents;
  const hourly = new Array(24).fill(0);
  inc.forEach(i => { const h = new Date(i.timeRaw).getHours(); hourly[h]++; });
  const max      = Math.max(...hourly, 1);
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const el       = document.getElementById('hourlyChart');
  if (!el) return;

  const W  = el.offsetWidth || 400;
  const H  = el.offsetHeight || 120;
  const bW = Math.floor((W - 4) / 24);

  const parts = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">`];

  hourly.forEach((val, h) => {
    const x      = 2 + h * bW;
    const bh     = val ? Math.max(4, Math.round((val / max) * (H - 4))) : 2;
    const y      = H - bh;
    const isPeak = h === peakHour && val > 0;
    const isHigh = val >= max * 0.7 && val > 0;
    const fill   = isPeak
      ? 'var(--gold)'
      : isHigh
        ? 'rgba(245,196,0,0.45)'
        : val > 0
          ? 'rgba(245,196,0,0.2)'
          : '#2B1A55';
    parts.push(`<rect x="${x}" y="${y}" width="${bW - 2}" height="${bh}" fill="${fill}"/>`);
    if (isPeak)
      parts.push(`<text x="${x + (bW - 2) / 2}" y="${y - 4}" fill="var(--gold)" font-size="7" text-anchor="middle" font-family="IBM Plex Mono,monospace">${val}</text>`);
  });

  const cx = 2 + new Date().getHours() * bW + (bW - 2) / 2;
  parts.push(`<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="rgba(245,196,0,0.25)" stroke-width="1" stroke-dasharray="3,3"/>`);
  parts.push('</svg>');
  el.innerHTML = parts.join('');

  const labelsEl = document.getElementById('hourlyLabels');
  if (labelsEl)
    labelsEl.innerHTML = [0, 6, 12, 18, 23]
      .map(h => `<span>${String(h).padStart(2, '0')}:00</span>`)
      .join('');
}

/* ══════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════ */
function exportReport() {
  const inc      = rangeIncidents;
  const total    = inc.length;
  const counts   = { fire: 0, med: 0, sec: 0, accident: 0 };
  inc.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
  const active   = inc.filter(i => i.status === 'active').length;
  const resolved = inc.filter(i => i.status === 'resolved').length;
  const rate     = total ? Math.round(resolved / total * 100) : 0;

  const rows = [
    ['Report', 'SENTINEL — Analytics'],
    ['Generated', new Date().toISOString()],
    ['Range', `Last ${activeDays} days`],
    [],
    ['Metric', 'Value'],
    ['Total Incidents', total],
    ['Active', active],
    ['Resolved', resolved],
    ['Resolution Rate', `${rate}%`],
    [],
    ['Type', 'Count'],
    ...Object.entries(counts).map(([t, c]) => [TYPE_LABELS[t], c]),
    [],
    ['ID', 'Type', 'Description', 'Location', 'Status', 'Time'],
    ...inc.map(i => [
      i.id,
      TYPE_LABELS[i.type],
      formatCsvField(i.desc),
      formatCsvField(formatLoc(i)),
      i.status,
      new Date(i.timeRaw).toISOString(),
    ]),
  ];

  const csv  = rows.map(row => row.map(formatCsvField).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `sentinel-analytics-${activeDays}d-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  logCsvExport('analytics', {
    count:        total,
    rangeDays:    activeDays,
    trendType:    trendFilter.type,
    trendStatus:  trendFilter.status,
    donutStatus:  donutFilter.status,
  });
}

function getCsrfToken() {
  return document.cookie
    .split('; ')
    .find(c => c.startsWith('csrftoken='))
    ?.split('=')[1];
}

async function logCsvExport(page, details = {}) {
  try {
    await fetch('/api/export-log/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ page, details }),
    });
  } catch (err) {
    console.error('CSV export log failed:', err);
  }
}

function formatCsvField(value) {
  if (value == null) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
function formatLoc(inc) {
  const parts = [];
  if (inc.location)          parts.push((LOCATION_LABELS[inc.location] || inc.location).replace(/_/g, ' '));
  if (inc.specific_location) parts.push(inc.specific_location);
  return parts.join(' — ') || 'Unknown';
}

function emptyState(icon, title, sub) {
  return `<div class="anl-empty">
    <div class="anl-empty-icon"><span class="material-symbols-outlined mi-24" aria-hidden="true">${icon}</span></div>
    <div class="anl-empty-title">${title}</div>
    <div class="anl-empty-sub">${sub}</div>
  </div>`;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// timeAgo defined in scripts.js — globally available

/* ── SIDEBAR ── */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const colBtn  = document.getElementById('sidebarCollapseBtn');
  const mobBtn  = document.getElementById('mobileMenuBtn');
  colBtn?.addEventListener('click', () => sidebar?.classList.toggle('collapsed'));
  mobBtn?.addEventListener('click', () => sidebar?.classList.toggle('mobile-open'));
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 &&
        sidebar?.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) &&
        !mobBtn?.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

/* ── REVEAL ── */
function initReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => { e.target.style.animation = 'fadeUp 0.4s ease forwards'; }, i * 60);
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.05 });
  document.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });
}

/* ── RESIZE ── */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderTrendChart();
    renderHourlyChart();
  }, 200);
});