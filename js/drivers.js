import { state } from './state.js';
import { $, norm } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';
import { upsertDriverAccount, removeDriverAccount } from './auth.js';

// ✅ Callback für Änderungen (wird in initDriversPage gesetzt)
let onAnyChangeCb = null;
function fireAnyChange(){
  try { onAnyChangeCb?.(); } catch (e) { console.warn(e); }
  try { window.dispatchEvent(new Event('drivers:updated')); } catch (e) { /* ignore */ }
}

function key(){
  const uid = mustUser(state);
  return scopedKey(uid, "drivers_v1");
}

function makeId(){
  return crypto.randomUUID?.() || String(Date.now()) + Math.random();
}

export function loadDrivers(){
  state.drivers = getJson(key(), []);
}

export function saveDrivers(){
  setJson(key(), state.drivers);
}

export function initDriversPage(onAnyChange){
  onAnyChangeCb = typeof onAnyChange === "function" ? onAnyChange : null;

  $("btnAddDriver").addEventListener("click", ()=>{
    state.drivers.push({ id: makeId(), name:"", car:"", note:"", username:"" });
    saveDrivers();
    renderDriversTable();
    fireAnyChange();
  });

  $("btnDeleteDriver").addEventListener("click", ()=>{
    const tb = $("driversTbody");
    const checks = Array.from(tb.querySelectorAll('input.rowchk'));
    const delIds = new Set(checks.filter(x=>x.checked).map(x=>String(x.dataset.id)));
    if (!delIds.size) return alert("Bitte Fahrer markieren.");

    const ownerId = mustUser(state);

    // ✅ remove from global driver login index too
    for (const id of delIds){
      removeDriverAccount(ownerId, id);
    }

    state.drivers = state.drivers.filter(d=>!delIds.has(String(d.id)));
    saveDrivers();
    renderDriversTable();
    fireAnyChange();
  });

  // ✅ WICHTIG: Beim "Speichern" alle Fahrer-Credentials syncen
  $("btnSaveDrivers").addEventListener("click", async ()=>{
    readDriversToState();
    saveDrivers();

    // sync usernames into global driver login store
    for (const d of (state.drivers || [])){
      await syncOneDriverCredentials(d, null);
    }

    renderDriversTable();
    fireAnyChange();
    alert("💾 Fahrer gespeichert");
  });

  renderDriversTable();
}

export function renderDriversTable(){
  const tb = $("driversTbody");
  tb.innerHTML = "";

  for (const d of state.drivers){
    const tr = document.createElement("tr");
    tr.dataset.id = d.id;
    tr.innerHTML = `
      <td><input class="rowchk" type="checkbox" data-id="${d.id}"></td>
      <td><div class="cell" contenteditable data-f="name" data-id="${d.id}"></div></td>
      <td><div class="cell" contenteditable data-f="car" data-id="${d.id}"></div></td>
      <td><div class="cell" contenteditable data-f="note" data-id="${d.id}"></div></td>
      <td><input class="input tinyin" data-f="username" data-id="${d.id}" placeholder="fahrer01" autocomplete="off"></td>
      <td><input class="input tinyin" data-f="password" data-id="${d.id}" placeholder="neu setzen" type="password" autocomplete="new-password"></td>
    `;
    tb.appendChild(tr);

    tr.querySelector('[data-f="name"]').textContent = d.name || "";
    tr.querySelector('[data-f="car"]').textContent = d.car || "";
    tr.querySelector('[data-f="note"]').textContent = d.note || "";
    tr.querySelector('[data-f="username"]').value = d.username || "";

    tr.querySelectorAll(".cell").forEach(cell=>{
      cell.addEventListener("blur", ()=>{
        const id = String(cell.dataset.id || '');
        const f = String(cell.dataset.f || '');
        const dd = state.drivers.find(x=>String(x.id)===id);
        if (!dd) return;

        dd[f] = norm(cell.textContent);
        saveDrivers();

        // sync (username already existing)
        syncOneDriverCredentials(dd, null).catch(e=>console.warn(e));
        fireAnyChange();
      });
    });

    tr.querySelectorAll('input[data-f]').forEach(inp=>{
      inp.addEventListener('change', async ()=>{
        const id = String(inp.dataset.id || '');
        const f = String(inp.dataset.f || '');
        const dd = state.drivers.find(x=>String(x.id)===id);
        if (!dd) return;

        if (f === 'username'){
          dd.username = norm(inp.value);
          saveDrivers();
          await syncOneDriverCredentials(dd, null);
          fireAnyChange();
          return;
        }

        if (f === 'password'){
          const pw = norm(inp.value);
          if (!pw) return;
          inp.value = '';
          await syncOneDriverCredentials(dd, pw);
          fireAnyChange();
          alert('🔐 Fahrer-Passwort gespeichert');
        }
      });
    });
  }

  $("driversCountPill").textContent = `${state.drivers.length} Fahrer`;
}

function readDriversToState(){
  const cells = Array.from(document.querySelectorAll("#driversTbody .cell"));
  const inputs = Array.from(document.querySelectorAll("#driversTbody input[data-f]"));
  const byId = new Map();

  for (const el of cells){
    const id = String(el.dataset.id || '');
    const f = String(el.dataset.f || '');
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)[f] = norm(el.textContent);
  }

  for (const el of inputs){
    const id = String(el.dataset.id || '');
    const f = String(el.dataset.f || '');
    if (!id || !f) continue;
    if (!byId.has(id)) byId.set(id, {});
    if (f === 'username') byId.get(id).username = norm(el.value);
  }

  state.drivers = state.drivers.map(d => ({ ...d, ...(byId.get(String(d.id)) || {}) }));
}

async function syncOneDriverCredentials(driver, passwordOrNull = null){
  try{
    const ownerId = mustUser(state);

    driver.username = norm(driver.username).toLowerCase();

    // ✅ without username no login account (but driver can still exist)
    if (!driver.username) return;

    await upsertDriverAccount(ownerId, String(driver.id), driver.username, passwordOrNull, driver.name || '');
  }catch(e){
    if (passwordOrNull) alert(e.message || String(e));
    else console.warn(e);
  }
}