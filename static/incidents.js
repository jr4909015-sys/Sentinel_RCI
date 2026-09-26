/* ============================================================
   SENTINEL — Incidents Page JS  (incidents.js)
   ============================================================ */

'use strict';

/* ── DATA LOADING ── */
let incidentData = [];

async function loadIncidents() {
  try {
    const response = await fetch('/api/incidents/');
    if (!response.ok) throw new Error('Network response was not ok');
    incidentData = await response.json();
    state.data     = [...incidentData];
    state.filtered = [...incidentData];
    applyFilters(true);
    updateStatStrip();   
    return true;   // ← signals data is ready
  } catch (error) {
    console.error('Error loading incidents:', error);
    incidentData   = [];
    state.data     = [];
    state.filtered = [];
    applyFilters(true);
    updateStatStrip();   
    return false;
  }
}

function updateStatStrip() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const active       = incidentData.filter(i => i.status === 'active').length;
  const resolvedToday = incidentData.filter(i => {
    if (i.status !== 'resolved') return false;
    if (!i.resolvedAtRaw) return false;
    return i.resolvedAtRaw >= todayStart;
  }).length;
  const thisMonth    = incidentData.filter(i => i.timeRaw >= monthStart).length;

  const g = id => document.getElementById(id);
  if (g('statActive'))        g('statActive').textContent       = active;
  if (g('statResolvedToday')) g('statResolvedToday').textContent = resolvedToday;
  if (g('statThisMonth'))     g('statThisMonth').textContent    = thisMonth;

  // Also sync the type-filter counts
  const counts = {
    all:      incidentData.length,
    fire:     incidentData.filter(i => i.type === 'fire').length,
    med:      incidentData.filter(i => i.type === 'med').length,
    sec:      incidentData.filter(i => i.type === 'sec').length,
    accident: incidentData.filter(i => i.type === 'accident').length,
  };
  document.querySelectorAll('.inc-type-btn').forEach(btn => {
    const el = btn.querySelector('.inc-type-count');
    if (el && counts[btn.dataset.type] !== undefined)
      el.textContent = counts[btn.dataset.type];
  });
}

/* ── HELPERS ── */
const typeLabel   = { fire: 'FIRE', med: 'MEDICAL', sec: 'SECURITY', accident: 'ACCIDENT' };
const statusOrder = { active: 0, dispatched: 1, onscene: 2, investigating: 3, resolved: 4 };

function statusLabel(s) {
  return { active:'Active', dispatched:'Dispatched', onscene:'On Scene', investigating:'Investigating', resolved:'Resolved' }[s] || s;
}

// timeAgo is defined in scripts.js — available globally

function formatLocation(inc) {
  const pieces = [];
  if (inc.location)          pieces.push(inc.location);
  if (inc.specific_location) pieces.push(inc.specific_location);
  return pieces.length ? pieces.join(' — ') : 'Unknown';
}

/* ── STATE ── */
let state = {
  data:     [],
  filtered: [],
  page:     1,
  perPage:  15,
  search:   '',
  type:     'all',
  status:   'all',
  sortCol:  'time',
  sortDir:  'desc',
  view:     'table',
};

/* ══════════════════════════════════════════════
   FILTER + SORT
══════════════════════════════════════════════ */
function applyFilters(resetPage = false) {
  let d = [...state.data];

  if (state.search) {
    const q = state.search.toLowerCase();
    d = d.filter(i => {
      const locationText = `${i.location || ''} ${i.specific_location || ''}`.toLowerCase();
      return i.id.toLowerCase().includes(q) ||
             i.desc.toLowerCase().includes(q) ||
             locationText.includes(q);
    });
  }
  if (state.type   !== 'all') d = d.filter(i => i.type   === state.type);
  if (state.status !== 'all') d = d.filter(i => i.status === state.status);

  d.sort((a, b) => {
    let va, vb;
    switch (state.sortCol) {
      case 'id':       va = a.id;               vb = b.id;               break;
      case 'type':     va = a.type;             vb = b.type;             break;
      case 'location': va = formatLocation(a);  vb = formatLocation(b);  break;
      case 'status':   va = statusOrder[a.status]; vb = statusOrder[b.status]; break;
      default:         va = a.timeRaw;          vb = b.timeRaw;          break;
    }
    if (va < vb) return state.sortDir === 'asc' ? -1 :  1;
    if (va > vb) return state.sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  state.filtered = d;
  if (resetPage) state.page = 1;

  const maxPage = Math.max(1, Math.ceil(d.length / state.perPage));
  if (state.page > maxPage) state.page = maxPage;
  if (state.page < 1)       state.page = 1;

  render();
}

/* ══════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════ */
function render() {
  if (state.view === 'table') renderTable();
  else renderCards();
  renderPagination();
}

/* ── TABLE ── */
function renderTable() {
  const tbody = document.getElementById('incidentTableBody');
  if (!tbody) return;

  const start = (state.page - 1) * state.perPage;
  const slice = state.filtered.slice(start, start + state.perPage);

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="inc-empty">
      <div class="inc-empty-icon">&#9673;</div>
      <div class="inc-empty-title">No incidents found</div>
      <div class="inc-empty-sub">Try adjusting your search or filter criteria.</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(inc => `
    <tr class="inc-table-row" data-id="${inc.id}">
      <td><span class="inc-table-id">${inc.id}</span></td>
      <td><span class="mock-badge ${inc.type}">${typeLabel[inc.type]}</span></td>
      <td><span class="inc-table-desc">${inc.desc}</span></td>
      <td><span class="inc-table-location">${formatLocation(inc).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span></td>
      <td><span class="inc-status ${inc.status}">${statusLabel(inc.status)}</span></td>
      <td><span class="inc-table-time">${timeAgo(inc.timeRaw)}</span></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.inc-row-action')) return;
      openDrawer(row.dataset.id);
    });
  });
}

/* ── CARDS ── */
function renderCards() {
  const grid = document.getElementById('incidentCardsGrid');
  if (!grid) return;

  const start = (state.page - 1) * state.perPage;
  const slice = state.filtered.slice(start, start + state.perPage);

  if (!slice.length) {
    grid.innerHTML = `<div class="inc-empty" style="grid-column:1/-1">
      <div class="inc-empty-icon">&#9673;</div>
      <div class="inc-empty-title">No incidents found</div>
      <div class="inc-empty-sub">Try adjusting your search or filter criteria.</div>
    </div>`;
    return;
  }

  grid.innerHTML = slice.map(inc => `
    <div class="inc-card" data-id="${inc.id}">
      <div class="inc-card-top">
        <span class="mock-badge ${inc.type}">${typeLabel[inc.type]}</span>
        <span class="inc-card-id">${inc.id}</span>
        <span class="inc-card-time">${timeAgo(inc.timeRaw)}</span>
      </div>
      <p class="inc-card-desc">${inc.desc}</p>
      <div class="inc-card-meta">
        <span class="inc-card-location">${formatLocation(inc)}</span>
      </div>
      <div class="inc-card-footer">
        <span class="inc-status ${inc.status}">${statusLabel(inc.status)}</span>
        <button class="inc-row-action" data-id="${inc.id}">View \u2192</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.inc-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.inc-row-action')) return;
      openDrawer(card.dataset.id);
    });
  });
  grid.querySelectorAll('.inc-row-action').forEach(btn => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.id));
  });
}

/* ══════════════════════════════════════════════
   PAGINATION
══════════════════════════════════════════════ */
function renderPagination() {
  const total   = state.filtered.length;
  const perPage = state.perPage;
  const pages   = Math.max(1, Math.ceil(total / perPage));

  if (state.page > pages) state.page = pages;
  if (state.page < 1)     state.page = 1;

  const rowStart = total === 0 ? 0 : (state.page - 1) * perPage + 1;
  const rowEnd   = Math.min(state.page * perPage, total);

  const info = document.getElementById('paginationInfo');
  const nums = document.getElementById('pageNumbers');
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');

  if (info) info.textContent = total ? `Showing ${rowStart}\u2013${rowEnd} of ${total}` : 'No results';
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;

  if (!nums) return;

  let lo = Math.max(1, state.page - 2);
  let hi = Math.min(pages, lo + 4);
  if (hi - lo < 4) lo = Math.max(1, hi - 4);

  let html = '';
  if (lo > 1) html += `<button class="inc-page-num" data-page="1">1</button>`;
  if (lo > 2) html += `<span style="color:var(--muted);padding:0 2px;font-size:0.65rem;line-height:28px">\u2026</span>`;
  for (let p = lo; p <= hi; p++) {
    html += `<button class="inc-page-num${p === state.page ? ' active' : ''}" data-page="${p}">${p}</button>`;
  }
  if (hi < pages - 1) html += `<span style="color:var(--muted);padding:0 2px;font-size:0.65rem;line-height:28px">\u2026</span>`;
  if (hi < pages)     html += `<button class="inc-page-num" data-page="${pages}">${pages}</button>`;

  nums.innerHTML = html;
  nums.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:4px;';

  nums.querySelectorAll('button.inc-page-num').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = +btn.dataset.page;
      if (p !== state.page) { state.page = p; render(); }
    });
  });
}

/* ══════════════════════════════════════════════
   DETAIL DRAWER
══════════════════════════════════════════════ */
function openDrawer(id) {
  const inc = incidentData.find(i => i.id === id);
  if (!inc) return;

  document.getElementById('drawerID').textContent               = `#${inc.id}`;
  document.getElementById('drawerBadge').textContent            = typeLabel[inc.type];
  document.getElementById('drawerBadge').className              = `mock-badge ${inc.type}`;
  document.getElementById('drawerStatus').textContent           = statusLabel(inc.status);
  document.getElementById('drawerStatus').className             = `inc-status ${inc.status}`;
  document.getElementById('drawerLocation').textContent         = inc.location
    ? inc.location.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Unknown';
  document.getElementById('drawerSpecificLocation').textContent = inc.specific_location || '—';
  document.getElementById('drawerDesc').textContent             = inc.desc;

  const resolveBtn = document.getElementById('drawerResolve');
  if (resolveBtn) {
    resolveBtn.dataset.uuid  = inc.uuid || inc.id;
    resolveBtn.style.display = inc.status === 'resolved' ? 'none' : '';
    resolveBtn.disabled      = false;
    resolveBtn.textContent   = 'Mark Resolved';
  }

  const activateBtn = document.getElementById('drawerActivate');
  if (activateBtn) {
    activateBtn.dataset.uuid = inc.uuid || inc.id;
    activateBtn.style.display = inc.status === 'active' ? 'none' : '';
    activateBtn.disabled = false;
  }

  const deleteBtn = document.getElementById('drawerDelete');
  if (deleteBtn) {
    deleteBtn.dataset.uuid = inc.uuid || inc.id;
    deleteBtn.style.display = '';
    deleteBtn.disabled = false;
  }

  document.getElementById('incDrawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  document.getElementById('incDrawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════════
   MODAL
══════════════════════════════════════════════ */
function openModal() {
  document.getElementById('newIncidentModal').classList.add('open');
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('newIncidentModal').classList.remove('open');
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitNewIncident() {
  const desc             = document.getElementById('modalDesc')?.value.trim();
  const location         = document.getElementById('modalLocation')?.value;
  const specificLocation = document.getElementById('modalSpecificLocation')?.value.trim();
  const typeEl           = document.querySelector('.inc-type-radio.active');

  if (!desc) {
    const input = document.getElementById('modalDesc');
    input?.focus();
    input?.classList.add('error-flash');
    setTimeout(() => input?.classList.remove('error-flash'), 600);
    return;
  }

  // Get CSRF token - look in multiple places
  let csrfToken = document.querySelector('[name=csrfmiddlewaretoken]')?.value;
  if (!csrfToken) {
    csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value;
  }
  if (!csrfToken) {
    // Try to get it from cookies
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      if (cookie.trim().startsWith('csrftoken=')) {
        csrfToken = cookie.trim().substring('csrftoken='.length);
        break;
      }
    }
  }

  const incType = typeEl?.dataset.value || 'fire';
  
  // Use URLSearchParams instead of FormData for better header compatibility
  const params = new URLSearchParams();
  params.append('inc_type', incType);
  params.append('description', desc);
  params.append('location', location || '');
  params.append('specific_location', specificLocation);
  if (csrfToken) params.append('csrfmiddlewaretoken', csrfToken);

  console.log('[incidents] CSRF Token:', csrfToken ? 'Found' : 'NOT FOUND');
  console.log('[incidents] Submitting incident:', { incType, desc, location, specificLocation });

  try {
    const response = await fetch('/add/incident/', {
      method: 'POST',
      body: params,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      credentials: 'same-origin', // Include cookies
    });

    console.log('[incidents] Response status:', response.status, response.ok);

    if (response.ok) {
      const data = await response.json();
      console.log('[incidents] Form submitted successfully:', data);

      if (data.success && data.incident) {
        showToast('Incident dispatched and logged successfully.', 'success');
        knownIds.add(data.incident.id);   // ← prevent pollIncidents from re-pushing
        pushNotification({
          id:       data.incident.id,
          type:     data.incident.type,
          desc:     data.incident.desc,
          location: data.incident.location,
        });
      } else {
        showToast(data.error || 'Unable to submit incident.', 'error');
      }
          
      // Clear form fields
      document.getElementById('modalDesc').value = '';
      document.getElementById('modalSpecificLocation').value = '';
      document.getElementById('modalLocation').value = 'main_building';
      document.querySelector('.inc-type-radio[data-value="fire"]')?.click();
      
      closeModal();
      
      // Reload incidents from API and sync with notification system
      setTimeout(() => {
        console.log('[incidents] Loading incidents from API');
        loadIncidents();
        // Don't fetch notifications immediately - let polling sync them
        // pollIncidents will be called automatically by the interval
      }, 500);
    } else {
      let errorMessage = 'Unable to submit incident. Please try again.';
      try {
        const json = await response.json();
        if (json && json.error) errorMessage = json.error;
      } catch (err) {
        console.error('Failed to parse error JSON:', err);
      }
      showToast(errorMessage, 'error');
      console.error('[incidents] Form submission failed with status:', response.status);
    }
  } catch (error) {
    console.error('[incidents] Error submitting incident:', error);
    showToast('Network error while submitting incident. Please try again.', 'error');
  }
}

/* ══════════════════════════════════════════════
   SORT HEADERS
══════════════════════════════════════════════ */
function initSortHeaders() {
  document.querySelectorAll('.inc-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'time' ? 'desc' : 'asc';
      }
      document.querySelectorAll('.inc-table th').forEach(h => h.classList.remove('sort-asc','sort-desc'));
      th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      applyFilters(true);
    });
  });
}

/* ══════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════ */
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
        !mobBtn.contains(e.target)) {
      sidebar.classList.remove('mobile-open');
    }
  });
}

/* ══════════════════════════════════════════════
   REVEAL ANIMATION
══════════════════════════════════════════════ */
function initReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.animation = 'fadeUp 0.4s ease forwards';
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.05 });

  document.querySelectorAll('.reveal').forEach(el => {
    el.style.opacity = '0';
    observer.observe(el);
  });
}

/* ══════════════════════════════════════════════
   EXPORT (CSV)
══════════════════════════════════════════════ */
function getCsrfToken() {
  return document.cookie
    .split('; ')
    .find(cookie => cookie.startsWith('csrftoken='))
    ?.split('=')[1];
}

async function logCsvExport(page, details = {}) {
  try {
    const csrfToken = getCsrfToken();
    await fetch('/api/export-log/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ page, details }),
    });
  } catch (err) {
    console.error('CSV export log failed:', err);
  }
}

function csvField(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCSV() {
  const headers = ['ID','Type','Description','Location','Status','Reported'];
  const rows    = state.filtered.map(i => [
    csvField(i.id),
    csvField(typeLabel[i.type]),
    csvField(i.desc),
    csvField(formatLocation(i)),
    csvField(statusLabel(i.status)),
    csvField(i.time),
  ]);
  const csv  = [headers.map(csvField), ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sentinel-incidents.csv'; a.click();
  URL.revokeObjectURL(url);

  logCsvExport('incidents', {
    count: state.filtered.length,
    type: state.type,
    status: state.status,
    sort: state.sortCol,
    view: state.view,
    search: state.search,
  });
}

/* ══════════════════════════════════════════════
   DRAWER ACTIONS
══════════════════════════════════════════════ */
function initDrawerActions() {
  document.getElementById('drawerResolve')?.addEventListener('click', async () => {
    const btn  = document.getElementById('drawerResolve');
    const uuid = btn.dataset.uuid;
    if (!uuid) return;

    btn.disabled    = true;
    btn.textContent = 'Resolving…';

    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(r => r.startsWith('csrftoken='))
        ?.split('=')[1];

      const res  = await fetch(`/api/incidents/${uuid}/resolve/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (data.success) {
        const inc = incidentData.find(i => (i.uuid || i.id) === uuid);
        if (inc) {
          inc.status = 'resolved';
          inc.resolvedAtRaw = data.resolvedAtRaw || Date.now();
          state.data = [...incidentData];
          applyFilters();
          updateStatStrip();
        }
        closeDrawer();
      } else {
        alert('Failed to resolve: ' + (data.error || 'Unknown error'));
        btn.disabled    = false;
        btn.textContent = 'Mark Resolved';
      }
    } catch (err) {
      console.error('Resolve error:', err);
      alert('Network error, please try again.');
      btn.disabled    = false;
      btn.textContent = 'Mark Resolved';
    }
  });

  // Delete button
  document.getElementById('drawerDelete')?.addEventListener('click', () => {
    document.getElementById('confirmDeleteModal').classList.add('open');
    document.getElementById('confirmDeleteOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  // Activate button
  document.getElementById('drawerActivate')?.addEventListener('click', () => {
    document.getElementById('confirmActiveModal').classList.add('open');
    document.getElementById('confirmActiveOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  // Delete confirmation
  document.getElementById('confirmDeleteConfirm')?.addEventListener('click', async () => {
    const uuid = document.getElementById('drawerDelete').dataset.uuid;
    if (!uuid) return;

    const btn = document.getElementById('confirmDeleteConfirm');
    btn.disabled = true;
    btn.textContent = 'Deleting…';

    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(r => r.startsWith('csrftoken='))
        ?.split('=')[1];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const res = await fetch(`/api/incidents/${uuid}/delete/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json();

      if (data.success) {
        // Refresh so the table state is fully consistent after deletion
        window.location.reload();
        return;
      } else {
        alert('Failed to delete: ' + (data.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Delete Incident';
      }
    } catch (err) {
      console.error('Delete error:', err);
      if (err.name === 'AbortError') {
        alert('Delete request timed out. Please try again.');
      } else {
        alert('Network error, please try again.');
      }
      btn.disabled = false;
      btn.textContent = 'Delete Incident';
    }
  });

  // Activate confirmation
  document.getElementById('confirmActiveConfirm')?.addEventListener('click', async () => {
    const uuid = document.getElementById('drawerResolve').dataset.uuid;
    if (!uuid) return;

    const btn = document.getElementById('confirmActiveConfirm');
    btn.disabled = true;
    btn.textContent = 'Activating…';

    try {
      const csrfToken = document.cookie
        .split('; ')
        .find(r => r.startsWith('csrftoken='))
        ?.split('=')[1];

      const res = await fetch(`/api/incidents/${uuid}/activate/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (data.success) {
        const inc = incidentData.find(i => (i.uuid || i.id) === uuid);
        if (inc) {
          inc.status = 'active';
          inc.resolvedAtRaw = null;
          state.data = [...incidentData];
          applyFilters();
          updateStatStrip();
        }
        
        // Close all modals
        document.getElementById('confirmActiveModal').classList.remove('open');
        document.getElementById('confirmActiveOverlay').classList.remove('open');
        closeDrawer();
        document.body.style.overflow = '';
      } else {
        alert('Failed to activate: ' + (data.error || 'Unknown error'));
        btn.disabled = false;
        btn.textContent = 'Mark Active';
      }
    } catch (err) {
      console.error('Activate error:', err);
      alert('Network error, please try again.');
      btn.disabled = false;
      btn.textContent = 'Mark Active';
    }
  });

  // Close confirmation modals
  document.getElementById('confirmDeleteClose')?.addEventListener('click', () => {
    document.getElementById('confirmDeleteModal').classList.remove('open');
    document.getElementById('confirmDeleteOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('confirmDeleteCancel')?.addEventListener('click', () => {
    document.getElementById('confirmDeleteModal').classList.remove('open');
    document.getElementById('confirmDeleteOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('confirmDeleteOverlay')?.addEventListener('click', () => {
    document.getElementById('confirmDeleteModal').classList.remove('open');
    document.getElementById('confirmDeleteOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('confirmActiveClose')?.addEventListener('click', () => {
    document.getElementById('confirmActiveModal').classList.remove('open');
    document.getElementById('confirmActiveOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('confirmActiveCancel')?.addEventListener('click', () => {
    document.getElementById('confirmActiveModal').classList.remove('open');
    document.getElementById('confirmActiveOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });

  document.getElementById('confirmActiveOverlay')?.addEventListener('click', () => {
    document.getElementById('confirmActiveModal').classList.remove('open');
    document.getElementById('confirmActiveOverlay').classList.remove('open');
    document.body.style.overflow = '';
  });
}

/* ══════════════════════════════════════════════
   KEYBOARD
══════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === '/' &&
      document.activeElement.tagName !== 'INPUT' &&
      document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    document.getElementById('incSearch')?.focus();
  }
  if (e.key === 'Escape') { closeDrawer(); closeModal(); }
});

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  initSidebar();
  initReveal();
  initSortHeaders();
  initDrawerActions();

  const perPageEl = document.getElementById('perPage');
  if (perPageEl) state.perPage = +perPageEl.value || 15;

  const numsEl = document.getElementById('pageNumbers');
  if (numsEl) numsEl.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:4px;';

    loadIncidents().then(() => {
    const params  = new URLSearchParams(window.location.search);
    const openId  = params.get('open');
    if (openId) {
        openDrawer(openId);
        // Clean the URL so refreshing doesn't reopen it
        window.history.replaceState({}, '', window.location.pathname);
    }
    });

  document.getElementById('incSearch')?.addEventListener('input', e => {
    state.search = e.target.value;
    applyFilters(true);
  });

  document.getElementById('typeFilters')?.addEventListener('click', e => {
    const btn = e.target.closest('.inc-type-btn');
    if (!btn) return;
    document.querySelectorAll('.inc-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.type = btn.dataset.type;
    applyFilters(true);
  });

  document.getElementById('statusFilter')?.addEventListener('change', e => {
    state.status = e.target.value;
    applyFilters(true);
  });

  document.getElementById('perPage')?.addEventListener('change', e => {
    state.perPage = +e.target.value || 15;
    state.page    = 1;
    render();
  });

  document.getElementById('prevPage')?.addEventListener('click', () => {
    if (state.page > 1) { state.page--; render(); }
  });
  document.getElementById('nextPage')?.addEventListener('click', () => {
    const pages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
    if (state.page < pages) { state.page++; render(); }
  });

  document.getElementById('viewTable')?.addEventListener('click', () => {
    state.view = 'table';
    document.getElementById('tableView').style.display = '';
    document.getElementById('cardsView').style.display = 'none';
    document.getElementById('viewTable').classList.add('active');
    document.getElementById('viewCards').classList.remove('active');
    render();
  });
  document.getElementById('viewCards')?.addEventListener('click', () => {
    state.view = 'cards';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('cardsView').style.display = '';
    document.getElementById('viewCards').classList.add('active');
    document.getElementById('viewTable').classList.remove('active');
    render();
  });

  document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
  document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);

  document.getElementById('newIncidentBtn')?.addEventListener('click', openModal);
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('modalCancel')?.addEventListener('click', closeModal);
  document.getElementById('modalOverlay')?.addEventListener('click', closeModal);
  document.getElementById('modalSubmit')?.addEventListener('click', submitNewIncident);

  document.querySelectorAll('.inc-type-radio').forEach(label => {
    label.addEventListener('click', () => {
      document.querySelectorAll('.inc-type-radio').forEach(l => l.classList.remove('active'));
      label.classList.add('active');
    });
  });

  document.getElementById('exportBtn')?.addEventListener('click', exportCSV);

  document.getElementById('globalSearchBtn')?.addEventListener('click', () => {
    document.getElementById('incSearch')?.focus();
  });

});