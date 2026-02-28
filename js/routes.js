import { state } from './state.js';
import { $, norm, esc, debounce } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';
import { renderMapFromStops } from './map.js';

function keySavedRoutes(){
  const uid = mustUser(state);
  return scopedKey(uid, 'saved_routes_v1');
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

export function loadSavedRoutes(){
  state.savedRoutes = getJson(keySavedRoutes(), []) || [];
  state.savedRoutesActiveId = String(state.savedRoutesActiveId || '');
}

export function saveSavedRoutes(){
  setJson(keySavedRoutes(), state.savedRoutes || []);
}

export function saveCurrentLastRouteSnapshot(opts){
  const driverId = String(opts?.driverId || state.activeDriverId || '');
  if (!driverId) return false;

  const r = state.lastRoutes?.[driverId] || null;
  if (!r?.stops?.length) return false;

  const id = crypto.randomUUID?.() || String(Date.now()) + Math.random();
  const date = String(opts?.date || todayISO());
  const carId = String(opts?.carId || '');

  // snapshot open invoices from customers, keyed by customerId
  const invoices = {};
  const byId = new Map((state.customers || []).map(c=>[String(c.id), c]));
  for (const s of (r.stops || [])){
    const cid = String(s.customerId || s.id || '');
    if (!cid) continue;
    const c = byId.get(cid);
    const n = Number(c?.openInvoices ?? 0);
    if (Number.isFinite(n) && n > 0) invoices[cid] = n;
  }

  state.savedRoutes = state.savedRoutes || [];
  state.savedRoutes.unshift({
    id,
    createdAt: Date.now(),
    date,
    driverId,
    carId,
    route: r,
    delivered: {},
    invoices, // { customerId: number }
  });

  state.savedRoutesActiveId = id;
  saveSavedRoutes();
  return true;
}

function driverLabel(driverId){
  const d = (state.drivers || []).find(x=>String(x.id)===String(driverId));
  return d?.name || 'Fahrer';
}

function carLabel(carId){
  const c = (state.cars || []).find(x=>String(x.id)===String(carId));
  if (!c) return '';
  const a = [c.nickname, c.brand, c.plate].filter(Boolean).join(' • ');
  const t = c.type ? ` (${c.type})` : '';
  return (a || 'Auto') + t;
}

function filtered(){
  const q = norm($('routesSearch')?.value || '').toLowerCase();
  const list = (state.savedRoutes || []);
  if (!q) return list;
  return list.filter(r=>{
    const hay = `${r.date} ${driverLabel(r.driverId)} ${carLabel(r.carId)}`.toLowerCase();
    return hay.includes(q);
  });
}

function setActive(id){
  state.savedRoutesActiveId = String(id || '');
  renderRoutesPage();
}

function renderList(){
  const el = $('routesList');
  if (!el) return;
  el.innerHTML = '';

  const list = filtered();
  if (!list.length){
    el.innerHTML = `<div class="tiny muted">Keine gespeicherten Routen.</div>`;
    return;
  }

  for (const r of list){
    const item = document.createElement('div');
    item.className = 'route-item' + (String(state.savedRoutesActiveId)===String(r.id) ? ' active' : '');
    const title = `${r.date} • ${driverLabel(r.driverId)}`;
    const sub = [carLabel(r.carId), `${(r.route?.stops||[]).length} Stopps`].filter(Boolean).join(' • ');
    item.innerHTML = `<div class="t">${esc(title)}</div><div class="s">${esc(sub)}</div>`;
    item.addEventListener('click', ()=> setActive(r.id));
    el.appendChild(item);
  }
}

function renderDetail(){
  const box = $('routesDetailBox');
  const title = $('routesDetailTitle');
  const meta = $('routesDetailMeta');
  if (!box || !title || !meta) return;

  const r = (state.savedRoutes || []).find(x=>String(x.id)===String(state.savedRoutesActiveId)) || null;
  if (!r){
    title.textContent = 'Route Details';
    meta.textContent = '–';
    box.innerHTML = 'Wähle links eine Route.';
    return;
  }

  title.textContent = `${r.date} • ${driverLabel(r.driverId)}`;
  meta.textContent = [carLabel(r.carId), `${(r.route?.stops||[]).length} Stopps`].filter(Boolean).join(' • ') || '–';

  const stops = r.route?.stops || [];
  if (!stops.length){
    box.innerHTML = `<div class="tiny muted">Keine Stopps.</div>`;
    return;
  }

  const byId = new Map((state.customers || []).map(c=>[String(c.id), c]));

  // split into normal vs open-invoices (based on saved snapshot r.invoices)
  const normal = [];
  const open = [];
  for (let idx=0; idx<stops.length; idx++){
    const s = stops[idx];
    const cid = String(s.customerId || s.id || '');
    const invN = Number(r.invoices?.[cid] ?? 0);
    if (Number.isFinite(invN) && invN > 0) open.push({ s, idx, cid, invN });
    else normal.push({ s, idx, cid, invN: 0 });
  }

  const renderNormalRow = ({ s, idx, cid }) => {
    const c = byId.get(cid);
    const name = s.label || c?.firmenname || `Stopp ${idx+1}`;
    const addr = s.address || c?.__address || '';
    const checked = r.delivered?.[cid] ? 'checked' : '';

    return `
      <div class="deliver-row" data-cid="${esc(cid)}">
        <div>
          <div class="name">${esc(String(idx+1) + '. ' + name)}</div>
          <div class="addr">${esc(addr)}</div>
        </div>
        <div class="right">
          <label class="chk">
            <input type="checkbox" data-deliv="${esc(cid)}" ${checked}/>
            Rechnung gebracht
          </label>
        </div>
      </div>
    `;
  };

  const renderOpenRow = ({ s, idx, cid, invN }) => {
    const c = byId.get(cid);
    const name = s.label || c?.firmenname || `Stopp ${idx+1}`;
    const addr = s.address || c?.__address || '';
    const checked = r.delivered?.[cid] ? 'checked' : '';
    const pill = (Number.isFinite(invN) && invN > 0) ? `🧾 ${invN}` : '';

    return `
      <div class="deliver-row" data-cid="${esc(cid)}">
        <div>
          <div class="name">${esc(String(idx+1) + '. ' + name)}</div>
          <div class="addr">${esc(addr)}</div>
        </div>
        <div class="right">
          <div class="row gap8" style="justify-content:flex-end; align-items:center;">
            <label class="tiny muted">Offen</label>
            <input class="input" style="width:84px;" type="number" min="0" step="1"
              value="${Number.isFinite(invN) ? String(invN) : '0'}" data-inv="${esc(cid)}" />
            ${pill ? `<span class="pill">${esc(pill)}</span>` : ''}
          </div>
          <label class="chk">
            <input type="checkbox" data-deliv="${esc(cid)}" ${checked}/>
            Rechnung gebracht
          </label>
        </div>
      </div>
    `;
  };

  const htmlNormal = normal.map(renderNormalRow).join('') || `<div class="tiny muted" style="padding:10px;">Keine normalen Kunden.</div>`;
  const htmlOpen = open.map(renderOpenRow).join('') || `<div class="tiny muted" style="padding:10px;">Keine offenen Rechnungen.</div>`;

  box.innerHTML = `
    <div class="row gap8" style="margin-bottom:10px;">
      <button class="btn" id="btnShowRouteOnMap">🗺️ Auf Karte zeigen</button>
    </div>

    <div class="box" style="padding:0; margin-bottom:12px;">
      <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-weight:600;">
        Kunden
      </div>
      ${htmlNormal}
    </div>

    <div class="box" style="padding:0;">
      <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-weight:600;">
        Offene Rechnungen
      </div>
      ${htmlOpen}
    </div>
  `;

  $('btnShowRouteOnMap')?.addEventListener('click', ()=>{
    if (r.route?.stops?.length){
      renderMapFromStops(r.route.stops, r.route.geojson);
      document.querySelector('[data-view="map"]')?.click();
    }
  });

  // delivered checkboxes for BOTH sections
  box.querySelectorAll('[data-deliv]')?.forEach(chk=>{
    chk.addEventListener('change', ()=>{
      const cid = String(chk.dataset.deliv || '');
      if (!cid) return;
      r.delivered = r.delivered || {};
      r.delivered[cid] = !!chk.checked;
      saveSavedRoutes();
    });
  });

  // open-invoice editing ONLY exists in "open" section
  box.querySelectorAll('[data-inv]')?.forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const cid = String(inp.dataset.inv || '');
      if (!cid) return;

      const n = Math.max(0, Math.floor(Number(inp.value || 0)));
      r.invoices = r.invoices || {};
      if (n > 0) r.invoices[cid] = n;
      else delete r.invoices[cid];

      // optional mirror into customer master
      const c = (state.customers || []).find(x=>String(x.id)===cid);
      if (c) c.openInvoices = n;

      saveSavedRoutes();
      // re-render to move row between sections if needed
      renderDetail();
    });
  });
}

export function renderRoutesPage(){
  renderList();
  renderDetail();
}

export function initRoutesPage(){
  $('routesSearch')?.addEventListener('input', debounce(renderRoutesPage, 120));

  $('btnDeleteSavedRoute')?.addEventListener('click', ()=>{
    const id = String(state.savedRoutesActiveId || '');
    if (!id) return alert('Bitte eine Route auswählen.');
    if (!confirm('Diese gespeicherte Route löschen?')) return;
    state.savedRoutes = (state.savedRoutes || []).filter(r=>String(r.id)!==id);
    state.savedRoutesActiveId = String(state.savedRoutes?.[0]?.id || '');
    saveSavedRoutes();
    renderRoutesPage();
  });

  window.addEventListener('routes:updated', ()=>{
    loadSavedRoutes();
    renderRoutesPage();
  });

  renderRoutesPage();
}