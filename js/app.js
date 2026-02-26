import { state } from './state.js';
import { $ } from './utils.js';
import { wireAuthUI, getSession, getUserById, clearSession } from './auth.js';

import { loadCustomers, initCustomersPage, getTodayCustomers } from './customers.js';
import { loadDrivers, initDriversPage, renderDriversTable } from './drivers.js';
import { loadCars, initCarsPage, renderCarsTable } from './cars.js';

import { initMap, clearMap, zoomVienna, renderMapFromStops, renderMapFromCustomers } from './map.js';
import { loadGeoCache } from './geocode.js';

import { loadAssignments, initDispatchPage, renderDriverSelects, renderRouteResult } from './dispatch.js';
import { initChatPage } from './chat.js';

import { loadSavedRoutes, initRoutesPage, renderRoutesPage } from './routes.js';

import { loadSettings, initSettingsPage, renderSettings } from './settings.js';

// optional (falls du es nutzt):
// import { initAddressFixModal } from './addressFixModal.js';

function setKpis() {
  $("kpiCustomers").textContent = String(state.customers.length);
  $("kpiDrivers").textContent = String(state.drivers.length);
  $("kpiSelected").textContent = String(getTodayCustomers().length);
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
    views[k].classList.toggle("hidden", k !== name);
  }

  document.querySelectorAll(".nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.view === name);
  });

  if (name === "customers" || name === "drivers" || name === "cars" || name === "dispatch" || name === 'routes') setKpis();
  if (name === "settings") renderSettings();
  if (name === 'routes') renderRoutesPage();

  if (name === 'map') showRouteForMapSelection();
}

function wireNav() {
  document.querySelectorAll(".nav-btn").forEach(b => {
    b.addEventListener("click", () => setView(b.dataset.view));
  });
}

function showSelectedDriverRouteOnMapIfExists() {
  // Prefer persisted active driver (works even if the select isn't rendered yet)
  const driverId = String(state.activeDriverId || $("dispatchDriver")?.value || "");
  if (!driverId) return;

  // dispatch.js nutzt lastRoutes pro Fahrer
  const r = state.lastRoutes?.[driverId] || null;
  if (r?.stops?.length) {
    renderMapFromStops(r.stops, r.geojson);
    $("mapStatusPill").textContent = "Route angezeigt";
  } else {
    $("mapStatusPill").textContent = "bereit";
  }
}

function renderMapDriverSelect(){
  const sel = $('mapDriver');
  if (!sel) return;

  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Route wählen…';
  sel.appendChild(opt0);

  const list = state.isDriver && state.driverId
    ? (state.drivers || []).filter(d=>String(d.id)===String(state.driverId))
    : (state.drivers || []);

  for (const d of list){
    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = `🚗 ${d.name || 'Fahrer'}`;
    sel.appendChild(o);
  }

  if (state.activeDriverId) sel.value = String(state.activeDriverId);
  sel.disabled = state.isDriver;
}

function showRouteForMapSelection(){
  const sel = $('mapDriver');
  const picked = String(sel?.value || '');
  // If nothing selected: show customer pins (from Kundenliste)
  if (!picked){
    renderMapFromCustomers(state.customers || []);
    $('mapStatusPill').textContent = 'Kunden angezeigt';
    return;
  }

  const driverId = picked;
  const r = state.lastRoutes?.[driverId] || null;
  if (r?.stops?.length){
    renderMapFromStops(r.stops, r.geojson);
    $('mapStatusPill').textContent = 'Route angezeigt';
  } else {
    clearMap();
    $('mapStatusPill').textContent = 'bereit';
  }
}

function applyRoleUI(){
  const isDriver = !!state.isDriver;
  document.body.classList.toggle('driver-mode', isDriver);

  // Hide admin-only nav buttons in driver mode
  const hideViews = new Set(['customers','drivers','cars','dispatch','routes','settings']);
  document.querySelectorAll('.nav-btn').forEach(b=>{
    const v = b.dataset.view;
    if (!v) return;
    b.classList.toggle('hidden', isDriver && hideViews.has(v));
  });

  // KPI card is admin-ish; keep but you can hide it in CSS via .driver-mode
}

function onAuthed(user, opts = null) {
  state.user = user;
  state.isDriver = !!opts?.asDriver;
  state.driverId = opts?.driverId ? String(opts.driverId) : '';
  state.driver = null;

  if (state.isDriver){
    $("whoami").textContent = `Fahrer • ${user.name}`;
  } else {
    $("whoami").textContent = `${user.name} • ${user.email}`;
  }

  applyRoleUI();

  // Daten laden
  loadSettings();
  loadGeoCache();
  loadCustomers();
  loadDrivers();
  loadCars();
  loadAssignments();
  loadSavedRoutes();

  if (state.isDriver && state.driverId){
    state.driver = (state.drivers || []).find(d => String(d.id) === String(state.driverId)) || null;
    // make sure active driver is this driver
    state.activeDriverId = String(state.driverId);
  }

  // Seiten initialisieren
  // Pages: drivers should not need customers/drivers/dispatch/settings init.
  if (!state.isDriver){
    initCustomersPage(() => setKpis());
    initDriversPage(() => { renderDriverSelects(); setKpis(); });
    initCarsPage(() => setKpis());
    initDispatchPage(() => setKpis());
    initRoutesPage();
    initSettingsPage(() => setKpis());
  }
  initChatPage();

  // Map init
  initMap();
  renderMapDriverSelect();
  $('mapDriver')?.addEventListener('change', showRouteForMapSelection);
  $("btnZoomVienna").addEventListener("click", zoomVienna);
  $("btnClearMap").addEventListener("click", () => {
    clearMap();
    $("mapStatusPill").textContent = "bereit";
  });

  // Dropdowns / Tabellen / Settings rendern
  renderDriverSelects();
  if (!state.isDriver){
    renderDriversTable?.();
    renderCarsTable?.();
    renderSettings();
    renderRouteResult();
    renderRoutesPage();
  }

  // Default view
  setKpis();
  setView(state.isDriver ? 'chat' : 'map');

  // ✅ Start(Karte): Wenn kein Fahrer gewählt ist → Kundenpins. Sonst Route.
  showRouteForMapSelection();

  // ✅ Wenn Fahrer gewechselt wird, soll die Start-Karte die Route zeigen
  if (!state.isDriver){
    $("dispatchDriver")?.addEventListener("change", () => {
      renderMapDriverSelect();
      // do not auto-switch map: keep current map selection (or show pins)
      showRouteForMapSelection();
    });
  }

  // ✅ Wenn eine Route neu berechnet/aktualisiert wird, Start-Karte updaten
  window.addEventListener('route:updated', (e) => {
    const id = String(e?.detail?.driverId || state.activeDriverId || '');
    if (id) state.activeDriverId = id;
    renderMapDriverSelect();
    showRouteForMapSelection();
  });

  // ✅ Beim Wechsel auf Start(Karte) Route erneut anzeigen
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.view === 'map') showRouteForMapSelection();
    });
  });

  // Logout
  $("btnLogout").addEventListener("click", () => {
    if (!confirm("Logout?")) return;
    clearSession();
    location.reload();
  });

  // Start-Adresse sync
  $("startAddress").value = state.settings.startAddress || "";
  $("setStartAddress").value = state.settings.startAddress || "";
}

export function main() {
  wireNav();

  const auth = wireAuthUI(onAuthed);

  const sess = getSession();
  // Backwards compatible: old sessions had {userId}
  const type = sess?.type || (sess?.userId ? 'admin' : null);

  if (type === 'admin' && sess?.userId){
    const u = getUserById(sess.userId);
    if (u){
      auth.hideOverlay();
      onAuthed(u);
      return;
    }
  }

  if (type === 'driver' && sess?.ownerUserId && sess?.driverId){
    const owner = getUserById(sess.ownerUserId);
    if (owner){
      auth.hideOverlay();
      onAuthed(owner, { asDriver: true, driverId: sess.driverId });
      return;
    }
  }

  auth.showOverlay();
}

// ✅ WICHTIG: Ohne das passiert beim Login nix!
main();