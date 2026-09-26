/* ============================================================
   SENTINEL — Global Scripts
   Covers: landing (home.html), login.html, dashboard.html
   ============================================================ */


/* ============================================================
   LANDING — Scroll Reveal
   ============================================================ */
(function initScrollReveal() {
  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length) return;

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry, i) {
      if (entry.isIntersecting) {
        setTimeout(function() {
          entry.target.classList.add('visible');
        }, 80 * (i % 4));
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  reveals.forEach(function(el) { observer.observe(el); });
})();


/* ============================================================
   LANDING — Animated Count-Up
   ============================================================ */
(function initCountUp() {
  var allStats = document.querySelectorAll('.mock-stat-n');
  var mockStats = Array.prototype.filter.call(allStats, function(el) {
    return !el.closest('.kpi-num') && !el.closest('.kpi-card');
  });
  if (!mockStats.length) return;

  function animateCount(el, target) {
    var start = null;
    var duration = 1200;
    function step(timestamp) {
      if (!start) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      el.textContent = Math.floor(progress * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var target = parseInt(entry.target.textContent, 10);
        if (!isNaN(target)) animateCount(entry.target, target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  mockStats.forEach(function(el) { observer.observe(el); });
})();


/* ============================================================
   LOGIN — Password Visibility Toggle
   ============================================================ */
var passwordVisible = false;

function togglePassword(btn) {
  var input = null;

  // Kung may pinasa na button (onclick="togglePassword(this)"), hanapin
  // yung input sa parehong .input-wrap — pinaka-reliable, kahit magbago ang ID.
  if (btn && btn.closest) {
    var wrap = btn.closest('.input-wrap');
    if (wrap) input = wrap.querySelector('input');
  }

  // Fallback: hanapin via ID / generic selector (old behavior).
  if (!input) {
    input = document.getElementById('password') ||
            document.getElementById('id_password') ||
            document.querySelector('.input-wrap input[type="password"], .input-wrap input[type="text"]');
  }
  if (!input) return;

  passwordVisible = input.type !== 'text';
  // I-sync ang global flag sa aktwal na state (sakaling naiba sa labas).
  input.type = passwordVisible ? 'text' : 'password';
  // Kapag text na, visible=true; kapag password, visible=false.
  passwordVisible = input.type === 'text';

  // Material Symbols eye button (login.html); legacy SVG fallback below.
  // Gamitin ang icon sa loob ng pinindot na button kung meron.
  var mi = null;
  if (btn && btn.querySelector) {
    mi = btn.querySelector('.material-symbols-outlined');
  }
  if (!mi) {
    mi = document.querySelector('.eye-btn .material-symbols-outlined');
  }
  if (mi) {
    mi.textContent = passwordVisible ? 'visibility_off' : 'visibility';
    return;
  }
  var icon = document.getElementById('eye-icon');
  if (!icon) return;

  if (passwordVisible) {
    icon.innerHTML =
      '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
      '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>' +
      '<line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    icon.innerHTML =
      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>' +
      '<circle cx="12" cy="12" r="3"/>';
  }
}


/* ============================================================
   LOGIN — Form Alert Helpers
   ============================================================ */
function showAlert(msg) {
  var alert = document.getElementById('form-alert');
  var text  = document.getElementById('alert-text');
  if (!alert || !text) return;
  text.textContent = msg;
  alert.classList.add('show');
}

function hideAlert() {
  var alert = document.getElementById('form-alert');
  if (alert) alert.classList.remove('show');
}

function showToast(message, type) {
  var container = document.getElementById('toastContainer');
  if (!container) return;

  var icons = {
    success: '<span class="material-symbols-outlined mi-18" aria-hidden="true">check_circle</span>',
    error:   '<span class="material-symbols-outlined mi-18" aria-hidden="true">cancel</span>',
    warning: '<span class="material-symbols-outlined mi-18" aria-hidden="true">warning</span>',
    info:    '<span class="material-symbols-outlined mi-18" aria-hidden="true">info</span>'
  };

  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML =
    '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
    '<span class="toast-message"></span>';

  toast.querySelector('.toast-message').textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(function() {
    toast.classList.add('show');
  });

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}

function initGlobalToasts() {
  var messages = document.querySelectorAll('[data-django-message]');
  if (!messages.length) return;

  messages.forEach(function(el) {
    var type = el.dataset.djangoMessage || 'info';
    var text = (el.textContent || '').trim();
    if (text) showToast(text, type);
    el.remove();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGlobalToasts);
} else {
  initGlobalToasts();
}


/* ============================================================
   LOGIN — Submit Handler
   ============================================================ */
function handleSubmit() {
  hideAlert();
  var btn     = document.getElementById('login-btn');
  var btnText = document.getElementById('btn-text');

  // Change label but do NOT disable the button — disabling prevents restore
  // when the server returns errors and the page reloads (bfcache on some browsers).
  if (btnText) btnText.textContent = 'Authenticating...';

  // Safety net: restore after 8 s if the request hangs or navigation stalls
  var restoreTimer = setTimeout(function() {
    if (btn)     btn.disabled = false;
    if (btnText) btnText.textContent = 'Access System';
  }, 8000);

  if (btn) btn.dataset.restoreTimer = String(restoreTimer);
}

/* Restore the button immediately if this page load already has errors
   (server returned a form error → page reloaded → button must be ready). */
(function restoreButtonOnError() {
  document.addEventListener('DOMContentLoaded', function() {
    var alert   = document.getElementById('form-alert');
    var btn     = document.getElementById('login-btn');
    var btnText = document.getElementById('btn-text');

    if (alert && alert.classList.contains('show')) {
      if (btn)     btn.disabled = false;
      if (btnText) btnText.textContent = 'Access System';
      if (btn && btn.dataset.restoreTimer) {
        clearTimeout(parseInt(btn.dataset.restoreTimer, 10));
      }
    }
  });
})();


/* ============================================================
   LOGIN — Input Focus Line Effect
   ============================================================ */
(function initInputLines() {
  document.querySelectorAll('.form-input').forEach(function(input) {
    var line = document.getElementById('line-' + input.id);
    if (!line) return;
    input.addEventListener('focus', function() { line.style.width = '100%'; });
    input.addEventListener('blur',  function() { line.style.width = '0'; });
  });
})();


/* NOTE: login is a single unified username/ID + password form since the
   password-required auth redesign. The old student/admin mode-switch code
   was removed here (it overwrote the unified copy on page load). */

/* ============================================================
   DASHBOARD — Live Clock
   ============================================================ */
(function initClock() {
  var el = document.getElementById('dashClock');
  if (!el) return;

  function tick() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    var s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = h + ':' + m + ':' + s;
  }

  tick();
  setInterval(tick, 1000);
})();


/* ============================================================
   DASHBOARD — Sidebar Collapse / Mobile Drawer
   ============================================================ */
(function initSidebar() {
  var sidebar     = document.getElementById('sidebar');
  var collapseBtn = document.getElementById('sidebarCollapseBtn');
  var mobileBtn   = document.getElementById('mobileMenuBtn');
  if (!sidebar) return;

  if (collapseBtn) {
    collapseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      sidebar.classList.toggle('collapsed');
    });
  }

  if (mobileBtn) {
    mobileBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      sidebar.classList.toggle('mobile-open');
    });

    document.addEventListener('click', function(e) {
      if (
        sidebar.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) &&
        !mobileBtn.contains(e.target)
      ) {
        sidebar.classList.remove('mobile-open');
      }
    });
  }
})();


/* ============================================================
   DASHBOARD — Incident Filter Tabs
   ============================================================ */
(function initIncidentFilters() {
  var filterBtns    = document.querySelectorAll('.inc-filter-btn');
  var incidentItems = document.querySelectorAll('.incident-item');
  if (!filterBtns.length) return;

  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var type = btn.dataset.type;
      filterBtns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      incidentItems.forEach(function(item) {
        if (type === 'all' || item.dataset.type === type) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });
})();


/* ============================================================
   DASHBOARD — Dynamic Map Markers
   ============================================================ */
(function initDashboardMapMarkers() {
  var dataEl = document.getElementById('dashboard-active-incidents');
  if (!dataEl) return;

  var incidents = [];
  try {
    incidents = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  var mapLayer = document.getElementById('dashboardMarkerLayer');
  if (!mapLayer) return;

  var locationMap = {
    'new building': { left: '70%', top: '19%' },
    'event center': { left: '55%', top: '30%' },
    'main building': { left: '28%', top: '54%' },
    'gate': { left: '52%', top: '94%' },
    'flagpole': { left: '43%', top: '69%' },
    'basketball': { left: '22%', top: '31%' },
    'shs building': { left: '21%', top: '18%' },
    'garden': { left: '10%', top: '22%' },
    'canteen': { left: '14%', top: '37%' },
    'parking': { left: '34%', top: '45%' },
    'ched': { left: '58%', top: '58%' },
    'hospital': { left: '62%', top: '22%' },
    'residential': { left: '33%', top: '52%' },
  };

  function normalizeLocation(location) {
    return (location || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  }

  function resolvePoint(location) {
    var key = normalizeLocation(location);
    for (var label in locationMap) {
      if (key.indexOf(label) !== -1) {
        return locationMap[label];
      }
    }
    return { left: '50%', top: '72%' };
  }

  function severityOrder(category) {
    var order = { fire: 1, accident: 2, med: 3, sec: 4 };
    return order[category] || 10;
  }

  function createMarker(marker) {
    var el = document.createElement('div');
    el.className = 'map-marker ' + marker.category;
    el.style.left = marker.left;
    el.style.top = marker.top;
    el.setAttribute('data-count', marker.count);

    var badge = document.createElement('span');
    badge.className = 'marker-badge';
    badge.textContent = marker.count > 1 ? marker.count : '';
    if (marker.count === 1) {
      badge.style.display = 'none';
    }

    var tooltip = document.createElement('span');
    tooltip.className = 'map-marker-tooltip';
    var locationText = marker.location_display || marker.location || 'Unknown location';
    tooltip.textContent = marker.count > 1
      ? marker.count + ' incidents at ' + locationText
      : locationText;

    el.appendChild(badge);
    el.appendChild(tooltip);
    mapLayer.appendChild(el);
  }

  var grouped = {};
  incidents.forEach(function(inc) {
    var locationLabel = (inc.location_display || inc.location || inc.specific_location || 'Unknown location').trim();
    var point = resolvePoint(locationLabel);
    var key = point.left + '|' + point.top;

    if (!grouped[key]) {
      grouped[key] = {
        left: point.left,
        top: point.top,
        count: 0,
        category: inc.category,
        location: locationLabel,
        location_display: locationLabel || 'Unknown location',
      };
    }

    grouped[key].count += 1;
    if (severityOrder(inc.category) < severityOrder(grouped[key].category)) {
      grouped[key].category = inc.category;
    }
  });

  Object.keys(grouped).forEach(function(key) {
    createMarker(grouped[key]);
  });
})();


/* ============================================================
   DASHBOARD — KPI Count-Up
   ============================================================ */
(function initKpiCountUp() {
  var nums = document.querySelectorAll('.kpi-card .mock-stat-n[data-target]');
  if (!nums.length) return;

  function animateCount(el, target) {
    var start    = null;
    var duration = 1000;
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(ease * target);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = target;
    }
    requestAnimationFrame(step);
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var target = parseInt(entry.target.dataset.target, 10);
        if (!isNaN(target)) animateCount(entry.target, target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  nums.forEach(function(el) { observer.observe(el); });
})();


/* ============================================================
   DASHBOARD — Activity Bar Chart (pure SVG)
   ============================================================ */
(function initActivityChart() {
  var container = document.getElementById('activityChart');
  if (!container) return;

  var titleEl = document.getElementById('activityChartTitle');
  var rangeButtons = document.querySelectorAll('.panel-header-actions .panel-btn[data-range]');
  var currentRange = 24;

  function setActiveRange(range) {
    currentRange = range;
    if (titleEl) {
      titleEl.textContent = 'INCIDENT ACTIVITY — ' + (range === 24 ? '24H' : range === 7 ? '7D' : '30D');
    }
    rangeButtons.forEach(function(btn) {
      btn.classList.toggle('active', parseInt(btn.dataset.range, 10) === range);
    });
    loadActivityData(range);
  }

  function loadActivityData(range) {
    fetch('/api/activity-chart/?range=' + range, {
      credentials: 'include',
      redirect: 'follow',
      headers: { 'Accept': 'application/json' }
    })
      .then(function(res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        }
        return res.text().then(function(text) {
          try {
            return JSON.parse(text);
          } catch (err) {
            var message = 'Invalid JSON response';
            console.error(message, text);
            throw new Error(message);
          }
        });
      })
      .then(function(data) { renderActivityChart(data, range); })
      .catch(function(err) {
        console.error('Activity chart fetch error:', err);
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Unable to load activity data</div>';
      });
  }

  function renderActivityChart(data, range) {
    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">No data available</div>';
      return;
    }

    var labels = data.map(function(row) { return row.label || row.hour || ''; });
    var stacks = data.map(function(row) {
      return [row.fire || 0, row.med || 0, row.sec || 0, row.accident || 0];
    });

    var W = container.offsetWidth || 500;
    var H = 180;
    var maxVal = Math.max(1, ...stacks.flat());
    var barW = Math.floor((W - 40) / data.length);
    var gap = 2;
    var colors = ['#FF4444', '#F5C400', '#B394FF', '#FF9500'];
    var parts = ['<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">'];

    // Y-axis grid
    var gridSteps = Math.max(1, Math.min(4, maxVal));
    for (var g = 0; g <= gridSteps; g++) {
      var y = H - 28 - Math.round((g / gridSteps) * (H - 40));
      var value = Math.round((g / gridSteps) * maxVal);
      parts.push('<line x1="30" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="#2B1A55" stroke-width="1"/>');
      parts.push('<text x="24" y="' + (y + 4) + '" fill="#7A6A9A" font-size="8" text-anchor="end" font-family="IBM Plex Mono,monospace">' + value + '</text>');
    }

    // Bars
    for (var i = 0; i < stacks.length; i++) {
      var bx = 30 + i * barW + gap / 2;
      var bw = Math.max(2, barW - gap);
      var stackY = H - 24;
      for (var s = 0; s < stacks[i].length; s++) {
        var val = stacks[i][s];
        if (!val) continue;
        var bh = Math.round((val / maxVal) * (H - 46));
        stackY -= bh;
        parts.push('<rect x="' + bx + '" y="' + stackY + '" width="' + bw + '" height="' + bh + '" fill="' + colors[s] + '" opacity="0.8"/>');
      }
    }

    parts.push('</svg>');
    container.innerHTML = parts.join('');
  }

  rangeButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var range = parseInt(this.dataset.range, 10);
      if (range && range !== currentRange) {
        setActiveRange(range);
      }
    });
  });

  loadActivityData(currentRange);
})();


/* ============================================================
   DASHBOARD — KPI Bar Fill Animation
   ============================================================ */
(function initKpiBars() {
  var bars = document.querySelectorAll('.kpi-bar-fill');
  if (!bars.length) return;
  bars.forEach(function(bar) {
    var w = bar.style.width;
    bar.style.width = '0';
    setTimeout(function() { bar.style.width = w; }, 300);
  });
})();


/* ============================================================
   SHARED — timeAgo helper (used by notifications on all pages)
   ============================================================ */
function timeAgo(ms) {
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ============================================================
   LIVE NOTIFICATIONS
   ============================================================ */
const notifTypeColor = {
  fire: '#FF4444', med: '#F5C400', sec: '#B394FF', accident: '#FF9500'
};

let notifications = [];
let knownIds      = new Set();
let clearedIds    = new Set();
let readIds       = new Set();
let firstPoll     = true;
let notifOpen     = false;

function pushNotification(inc) {
  if (clearedIds.has(inc.id)) return;
  const exists = notifications.find(n =>
    n.id === inc.id || n.incidentId === inc.id
  );
  if (exists) return;
  notifications.unshift({
    id:         inc.id,
    incidentId: inc.incidentId || inc.id,
    title:      `New ${inc.type.toUpperCase()} Incident`,
    sub:        inc.desc || inc.location || 'No description',
    color:      notifTypeColor[inc.type] || '#888',
    time:       Date.now(),
    unread:     !readIds.has(inc.id),
  });
  if (notifications.length > 20) notifications.pop();
  saveNotifState();
  renderNotifications();
  updateNotifDot();
}

/* ── RENDER ── */
function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = '<div class="notif-empty">No new notifications</div>';
    updateClearSelectedBtn();
    return;
  }

  list.innerHTML = notifications.map(n => `
    <div class="notif-item${n.unread ? ' unread' : ''}" data-id="${n.id}">
      <label class="notif-check-wrap" onclick="event.stopPropagation()">
        <input type="checkbox" class="notif-checkbox" data-id="${n.id}">
      </label>
      <a class="notif-item-content" href="/incidents/?open=${n.incidentId || n.id}">
        <div class="notif-item-dot" style="background:${n.color};width:7px;height:7px;border-radius:50%;margin-top:4px;flex-shrink:0;"></div>
        <div class="notif-item-body" style="flex:1;min-width:0;">
          <div class="notif-item-title">${n.title}</div>
          <div class="notif-item-sub">${n.sub}</div>
        </div>
        <div class="notif-item-time">${timeAgo(n.time)}</div>
      </a>
    </div>
  `).join('');

  // Wire checkbox change to update the "Clear selected" button
  list.querySelectorAll('.notif-checkbox').forEach(cb => {
    cb.addEventListener('change', updateClearSelectedBtn);
  });

  updateClearSelectedBtn();
}

function updateClearSelectedBtn() {
  const btn = document.getElementById('notifClearSelected');
  if (!btn) return;
  const checked = document.querySelectorAll('.notif-checkbox:checked');
  btn.style.display = checked.length ? 'block' : 'none';
}

/* ── DOT ── */
function updateNotifDot() {
  const dot = document.getElementById('notifDot');
  if (!dot) return;
  const unreadCount = notifications.filter(n => n.unread).length;

  if (unreadCount === 0) {
    dot.style.display = 'none';
    dot.textContent   = '';
    dot.classList.remove('notif-dot-count');
  } else {
    dot.style.display = 'flex';
    dot.textContent   = unreadCount > 9 ? '9+' : String(unreadCount);
    dot.classList.add('notif-dot-count');
  }
}

/* ── MARK READ — updates dot + styling, keeps items in list ── */
function markAllRead() {
  let hadUnread = false;
  notifications.forEach(n => {
    if (n.unread) hadUnread = true;
    n.unread = false;
    readIds.add(n.id);
  });

  if (hadUnread) {
    saveNotifState();
    renderNotifications();
    updateNotifDot();

    // Persist to DB
    const csrfToken = document.cookie
      .split('; ')
      .find(r => r.startsWith('csrftoken='))
      ?.split('=')[1];

    fetch('/api/notifications/read/', {
      method: 'POST',
      headers: { 'X-CSRFToken': csrfToken },
      credentials: 'same-origin',
    }).catch(e => console.error('Failed to mark read:', e));
  }
}

/* ── CLEAR SELECTED ── */
function clearSelected() {
  const checked = document.querySelectorAll('.notif-checkbox:checked');
  checked.forEach(cb => {
    const id = cb.dataset.id;
    clearedIds.add(id);
    notifications = notifications.filter(n => n.id !== id);
  });
  saveNotifState();
  renderNotifications();
  updateNotifDot();
}

/* ── FETCH FROM DB ── */
async function fetchNotificationsFromDB() {
  try {
    const res = await fetch('/api/notifications/');
    if (!res.ok) return;
    const data = await res.json();

    let changed = false;
    data.forEach(notif => {
      if (clearedIds.has(notif.id) || clearedIds.has(notif.incident_id)) return;
      const exists = notifications.find(n =>
        n.id === notif.id ||
        n.incidentId === notif.incident_id ||
        n.id === notif.incident_id
      );
      if (!exists) {
        notifications.unshift({
          id:         notif.id,
          incidentId: notif.incident_id,
          title:      `New ${notif.type.toUpperCase()} Incident`,
          sub:        notif.desc || notif.location || 'No description',
          color:      notifTypeColor[notif.type] || '#888',
          time:       notif.timeRaw,
          unread:     notif.is_read ? false : !readIds.has(notif.id),
        });
        changed = true;
      }
    });

    if (notifications.length > 20) notifications.splice(20);
    if (changed) saveNotifState();
    renderNotifications();
    updateNotifDot();
  } catch (e) {
    console.error('Error fetching notifications:', e);
  }
}

/* ── POLL ── */
async function pollIncidents() {
  try {
    const res = await fetch('/api/incidents/');
    if (!res.ok) return;
    const data = await res.json();

    if (firstPoll) {
      data.forEach(inc => knownIds.add(inc.id));
      firstPoll = false;
      return;
    }

    const newOnes = data.filter(inc => !knownIds.has(inc.id));
    newOnes.forEach(inc => {
      knownIds.add(inc.id);
      pushNotification(inc);
    });

    if (typeof incidentData !== 'undefined' && newOnes.length) {
      newOnes.forEach(inc => {
        if (!incidentData.find(i => i.id === inc.id)) incidentData.unshift(inc);
      });
      if (typeof state !== 'undefined') {
        state.data = [...incidentData];
        applyFilters();
      }
    }
  } catch (e) {
    console.error('Poll error:', e);
  }
}

/* ── INIT ── */
function initNotifications() {
  loadNotifState();
  const btn      = document.getElementById('notifBtn');
  const dropdown = document.getElementById('notifDropdown');
  const wrap     = document.getElementById('notifWrap');
  const clear    = document.getElementById('notifClear');
  const clearSel = document.getElementById('notifClearSelected');

  if (!btn || !dropdown || !wrap) return;

  // Open/close bell
  btn.addEventListener('click', e => {
    e.stopPropagation();
    notifOpen = !notifOpen;
    dropdown.classList.toggle('open', notifOpen);
    if (notifOpen) markAllRead();
  });

  // Clear all
  clear?.addEventListener('click', () => {
    notifications.forEach(n => clearedIds.add(n.id));
    notifications = [];
    saveNotifState();
    renderNotifications();
    updateNotifDot();
  });

  // Clear selected
  clearSel?.addEventListener('click', clearSelected);

  // Close on outside click
  document.addEventListener('click', e => {
    if (notifOpen && !wrap.contains(e.target)) {
      notifOpen = false;
      dropdown.classList.remove('open');
    }
  });

  fetchNotificationsFromDB();
  pollIncidents();
  setInterval(pollIncidents, 10000);
  setInterval(fetchNotificationsFromDB, 30000);
  setInterval(renderNotifications, 60000);
}

/* ── PERSISTENCE ── */
function saveNotifState() {
  try {
    sessionStorage.setItem('notif_cleared', JSON.stringify([...clearedIds]));
    sessionStorage.setItem('notif_read',    JSON.stringify([...readIds]));
    sessionStorage.setItem('notif_list',    JSON.stringify(notifications));
  } catch(e) {}
}

function loadNotifState() {
  try {
    const cleared = sessionStorage.getItem('notif_cleared');
    const read    = sessionStorage.getItem('notif_read');
    const list    = sessionStorage.getItem('notif_list');
    if (cleared) clearedIds    = new Set(JSON.parse(cleared));
    if (read)    readIds       = new Set(JSON.parse(read));
    if (list)    notifications = JSON.parse(list);
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  initNotifications();
});