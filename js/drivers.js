import { state } from './state.js';
import { $, norm } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';
import { upsertDriverAccount } from './auth.js';

// ✅ Callback für Änderungen (wird in initDriversPage gesetzt)
let onAnyChangeCb = null;
function fireAnyChange(){
  try { onAnyChangeCb?.(); } catch (e) { console.warn(e); }
  // let other pages (chat) refresh their driver lists
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
  // ✅ merken für renderDriversTable() usw.
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
    const delIds = new Set(checks.filter(x=>x.checked).map(x=>x.dataset.id));
    if (!delIds.size) return alert("Bitte Fahrer markieren.");
    state.drivers = state.drivers.filter(d=>!delIds.has(d.id));
    saveDrivers();
    renderDriversTable();
    fireAnyChange();
  });

  $("btnSaveDrivers").addEventListener("click", ()=>{
    readDriversToState();
    saveDrivers();
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
        const id = cell.dataset.id;
        const f = cell.dataset.f;
        const dd = state.drivers.find(x=>x.id===id);
        if (!dd) return;

        dd[f] = norm(cell.textContent);
        saveDrivers();
        // also sync credentials if username/password was set previously
        syncOneDriverCredentials(dd).catch(e=>console.warn(e));
        fireAnyChange();
      });
    });

    // username/password inputs
    tr.querySelectorAll('input[data-f]').forEach(inp=>{
      inp.addEventListener('change', async ()=>{
        const id = inp.dataset.id;
        const f = inp.dataset.f;
        const dd = state.drivers.find(x=>x.id===id);
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
          if (!pw) return; // empty means "don't change"
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
    const id = el.dataset.id;
    const f = el.dataset.f;
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)[f] = norm(el.textContent);
  }

  for (const el of inputs){
    const id = el.dataset.id;
    const f = el.dataset.f;
    if (!id || !f) continue;
    if (!byId.has(id)) byId.set(id, {});
    if (f === 'username') byId.get(id).username = norm(el.value);
    // password is not stored in state from UI table (only via sync)
  }

  state.drivers = state.drivers.map(d => ({ ...d, ...(byId.get(d.id) || {}) }));
}

async function syncOneDriverCredentials(driver, passwordOrNull = null){
  try{
    const ownerId = mustUser(state);
    await upsertDriverAccount(ownerId, driver.id, driver.username || '', passwordOrNull, driver.name || '');
  }catch(e){
    // show only if user actively tries to set credentials
    if (passwordOrNull) alert(e.message || String(e));
    else console.warn(e);
  }
}