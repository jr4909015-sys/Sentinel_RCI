/* ============================================================
   SENTINEL — Users Page  (users.js)
   ============================================================ */

'use strict';

/* ── Helpers ── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function getCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

function initials(first, last) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function toast(msg, type = 'success') {
  if (typeof showToast === 'function') {
    return showToast(msg, type === 'danger' ? 'error' : type);
  }

  let el = document.querySelector('.sentinel-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'sentinel-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.dataset.type = type;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ── State ── */
let allUsers     = [];
let filtered     = [];
let currentPage  = 1;
let perPage      = 15;
let sortCol      = 'name';
let sortDir      = 'asc';
let roleFilter   = 'all';
let statusFilter = 'all';
let searchQ      = '';
let activeDrawerUserId = null;   // kept as string (UUID)

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => {
  fetchUsers();
  bindToolbar();
  bindDrawer();
  bindAddModal();
  bindEditModal();
  bindDeleteModal();
  bindKeyboard();
  bindReveal();

  // Global search button
  document.getElementById('globalSearchBtn')?.addEventListener('click', () => {
    $('usrSearch').focus();
  });
});

/* ══════════════════════════════════════════
   DATA
══════════════════════════════════════════ */

async function fetchUsers() {
  try {
    const res = await fetch('/api/users/', {
      headers: { 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' }
    });
    if (!res.ok) throw new Error(res.statusText);
    allUsers = await res.json();
  } catch (e) {
    allUsers = window.__SENTINEL_USERS__ || [];
  }
  applyFilters();
  updateStatStrip();
}

/* ══════════════════════════════════════════
   FILTER / SORT / PAGINATE
══════════════════════════════════════════ */

function applyFilters() {
  const q = searchQ.toLowerCase();

  filtered = allUsers.filter(u => {
    const fullName = `${u.first_name} ${u.last_name}`.toLowerCase();
    const matchSearch = !q
      || fullName.includes(q)
      || (u.email    || '').toLowerCase().includes(q)
      || (u.username || '').toLowerCase().includes(q);
    const matchRole   = roleFilter   === 'all' || u.role   === roleFilter;
    const matchStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  applySorting();
  currentPage = 1;
  renderTable();
  renderPagination();
}

function applySorting() {
  const dir = sortDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let av, bv;
    switch (sortCol) {
      case 'name':
        av = `${a.first_name} ${a.last_name}`.toLowerCase();
        bv = `${b.first_name} ${b.last_name}`.toLowerCase();
        break;
      case 'email':
        av = (a.email || '').toLowerCase();
        bv = (b.email || '').toLowerCase();
        break;
      case 'role':   av = a.role   || ''; bv = b.role   || ''; break;
      case 'status': av = a.status || ''; bv = b.status || ''; break;
      case 'joined': av = a.date_joined || ''; bv = b.date_joined || ''; break;
      default: return 0;
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });
}

/* ══════════════════════════════════════════
   RENDER TABLE
══════════════════════════════════════════ */

function renderTable() {
  const tbody = $('userTableBody');
  const start = (currentPage - 1) * perPage;
  const slice = filtered.slice(start, start + perPage);

  if (!slice.length) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="usr-empty">
          <div class="usr-empty-icon"><span class="material-symbols-outlined mi-24" aria-hidden="true">group</span></div>
          <div class="usr-empty-title">No users found</div>
          <div class="usr-empty-sub">Try adjusting your search or filters.</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(u => {
    const name   = `${u.first_name} ${u.last_name}`.trim() || u.username;
    const role   = u.role   || 'reporter';
    const status = u.status || 'active';
    const inits  = initials(u.first_name, u.last_name);
    // Escape the UUID for use in inline onclick — it's a plain hex-and-dashes
    // string so no XSS risk, but we still go through data attributes below.
    return `
    <tr data-id="${escHtml(String(u.id))}">
      <td>
        <div class="usr-cell-user">
          <div class="usr-avatar ${role}">${inits}</div>
          <div>
            <span class="usr-name">${escHtml(name)}</span>
            <span class="usr-username">@${escHtml(u.username || '')}</span>
          </div>
        </div>
      </td>
      <td class="usr-email-cell">${escHtml(u.email || '—')}</td>
      <td>
        <span class="usr-role-badge ${role}">
          <span class="usr-role-badge-dot"></span>
          ${role}
        </span>
      </td>
      <td><span class="usr-status ${status}">${status}</span></td>
      <td class="usr-joined-cell">${fmtDate(u.date_joined)}</td>
      <td>
        <div class="usr-row-actions" onclick="event.stopPropagation()">
          <button class="usr-action-btn"        title="Edit"   data-action="edit"   data-id="${escHtml(String(u.id))}" aria-label="Edit user">
            <span class="material-symbols-outlined mi-16" aria-hidden="true">edit</span>
          </button>
          <button class="usr-action-btn danger" title="Delete" data-action="delete" data-id="${escHtml(String(u.id))}" aria-label="Delete user">
            <span class="material-symbols-outlined mi-16" aria-hidden="true">delete</span>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Row click → drawer  (UUID stored in data-id)
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openDrawer(row.dataset.id));
  });

  // Action buttons — use event delegation on tbody so they work after re-render
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.action === 'edit')   openEditModal(id);
      if (btn.dataset.action === 'delete') openDeleteModal(id);
    });
  });

  // Sort indicators
  $$('.usr-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol)
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

/* ══════════════════════════════════════════
   PAGINATION
══════════════════════════════════════════ */

function renderPagination() {
  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start      = Math.min((currentPage - 1) * perPage + 1, total);
  const end        = Math.min(currentPage * perPage, total);

  $('paginationInfo').textContent = total ? `${start}–${end} of ${total} users` : '0 users';

  $('prevPage').disabled = currentPage <= 1;
  $('nextPage').disabled = currentPage >= totalPages;

  const numWrap = $('pageNumbers');
  numWrap.innerHTML = '';

  paginationRange(currentPage, totalPages).forEach(p => {
    if (p === '…') {
      const span = document.createElement('span');
      span.textContent = '…';
      span.style.cssText = 'color:var(--muted);font-size:0.65rem;padding:0 4px;';
      numWrap.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = 'usr-page-num' + (p === currentPage ? ' active' : '');
      btn.textContent = p;
      btn.addEventListener('click', () => { currentPage = p; renderTable(); renderPagination(); });
      numWrap.appendChild(btn);
    }
  });
}

function paginationRange(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  if (cur <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('…', total);
  } else if (cur >= total - 3) {
    pages.push(1, '…');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1, '…', cur - 1, cur, cur + 1, '…', total);
  }
  return pages;
}

/* ══════════════════════════════════════════
   TOOLBAR BINDINGS
══════════════════════════════════════════ */

function bindToolbar() {
  const searchEl = $('usrSearch');
  let searchDebounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { searchQ = searchEl.value.trim(); applyFilters(); }, 200);
  });

  $('roleFilters').addEventListener('click', e => {
    const btn = e.target.closest('[data-role]');
    if (!btn) return;
    $$('#roleFilters .usr-role-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    roleFilter = btn.dataset.role;
    applyFilters();
  });

  $('statusFilter').addEventListener('change', e => { statusFilter = e.target.value; applyFilters(); });

  $('usrPerPage').addEventListener('change', e => {
    perPage = parseInt(e.target.value);
    currentPage = 1;
    renderTable();
    renderPagination();
  });

  $('prevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderTable(); renderPagination(); }
  });
  $('nextPage').addEventListener('click', () => {
    if (currentPage < Math.ceil(filtered.length / perPage)) { currentPage++; renderTable(); renderPagination(); }
  });

  $$('.usr-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      sortDir = sortCol === th.dataset.col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
      sortCol = th.dataset.col;
      applySorting();
      renderTable();
    });
  });

  $('usrExportBtn').addEventListener('click', exportCsv);
  $('addUserBtn').addEventListener('click', openAddModal);
}

/* ══════════════════════════════════════════
   DRAWER  (IDs are strings / UUIDs)
══════════════════════════════════════════ */

function openDrawer(userId) {
  // userId is a string UUID
  const u = allUsers.find(x => String(x.id) === String(userId));
  if (!u) return;
  activeDrawerUserId = String(u.id);

  const role   = u.role   || 'reporter';
  const status = u.status || 'active';
  const name   = `${u.first_name} ${u.last_name}`.trim() || u.username;

  $('drawerAvatar').textContent = initials(u.first_name, u.last_name);
  $('drawerAvatar').className   = `usr-drawer-avatar ${role}`;
  $('drawerName').textContent   = name;
  $('drawerEmail').textContent  = u.email || '—';

  $('drawerRole').innerHTML   = `<span class="usr-role-badge ${role}"><span class="usr-role-badge-dot"></span>${role}</span>`;
  $('drawerStatus').innerHTML = `<span class="usr-status ${status}">${status}</span>`;
  $('drawerJoined').textContent    = fmtDate(u.date_joined);
  $('drawerLastLogin').textContent = u.last_login ? fmtDate(u.last_login) : 'Never';
  $('drawerIncidents').textContent = u.incident_count ?? '—';

  $('drawerOverlay').classList.add('open');
  $('userDrawer').classList.add('open');
}

function closeDrawer() {
  $('drawerOverlay').classList.remove('open');
  $('userDrawer').classList.remove('open');
  activeDrawerUserId = null;
}


function bindDrawer() {
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerOverlay').addEventListener('click', closeDrawer);

  $('drawerEdit').addEventListener('click', () => {
    const id = activeDrawerUserId;
    closeDrawer();
    if (id) openEditModal(id);
  });

  $('drawerDelete').addEventListener('click', () => {
    const id = activeDrawerUserId;
    closeDrawer();
    if (id) openDeleteModal(id);
  });
}

/* ══════════════════════════════════════════
   ADD MODAL
══════════════════════════════════════════ */

function openAddModal() {
  ['addFirstName','addLastName','addEmail','addUsername','addPassword','addPasswordConfirm']
    .forEach(id => $(id).value = '');
  $('addRole').value      = 'reporter';
  hideAlert('addAlert');
  openModal('addModalOverlay', 'addUserModal');
}

function bindAddModal() {
  $('addModalClose').addEventListener('click',   () => closeModal('addModalOverlay', 'addUserModal'));
  $('addModalCancel').addEventListener('click',  () => closeModal('addModalOverlay', 'addUserModal'));
  $('addModalOverlay').addEventListener('click', () => closeModal('addModalOverlay', 'addUserModal'));
  $('addUserModal').addEventListener('click', e => e.stopPropagation());

  $('addModalSubmit').addEventListener('click', async () => {
    const first    = $('addFirstName').value.trim();
    const last     = $('addLastName').value.trim();
    const email    = $('addEmail').value.trim();
    const username = $('addUsername').value.trim();
    const role     = $('addRole').value;
    const pw       = $('addPassword').value;
    const pwc      = $('addPasswordConfirm').value;

    if (!first || !last || !email || !username || !pw)
      return showAlert('addAlert', 'All fields are required.');
    if (!/^[a-zA-Z][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}$/.test(email))
        return showAlert('addAlert', 'Please enter a valid email address.');
    if (pw !== pwc)
      return showAlert('addAlert', 'Passwords do not match.');
    if (pw.length < 8)
      return showAlert('addAlert', 'Password must be at least 8 characters.');

    setLoading('addModalSubmit', true);
    try {
      const res = await fetch('/api/users/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ first_name: first, last_name: last, email, username, role, password: pw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || 'Failed to create user.');
      allUsers.unshift(data);
      updateStatStrip();
      applyFilters();
      closeModal('addModalOverlay', 'addUserModal');
      toast(`User ${first} ${last} created.`);
    } catch (err) {
      showAlert('addAlert', err.message);
    } finally {
      setLoading('addModalSubmit', false);
    }
  });
}

/* ══════════════════════════════════════════
   EDIT MODAL  (userId is a string UUID)
══════════════════════════════════════════ */

function openEditModal(userId) {
  const u = allUsers.find(x => String(x.id) === String(userId));
  if (!u) return;

  $('editUserId').value    = String(u.id);   // store UUID as string
  $('editFirstName').value = u.first_name || '';
  $('editLastName').value  = u.last_name  || '';
  $('editEmail').value     = u.email      || '';
  $('editUsername').value  = u.username   || '';
  $('editRole').value      = u.role       || 'reporter';
  $('editStatus').value    = u.status     || 'active';
  $('editPassword').value  = '';
  hideAlert('editAlert');
  openModal('editModalOverlay', 'editUserModal');
}

function bindEditModal() {
  $('editModalClose').addEventListener('click',   () => closeModal('editModalOverlay', 'editUserModal'));
  $('editModalCancel').addEventListener('click',  () => closeModal('editModalOverlay', 'editUserModal'));
  $('editModalOverlay').addEventListener('click', () => closeModal('editModalOverlay', 'editUserModal'));
  $('editUserModal').addEventListener('click', e => e.stopPropagation());

  $('editModalSubmit').addEventListener('click', async () => {
    const id       = $('editUserId').value;   // UUID string — no parseInt
    const first    = $('editFirstName').value.trim();
    const last     = $('editLastName').value.trim();
    const email    = $('editEmail').value.trim();
    const username = $('editUsername').value.trim();
    const role     = $('editRole').value;
    const status   = $('editStatus').value;
    const pw       = $('editPassword').value;

    if (!first || !last || !email || !username)
      return showAlert('editAlert', 'Name, email, and username are required.');
    if (!/^[a-zA-Z][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}$/.test(email))
      return showAlert('editAlert', 'Please enter a valid email address.');
    if (pw && pw.length < 8)
      return showAlert('editAlert', 'New password must be at least 8 characters.');

    const payload = { first_name: first, last_name: last, email, username, role, status};
    if (pw) payload.password = pw;

    setLoading('editModalSubmit', true);
    try {
      const res = await fetch(`/api/users/${id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || 'Failed to update user.');
      const idx = allUsers.findIndex(x => String(x.id) === String(id));
      if (idx !== -1) allUsers[idx] = data;
      updateStatStrip();
      applyFilters();
      closeModal('editModalOverlay', 'editUserModal');
      toast(`User ${first} ${last} updated.`);
    } catch (err) {
      showAlert('editAlert', err.message);
    } finally {
      setLoading('editModalSubmit', false);
    }
  });
}

/* ══════════════════════════════════════════
   DELETE MODAL  (userId is a string UUID)
══════════════════════════════════════════ */

function openDeleteModal(userId) {
  const u = allUsers.find(x => String(x.id) === String(userId));
  if (!u) return;
  $('deleteUserId').value = String(u.id);    // UUID string — no parseInt
  $('deleteUserName').textContent = `${u.first_name} ${u.last_name}`.trim() || u.username;
  openModal('deleteModalOverlay', 'deleteUserModal');
}

function bindDeleteModal() {
  $('deleteModalClose').addEventListener('click',   () => closeModal('deleteModalOverlay', 'deleteUserModal'));
  $('deleteModalCancel').addEventListener('click',  () => closeModal('deleteModalOverlay', 'deleteUserModal'));
  $('deleteModalOverlay').addEventListener('click', () => closeModal('deleteModalOverlay', 'deleteUserModal'));
  $('deleteUserModal').addEventListener('click', e => e.stopPropagation());

  $('deleteModalConfirm').addEventListener('click', async () => {
    const id = $('deleteUserId').value;       // UUID string — no parseInt
    setLoading('deleteModalConfirm', true);
    try {
      const res = await fetch(`/api/users/${id}/`, {
        method: 'DELETE',
        headers: { 'X-CSRFToken': getCsrf(), 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || d.detail || 'Failed to delete user.');
      }
      allUsers = allUsers.filter(x => String(x.id) !== String(id));
      updateStatStrip();
      applyFilters();
      closeModal('deleteModalOverlay', 'deleteUserModal');
      toast('User deleted.', 'danger');
    } catch (err) {
      toast(err.message, 'danger');
    } finally {
      setLoading('deleteModalConfirm', false);
    }
  });
}

/* ══════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════ */

function openModal(overlayId, modalId) {
  $(overlayId).classList.add('open');
  $(modalId).classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(overlayId, modalId) {
  $(overlayId).classList.remove('open');
  $(modalId).classList.remove('open');
  document.body.style.overflow = '';
}

function showAlert(alertId, msg) {
  const el = $(alertId);
  el.textContent = msg;
  el.style.display = 'block';
}

function hideAlert(alertId) { $(alertId).style.display = 'none'; }

function setLoading(btnId, loading) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner"></span> Processing…`;
  } else {
    btn.innerHTML = btn.dataset.origHtml || btn.innerHTML;
  }
}

/* ══════════════════════════════════════════
   STAT STRIP UPDATE
══════════════════════════════════════════ */

function updateStatStrip() {
  animateCount('statTotal',     allUsers.length);
  animateCount('statAdmins',    allUsers.filter(u => u.role   === 'admin').length);
  animateCount('statReporters', allUsers.filter(u => u.role   === 'reporter').length);
  animateCount('statActive',    allUsers.filter(u => u.status === 'active').length);
}

function animateCount(elId, target) {
  const el = $(elId);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const dur = 500, begin = performance.now();
  const step = now => {
    const p = Math.min((now - begin) / dur, 1);
    el.textContent = Math.round(start + (target - start) * ease(p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

/* ══════════════════════════════════════════
   EXPORT
══════════════════════════════════════════ */

function exportCsv() {
  const rows = [['ID','First Name','Last Name','Email','Username','Role','Status','Date Joined']];
  filtered.forEach(u => rows.push([
    u.id, u.first_name||'', u.last_name||'', u.email||'', u.username||'',
    u.role||'', u.status||'',
    u.date_joined ? new Date(u.date_joined).toISOString().slice(0,10) : ''
  ]));
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `sentinel_users_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Export downloaded.');
}

/* ══════════════════════════════════════════
   KEYBOARD SHORTCUTS
══════════════════════════════════════════ */

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); $('usrSearch').focus();
    }
    if (e.key === 'Escape') {
      for (const [ov, md] of [
        ['deleteModalOverlay','deleteUserModal'],
        ['editModalOverlay','editUserModal'],
        ['addModalOverlay','addUserModal'],
      ]) {
        if ($(ov).classList.contains('open')) { closeModal(ov, md); return; }
      }
      if ($('userDrawer').classList.contains('open')) closeDrawer();
    }
  });
}

/* ══════════════════════════════════════════
   REVEAL ANIMATION
══════════════════════════════════════════ */

function bindReveal() {
  const items = $$('.reveal');
  if (!items.length) return;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('revealed'), i * 60);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });
    items.forEach(el => io.observe(el));
  } else {
    items.forEach(el => el.classList.add('revealed'));
  }
}

/* ══════════════════════════════════════════
   MISC
══════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* Expose for any legacy callers */
window.openEditModal   = openEditModal;
window.openDeleteModal = openDeleteModal;
window.toggleFieldPassword = function(inputId, btn) {
  const inp = $(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.style.opacity = show ? '1' : '0.5';
};