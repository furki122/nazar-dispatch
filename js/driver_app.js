import { getSession, clearSession, getUserById, loginDriver } from './auth.js';
import { getJson, scopedKey } from './storage.js';
import { norm } from './utils.js';

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function esc(s){
  return String(s||'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function mustDriverSession(){
  const s = getSession();
  if (!s || s.type !== 'driver' || !s.ownerUserId || !s.driverId) return null;
  return s;
}

function ownerScoped(ownerUserId, key){
  return scopedKey(String(ownerUserId), key);
}

function loadLastRoutes(ownerUserId){
  return getJson(ownerScoped(ownerUserId, 'lastroutes_v1'), {}) || {};
}

function loadDrivers(ownerUserId){
  return getJson(ownerScoped(ownerUserId, 'drivers_v1'), []) || [];
}

function byDriverId(list, id){
  return (list || []).find(d => String(d.id) === String(id)) || null;
}

function toPoint(s){
  const lat = s.lat ?? s.latitude ?? s.y;
  const lng = s.lng ?? s.lon ?? s.longitude ?? s.x;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat},${lng}`;
  return s.address;
}

function openGoogleMapsRoute(stops){
  if (!stops?.length) return alert('Keine Route vorhanden.');

  const origin = encodeURIComponent(toPoint(stops[0]));
  const destination = encodeURIComponent(toPoint(stops[stops.length - 1]));
  const waypoints = stops.slice(1, -1).map(s => encodeURIComponent(toPoint(s)));
  const wp = waypoints.slice(0, 20).join('%7C');

  const url =
    `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}` +
    (wp ? `&waypoints=${wp}` : '') +
    `&travelmode=driving`;

  // in PWA fühlt sich das wie “App Navigation” an
  window.location.href = url;
}

function setLoggedInUI(on){
  document.getElementById('loginCard')?.classList.toggle('hidden', on);
  document.getElementById('routeCard')?.classList.toggle('hidden', !on);
  document.getElementById('stopsCard')?.classList.toggle('hidden', !on);
}

function renderStops(stops){
  const host = document.getElementById('stopsList');
  if (!host) return;

  if (!stops?.length){
    host.innerHTML = `<div class="muted" style="padding:10px;">Keine Stopps.</div>`;
    return;
  }

  host.innerHTML = stops.map((s, i) => {
    const label = s.label || '';
    const addr = s.address || '';
    return `
      <div class="stop">
        <div class="nr">${i+1}</div>
        <div class="txt">
          <div class="t">${esc(label)}</div>
          <div class="a">${esc(addr)}</div>
        </div>
        <button class="btn tiny" data-open="${i}">Karte</button>
      </div>
    `;
  }).join('');

  host.querySelectorAll('[data-open]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const i = Number(btn.dataset.open);
      const s = stops[i];
      if (!s) return;
      const q = encodeURIComponent(s.address || '');
      window.location.href = `https://www.google.com/maps/search/?api=1&query=${q}`;
    });
  });
}

function refresh(){
  const sess = mustDriverSession();
  if (!sess){
    setLoggedInUI(false);
    return;
  }

  const owner = getUserById(sess.ownerUserId);
  if (!owner){
    alert('Owner nicht gefunden. Bitte neu einloggen.');
    clearSession();
    setLoggedInUI(false);
    return;
  }

  const drivers = loadDrivers(sess.ownerUserId);
  const drv = byDriverId(drivers, sess.driverId);
  const name = drv?.name || 'Fahrer';

  const lastRoutes = loadLastRoutes(sess.ownerUserId);
  const route = lastRoutes[String(sess.driverId)] || null;

  document.getElementById('drvTitle').textContent = `Route • ${name}`;
  document.getElementById('drvMeta').textContent =
    route?.stops?.length ? `${todayISO()} • ${route.stops.length} Stopps`
                         : `${todayISO()} • keine Route vorhanden`;

  renderStops(route?.stops || []);

  const btnStart = document.getElementById('btnStartRoute');
  btnStart.disabled = !(route?.stops?.length);
  btnStart.onclick = ()=> openGoogleMapsRoute(route.stops);

  setLoggedInUI(true);
}

// ---- Events ----
document.getElementById('btnLogoutDriver')?.addEventListener('click', ()=>{
  if (!confirm('Logout?')) return;
  clearSession();
  setLoggedInUI(false);
});

document.getElementById('btnRefresh')?.addEventListener('click', refresh);

document.getElementById('btnDriverLogin2')?.addEventListener('click', async ()=>{
  const u = norm(document.getElementById('driverUser')?.value || '');
  const p = norm(document.getElementById('driverPass')?.value || '');
  try{
    const res = await loginDriver(u, p);
    // loginDriver setzt session bereits; wir refreshen nur UI
    document.getElementById('driverPass').value = '';
    refresh();
  }catch(e){
    alert(e?.message || String(e));
  }
});

// Start
refresh();