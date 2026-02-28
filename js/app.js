import { state } from './state.js';
import { $ } from './utils.js';
import { wireAuthUI, getSession, getUserById, clearSession } from './auth.js';

import { loadCustomers, initCustomersPage, getTodayCustomers } from './customers.js';
import { loadDrivers, initDriversPage, renderDriversTable } from './drivers.js';
import { loadCars, initCarsPage, renderCarsTable } from './cars.js';

import { initMap, clearMap, zoomVienna, renderMapFromStops, renderMapFromCustomers, invalidateMapSize } from './map.js';
import { loadGeoCache } from './geocode.js';

import { loadAssignments, initDispatchPage, renderDriverSelects, renderRouteResult } from './dispatch.js';
import { initChatPage } from './chat.js';

import { loadSavedRoutes, initRoutesPage, renderRoutesPage } from './routes.js';
import { loadSettings, initSettingsPage, renderSettings } from './settings.js';

import { initAddressFixModal } from './addressFixModal.js';

function setKpis() {
  $("kpiCustomers").textContent = String(state.customers?.length || 0);
  $("kpiDrivers").textContent = String(state.drivers?.length || 0);
  $("kpiSelected").textContent = String(getTodayCustomers()?.length || 0);
}

function setView(name) {
  const views = {
    map: $("viewMap"),
    customers: $("viewCustomers"),
    drivers: $("viewDrivers"),
    cars: $("viewCars"),
    dispatch: $("viewDispatch"),
    routes: $("viewRoutes"),
    chat: $("viewChat"),
    settings: $("viewSettings"),
  };

  for (const k of Object.keys(views)) {
    views[k]?.classList.toggle("hidden", k !== name);
  }

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  if (["customers", "drivers", "cars", "dispatch", "routes"].includes(name)) setKpis();
  if (name === "settings") renderSettings();
  if (name === "routes") renderRoutesPage();

  if (name === "map") {
    // Leaflet bugfix when switching from hidden view
    setTimeout(() => invalidateMapSize(), 30);
    setTimeout(() => invalidateMapSize(), 250);
    showRouteForMapSelection();
  }
}

function wireNav() {
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
}

// -------- Map dropdown (Startseite) --------
function renderMapDriverSelect() {
  const sel = $('mapDriver');
  if (!sel) return;

  sel.innerHTML = '';

  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Route wählen…';
  sel.appendChild(opt0);

  const list = state.isDriver && state.driverId
    ? (state.drivers || []).filter(d => String(d.id) === String(state.driverId))
    : (state.drivers || []);

  for (const d of list) {
    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = `🚗 ${d.name || 'Fahrer'}`;
    sel.appendChild(o);
  }

  if (state.mapSelectedDriverId) sel.value = String(state.mapSelectedDriverId);
  else if (state.activeDriverId) sel.value = String(state.activeDriverId);

  sel.disabled = !!state.isDriver;
}

function showRouteForMapSelection() {
  const sel = $('mapDriver');
  const picked = String(sel?.value || '');
  state.mapSelectedDriverId = picked;

  // ✅ No driver selected => customers pins only (NO polyline)
  if (!picked) {
    renderMapFromCustomers(state.customers || []);
    $('mapStatusPill').textContent = 'Kunden angezeigt';
    return;
  }

  // ✅ Driver selected => route markers + polyline
  const r = state.lastRoutes?.[picked] || null;
  if (r?.stops?.length) {
    renderMapFromStops(r.stops, r.geojson);
    $('mapStatusPill').textContent = 'Route angezeigt';
  } else {
    clearMap();
    $('mapStatusPill').textContent = 'bereit';
  }
}

// -------- UI role handling --------
function applyRoleUI() {
  const isDriver = !!state.isDriver;
  document.body.classList.toggle('driver-mode', isDriver);

  const hideViews = new Set(['customers', 'drivers', 'cars', 'dispatch', 'routes', 'settings']);
  document.querySelectorAll('.nav-btn').forEach(b => {
    const v = b.dataset.view;
    if (!v) return;
    b.classList.toggle('hidden', isDriver && hideViews.has(v));
  });
}

function onAuthed(user, opts = null) {
  state.user = user;
  state.isDriver = !!opts?.asDriver;
  state.driverId = opts?.driverId ? String(opts.driverId) : '';
  state.driver = null;

  if (state.isDriver) {
    $("whoami").textContent = `Fahrer • ${user.name}`;
  } else {
    $("whoami").textContent = `${user.name} • ${user.email}`;
  }

  applyRoleUI();

  // ---------- load data ----------
  loadSettings();
  loadGeoCache();
  loadCustomers();
  loadDrivers();
  loadCars();
  loadAssignments();
  loadSavedRoutes();

  if (state.isDriver && state.driverId) {
    state.driver = (state.drivers || []).find(d => String(d.id) === String(state.driverId)) || null;
    state.activeDriverId = String(state.driverId);
  }

  // ---------- init pages ----------
  if (!state.isDriver) {
    initCustomersPage(() => setKpis());
    initDriversPage(() => { renderDriverSelects(); setKpis(); });
    initCarsPage(() => setKpis());
    initDispatchPage(() => setKpis());
    initRoutesPage();
    initSettingsPage(() => setKpis());
  }

  initChatPage();
  initAddressFixModal();

  // ---------- Map ----------
  initMap();
  renderMapDriverSelect();
  $('mapDriver')?.addEventListener('change', () => {
    showRouteForMapSelection();
  });

  $("btnZoomVienna")?.addEventListener("click", zoomVienna);
  $("btnClearMap")?.addEventListener("click", () => {
    clearMap();
    $("mapStatusPill").textContent = "bereit";
  });

  // ---------- render ----------
  renderDriverSelects();
  if (!state.isDriver) {
    renderDriversTable?.();
    renderCarsTable?.();
    renderSettings();
    renderRouteResult();
    renderRoutesPage();
  }

  setKpis();
  setView(state.isDriver ? 'chat' : 'map');

  // initial map
  showRouteForMapSelection();

  if (!state.isDriver) {
    $("dispatchDriver")?.addEventListener("change", () => {
      state.activeDriverId = String($("dispatchDriver")?.value || '') || state.activeDriverId;
      renderMapDriverSelect();
      showRouteForMapSelection();
    });
  }

  window.addEventListener('route:updated', (e) => {
    const id = String(e?.detail?.driverId || '');
    if (id) state.activeDriverId = id;

    if (!state.mapSelectedDriverId) state.mapSelectedDriverId = id;

    renderMapDriverSelect();
    showRouteForMapSelection();
  });

  $("btnLogout")?.addEventListener("click", () => {
    if (!confirm("Logout?")) return;
    clearSession();
    location.reload();
  });

  if ($("startAddress")) $("startAddress").value = state.settings?.startAddress || "";
  if ($("setStartAddress")) $("setStartAddress").value = state.settings?.startAddress || "";
}

export function main() {
  wireNav();

  const auth = wireAuthUI(onAuthed);
  const sess = getSession();

  const type = sess?.type || (sess?.userId ? 'admin' : null);

  if (type === 'admin' && sess?.userId) {
    const u = getUserById(sess.userId);
    if (u) {
      auth.hideOverlay();
      onAuthed(u);
      return;
    }
  }

  if (type === 'driver' && sess?.ownerUserId && sess?.driverId) {
    const owner = getUserById(sess.ownerUserId);
    if (owner) {
      auth.hideOverlay();
      onAuthed(owner, { asDriver: true, driverId: sess.driverId });
      return;
    }
  }

  auth.showOverlay();
}

main();