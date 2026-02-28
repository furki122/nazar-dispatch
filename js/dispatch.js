import { state } from './state.js';
import { $, norm, debounce } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';
import { getTodayCustomers, saveCustomers } from './customers.js';
import { buildOptimizedRoute } from './route.js';
import { renderMapFromStops } from './map.js';
import { saveCurrentLastRouteSnapshot } from './routes.js';

// ---------------- storage keys ----------------
function keyAssignments(){
  const uid = mustUser(state);
  return scopedKey(uid, 'assignments_v1');
}
function keyLastRoutes(){
  const uid = mustUser(state);
  return scopedKey(uid, 'lastroutes_v1');
}
function keyActiveDriver(){
  const uid = mustUser(state);
  return scopedKey(uid, 'active_driver_v1');
}

function keyDailyCars(){
  const uid = mustUser(state);
  return scopedKey(uid, 'daily_cars_v1');
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------- load/save ----------------
export function loadAssignments(){
  // assignments: { driverId: [customerId,...] }
  const raw = getJson(keyAssignments(), {});
  const fixed = {};
  for (const k of Object.keys(raw || {})) fixed[String(k)] = (raw[k] || []).map(String);
  state.assignments = fixed;

  // lastRoutes: { driverId: routeResult }
  const rawRoutes = getJson(keyLastRoutes(), {}) || {};
  // normalize keys to strings (older versions may have stored numeric keys)
  const fixedRoutes = {};
  for (const k of Object.keys(rawRoutes || {})) fixedRoutes[String(k)] = rawRoutes[k];
  state.lastRoutes = fixedRoutes;

  // active driver
  state.activeDriverId = String(getJson(keyActiveDriver(), '') || '');

  // daily cars
  state.dailyCars = getJson(keyDailyCars(), {}) || {};

  // convenience: lastRoute = active driver's route
  state.lastRoute = state.activeDriverId ? (state.lastRoutes?.[state.activeDriverId] || null) : null;

  // selection memory for dispatch list
  if (!state.dispatchSelectedIds) state.dispatchSelectedIds = new Set();
}

export function saveAssignments(){
  setJson(keyAssignments(), state.assignments || {});
}

export function saveLastRoutes(){
  setJson(keyLastRoutes(), state.lastRoutes || {});
}

export function saveActiveDriver(){
  setJson(keyActiveDriver(), state.activeDriverId || '');
}

function saveDailyCars(){
  setJson(keyDailyCars(), state.dailyCars || {});
}

function getSelectedCarId(){
  const driverId = String($('dispatchDriver')?.value || state.activeDriverId || '');
  if (!driverId) return '';
  const day = todayISO();
  return String(state.dailyCars?.[day]?.[driverId] || '');
}

function setSelectedCarId(carId){
  const driverId = String($('dispatchDriver')?.value || state.activeDriverId || '');
  if (!driverId) return;
  const day = todayISO();
  state.dailyCars = state.dailyCars || {};
  state.dailyCars[day] = state.dailyCars[day] || {};
  state.dailyCars[day][driverId] = String(carId || '');
  saveDailyCars();
}

// ---------------- UI: driver selects ----------------
export function renderDriverSelects(){
  const sel = $('dispatchDriver');
  const selChat = $('chatDriver');
  if (!sel) return;

  sel.innerHTML = '';
  if (selChat) selChat.innerHTML = '';

  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Fahrer wählen…';
  sel.appendChild(opt0);

  // Chat: add global room
  if (selChat){
    const og = document.createElement('option');
    og.value = '__all__';
    og.textContent = '🌍 Team-Chat (Alle)';
    selChat.appendChild(og);

    const oc0 = document.createElement('option');
    oc0.value = '';
    oc0.textContent = 'Fahrer wählen…';
    selChat.appendChild(oc0);
  }

  const drivers = (state.drivers || []);
  const visibleDrivers = state.isDriver
    ? drivers.filter(d => String(d.id) === String(state.driverId || ''))
    : drivers;

  for (const d of visibleDrivers){
    const label = `${d.name || '(ohne name)'}${d.car ? ' • ' + d.car : ''}`;

    const o = document.createElement('option');
    o.value = String(d.id);
    o.textContent = label;
    sel.appendChild(o);

    if (selChat){
      const c = document.createElement('option');
      c.value = String(d.id);
      c.textContent = label;
      selChat.appendChild(c);
    }
  }

  // restore active driver selection
  if (state.activeDriverId){
    sel.value = state.activeDriverId;
  }

  // Chat selection default
  if (selChat){
    if (state.isDriver && state.driverId){
      selChat.value = String(state.driverId);
    } else if (!selChat.value){
      selChat.value = '__all__';
    }
  }

  renderCarSelect();
}

export function renderCarSelect(){
  const sel = $('dispatchCar');
  if (!sel) return;

  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Auto wählen…';
  sel.appendChild(opt0);

  for (const c of (state.cars || [])){
    const label = [c.brand, c.plate].filter(Boolean).join(' • ') || 'Auto';
    const o = document.createElement('option');
    o.value = String(c.id);
    o.textContent = c.type ? `${label} (${c.type})` : label;
    sel.appendChild(o);
  }

  const cur = getSelectedCarId();
  if (cur) sel.value = cur;

  sel.onchange = ()=> setSelectedCarId(sel.value);
}

// ---------------- Today list rendering ----------------
function renderTodayList(){
  const lb = $('todayList');
  if (!lb) return;

  const prevScroll = lb.scrollTop;
  const q = norm($('dispatchSearch')?.value || '').toLowerCase();

  const today = (getTodayCustomers() || []);
  const onlyToday = !!$('dispatchOnlyToday')?.checked;
  const source = onlyToday ? today : (state.customers || []);

  const list = source
    .slice()
    .filter(c => {
      if (!q) return true;
      const hay = `${c.firmenname || ''} ${c.adresse || ''} ${c.postleitzahl || ''} ${c.ort || ''}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a,b)=>{
      const an = (a.firmenname||'').localeCompare(b.firmenname||'', 'de', { sensitivity:'base' });
      if (an) return an;
      const ap = String(a.postleitzahl||'').localeCompare(String(b.postleitzahl||''), 'de', { sensitivity:'base' });
      if (ap) return ap;
      const ao = (a.ort||'').localeCompare(b.ort||'', 'de', { sensitivity:'base' });
      if (ao) return ao;
      return (a.adresse||'').localeCompare(b.adresse||'', 'de', { sensitivity:'base' });
    });

  const driverId = String($('dispatchDriver')?.value || '');
  const assignedSet = new Set((state.assignments?.[driverId] || []).map(String));

  lb.innerHTML = '';

  if (!list.length){
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.value = '';
    opt.textContent = q
      ? 'Keine Treffer. Suche löschen, um alle zu sehen.'
      : 'Keine Kunden vorhanden. Bitte zuerst Excel importieren oder Kunden anlegen.';
    lb.appendChild(opt);
    $('dispatchCountPill').textContent = '0';
    lb.scrollTop = 0;
    return;
  }

  for (const c of list){
    const id = String(c.id);
    const opt = document.createElement('option');
    opt.value = id;

    const name = c.firmenname || '(ohne Name)';
    const city = [c.postleitzahl, c.ort].filter(Boolean).join(' ').trim();
    const addr = c.adresse || '';

    const inv = Number(c.openInvoices ?? 0);
    const invTag = inv > 0 ? ` 🧾${inv}` : '';
    opt.textContent = `${assignedSet.has(id) ? '✅ ' : ''}${name} — ${city}${addr ? ' — ' + addr : ''}${invTag}`;

    // selection restore (cross-search)
    if (state.dispatchSelectedIds?.has(id)) opt.selected = true;

    lb.appendChild(opt);
  }

  // restore scroll (kills jump)
  lb.scrollTop = prevScroll;
  requestAnimationFrame(() => { lb.scrollTop = prevScroll; });

  $('dispatchCountPill').textContent = `${list.length} ` + (onlyToday ? 'Heute' : 'Alle');
}

// ---------------- Route result box ----------------
export function renderRouteResult(){
  // (dein bestehender Code bleibt hier unverändert)
  // Ich ändere in dieser Datei NUR die Offene-Rechnungen-Abfrage (btnSetInvoices)
  // damit du keine anderen Baustellen bekommst.
  const box = $("routeBox");
  const st = $("routeStatus");
  if (!box || !st) return;

  $("startAddress").value = state.settings.startAddress || "";

  const driverId = String($("dispatchDriver")?.value || "");
  const assignedIds = (state.assignments?.[driverId] || []).map(String);

  if (!state.lastRoute){
    if (!driverId){
      st.textContent = "Bereit";
      box.innerHTML = `
        <div class="route-empty">
          <div class="route-empty-title">Noch keine Route</div>
          <div class="route-empty-sub">Wähle zuerst einen Fahrer.</div>
        </div>`;
      return;
    }

    if (!assignedIds.length){
      st.textContent = "Bereit";
      box.innerHTML = `
        <div class="route-empty">
          <div class="route-empty-title">Keine Zuweisungen</div>
          <div class="route-empty-sub">Markiere links Kunden und klicke „Ausgewählte zuweisen“.</div>
        </div>`;
      return;
    }

    const byId = new Map((state.customers || []).map(c => [String(c.id), c]));

    const rows = assignedIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map((c, i) => {
        const name = c.firmenname || "(ohne Name)";
        const city = [c.postleitzahl, c.ort].filter(Boolean).join(" ").trim();
        const addr = c.adresse || "";
        const right = [city, addr].filter(Boolean).join(" — ");

        return `
          <div class="route-stop">
            <div class="route-stop-idx">${i+1}</div>
            <div class="route-stop-main">
              <div class="route-stop-line">
                <div class="route-stop-name">${escapeHtml(name)}</div>
                <div class="route-stop-sep">|</div>
                <div class="route-stop-addr">${escapeHtml(right)}</div>
              </div>
            </div>
          </div>
        `;
      }).join("");

    st.textContent = "Bereit";
    box.innerHTML = `
      <div class="route-head">
        <div class="route-badge">✅ Zugewiesen</div>
        <div class="route-meta">${assignedIds.length} Stopps</div>
      </div>
      <div class="route-list">${rows}</div>
      <div class="route-hint">Tipp: Klick „⚡ Schnellste Route“, um die Reihenfolge zu optimieren.</div>
    `;
    return;
  }

  const km = ((state.lastRoute.distance_m || 0) / 1000).toFixed(1);
  const min = Math.round((state.lastRoute.duration_s || 0) / 60);

  const carId = getSelectedCarId();
  const car = (state.cars || []).find(x=>String(x.id)===String(carId));
  const carLabel = car ? ([car.nickname, car.brand, car.plate].filter(Boolean).join(' • ') || 'Auto') : '';

  st.textContent = `OSRM: ${km} km • ca. ${min} min${carLabel ? ' • ' + carLabel : ''}`;

  const rows = (state.lastRoute.stops || []).map((s, i) => {
    const left = s.label || "";
    const right = s.address || "";
    return `
      <div class="route-stop">
        <div class="route-stop-idx">${i+1}</div>
        <div class="route-stop-main">
          <div class="route-stop-line">
            <div class="route-stop-name">${escapeHtml(left)}</div>
            <div class="route-stop-sep">|</div>
            <div class="route-stop-addr">${escapeHtml(right)}</div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  box.innerHTML = `
    <div class="route-head">
      <div class="route-badge">⚡ Route berechnet</div>
      <div class="route-meta">${km} km • ${min} min • ${(state.lastRoute.stops||[]).length} Stopps</div>
    </div>
    <div class="route-list">${rows}</div>
  `;
}

function escapeHtml(str){
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------------- Google Maps open ----------------
export function openGoogleMapsForLastRoute(){
  const driverId = String($('dispatchDriver')?.value || '');
  const r = state.lastRoutes?.[driverId] || null;
  if (!r?.stops?.length) return alert('Bitte zuerst „⚡ Schnellste Route“ berechnen.');

  const toPoint = (s) => {
    const lat = s.lat ?? s.latitude ?? s.y;
    const lng = s.lng ?? s.lon ?? s.longitude ?? s.x;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
    return s.address;
  };

  const stops = r.stops;
  const origin = encodeURIComponent(toPoint(stops[0]));
  const destination = encodeURIComponent(toPoint(stops[stops.length - 1]));
  const waypoints = stops.slice(1, -1).map(s => encodeURIComponent(toPoint(s)));
  const wp = waypoints.slice(0, 20).join('%7C');

  const url =
    `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}` +
    (wp ? `&waypoints=${wp}` : '') +
    `&travelmode=driving`;

  const w = window.open('about:blank', '_blank');
  if (!w) return alert('Popup blockiert. Bitte Popup-Blocker erlauben.');
  w.location.href = url;
}

// ---------------- init page ----------------
export function initDispatchPage(onAnyChange){
  if (!state.dispatchSelectedIds) state.dispatchSelectedIds = new Set();

  $('dispatchSearch')?.addEventListener('input', debounce(renderTodayList, 120));
  $('dispatchOnlyToday')?.addEventListener('change', renderTodayList);

  $('dispatchDriver')?.addEventListener('change', ()=>{
    state.activeDriverId = String($('dispatchDriver')?.value || '');
    saveActiveDriver();

    state.dispatchSelectedIds.clear();

    renderTodayList();
    state.lastRoute = state.activeDriverId ? (state.lastRoutes?.[state.activeDriverId] || null) : null;
    renderRouteResult();

    renderCarSelect();

    const r = state.lastRoutes?.[state.activeDriverId];
    if (r?.stops?.length){
      renderMapFromStops(r.stops, r.geojson);
      const pill = $('mapStatusPill'); if (pill) pill.textContent = 'Route angezeigt';
    } else {
      const pill = $('mapStatusPill'); if (pill) pill.textContent = 'bereit';
    }

    window.dispatchEvent(new CustomEvent('route:updated', { detail: { driverId: state.activeDriverId } }));
  });

  $('btnSelectAllToday')?.addEventListener('click', ()=>{
    const lb = $('todayList');
    if (!lb) return;
    Array.from(lb.options).forEach(o=>{
      if (!o.disabled && o.value){
        o.selected = true;
        state.dispatchSelectedIds.add(String(o.value));
      }
    });
  });

  $('btnUnselectAllToday')?.addEventListener('click', ()=>{
    const lb = $('todayList');
    if (!lb) return;
    Array.from(lb.options).forEach(o=> o.selected = false);
    state.dispatchSelectedIds.clear();
  });

  // Multi-select without CTRL + no scroll jump
  const listEl = $('todayList');
  if (listEl){
    listEl.addEventListener('pointerdown', (e)=>{
      const opt = e.target;
      if (!opt || opt.tagName !== 'OPTION') return;

      e.preventDefault();
      const prevScroll = listEl.scrollTop;
      const id = String(opt.value || '');
      if (!id) return;

      const next = !opt.selected;
      opt.selected = next;
      if (next) state.dispatchSelectedIds.add(id);
      else state.dispatchSelectedIds.delete(id);

      listEl.scrollTop = prevScroll;
      requestAnimationFrame(()=>{ listEl.scrollTop = prevScroll; });
    });
  }

  $('btnAssignSelected')?.addEventListener('click', ()=>{
    const driverId = String($('dispatchDriver')?.value || '');
    if (!driverId) return alert('Bitte Fahrer wählen.');

    const ids = Array.from($('todayList')?.selectedOptions || [])
      .map(o => String(o.value))
      .filter(Boolean);

    if (!ids.length) return alert('Bitte Kunden markieren.');

    state.assignments = state.assignments || {};
    const cur = new Set((state.assignments[driverId] || []).map(String));
    ids.forEach(id => cur.add(id));
    state.assignments[driverId] = Array.from(cur);

    saveAssignments();
    renderTodayList();
    renderRouteResult();
    onAnyChange?.();
  });

  $('btnUnassignDriver')?.addEventListener('click', ()=>{
    const driverId = String($('dispatchDriver')?.value || '');
    if (!driverId) return alert('Bitte Fahrer wählen.');
    if (!confirm('Alle Zuweisungen für diesen Fahrer löschen?')) return;

    if (state.assignments) delete state.assignments[driverId];
    saveAssignments();

    if (state.lastRoutes) delete state.lastRoutes[driverId];
    saveLastRoutes();

    state.dispatchSelectedIds.clear();

    renderTodayList();
    renderRouteResult();
    onAnyChange?.();

    window.dispatchEvent(new CustomEvent('route:updated', { detail: { driverId } }));
    alert('❌ Zuweisung gelöscht');
  });

  $('btnBuildRoute')?.addEventListener('click', async ()=>{
    const driverId = String($('dispatchDriver')?.value || '');
    if (!driverId) return alert('Bitte Fahrer wählen.');

    const ids = (state.assignments?.[driverId] || []).map(String);
    if (!ids.length) return alert('Dieser Fahrer hat keine zugewiesenen Kunden.');

    $('routeStatus').textContent = 'Route wird berechnet…';

    try{
      const result = await buildOptimizedRoute(driverId, ids);

      state.lastRoutes = state.lastRoutes || {};
      state.lastRoutes[driverId] = result;
      saveLastRoutes();

      state.lastRoute = result;

      renderRouteResult();
      renderMapFromStops(result.stops, result.geojson);
      const pill = $('mapStatusPill'); if (pill) pill.textContent = 'Route angezeigt';

      onAnyChange?.();
      window.dispatchEvent(new CustomEvent('route:updated', { detail: { driverId } }));

    }catch(e){
      const msg = e?.message || String(e);
      $('routeStatus').textContent = 'Fehler: ' + msg;
      alert(msg);
    }
  });

  $('btnOpenGoogleMaps')?.addEventListener('click', ()=>{
    openGoogleMapsForLastRoute();
  });

  $('btnCopyStops')?.addEventListener('click', ()=>{
    const driverId = String($('dispatchDriver')?.value || '');
    const r = state.lastRoutes?.[driverId] || null;
    if (!r?.stops?.length) return alert('Keine Route.');
    const lines = r.stops.map((s,i)=>`${i+1}. ${s.address}`);
    navigator.clipboard?.writeText(lines.join('\n'))
      .then(()=>alert('📋 Copied'))
      .catch(()=>alert('Copy nicht möglich.'));
  });

  $('btnSaveRoute')?.addEventListener('click', ()=>{
    const driverId = String($('dispatchDriver')?.value || '');
    if (!driverId) return alert('Bitte Fahrer wählen.');
    const ok = saveCurrentLastRouteSnapshot({ driverId, carId: getSelectedCarId() });
    if (!ok) return alert('Keine Route vorhanden. Bitte zuerst „⚡ Schnellste Route“ berechnen.');
    alert('💾 Route gespeichert (Routen Archiv).');
    window.dispatchEvent(new CustomEvent('routes:updated'));
  });

  // ✅ NEU: bei mehreren Kunden einzeln abfragen
  $('btnSetInvoices')?.addEventListener('click', ()=>{
    const ids = Array.from($('todayList')?.selectedOptions || [])
      .map(o=>String(o.value))
      .filter(Boolean);

    if (!ids.length) return alert('Bitte Kunden markieren.');

    for (const id of ids){
      const c = (state.customers || []).find(x=>String(x.id)===String(id));
      if (!c) continue;

      const name = c.firmenname || '(ohne Name)';
      const cur = Number(c.openInvoices ?? 0) || 0;

      const raw = prompt(`Offene Rechnungen für:\n${name}\n\nZahl eingeben:`, String(cur));
      if (raw === null) continue;

      const n = Number(String(raw).replace(',', '.'));
      const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      c.openInvoices = v;
    }

    saveCustomers();
    renderTodayList();
    alert('🧾 Gespeichert');
  });

  $('startAddress')?.addEventListener('blur', ()=>{
    state.settings = state.settings || {};
    state.settings.startAddress = norm($('startAddress').value) || state.settings.startAddress;
    onAnyChange?.();
  });

  // initial render
  renderTodayList();
  renderRouteResult();
  renderCarSelect();
}