import { state } from './state.js';
import { $, norm } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';

function keyCars(){
  const uid = mustUser(state);
  return scopedKey(uid, 'cars_v1');
}

function makeId(){
  return crypto.randomUUID?.() || String(Date.now()) + Math.random();
}

export function loadCars(){
  state.cars = getJson(keyCars(), []) || [];
}

export function saveCars(){
  setJson(keyCars(), state.cars || []);
}

export function renderCarsTable(){
  const tb = $('carsTbody');
  if (!tb) return;
  tb.innerHTML = '';

  const sel = state.carSelectedIds || new Set();
  state.carSelectedIds = sel;

  (state.cars || []).forEach((c, idx)=>{
    const tr = document.createElement('tr');
    tr.dataset.id = String(c.id);
    tr.className = sel.has(String(c.id)) ? 'rowselected' : '';
    tr.innerHTML = `
      <td class="tiny mono">${idx+1}</td>
      <td><div class="cell" contenteditable data-f="nickname" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="brand" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="plate" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="type" data-id="${c.id}"></div></td>
    `;
    tb.appendChild(tr);

    tr.querySelector('[data-f="nickname"]').textContent = c.nickname || '';
    tr.querySelector('[data-f="brand"]').textContent = c.brand || '';
    tr.querySelector('[data-f="plate"]').textContent = c.plate || '';
    tr.querySelector('[data-f="type"]').textContent = c.type || '';

    tr.addEventListener('pointerdown', (e)=>{
      // Don't toggle selection when the user clicks into an editable cell
      if (e.target && e.target.closest && e.target.closest('.cell')) return;
      const id = String(c.id);
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      renderCarsTable();
    });

    tr.querySelectorAll('.cell').forEach(cell=>{
      cell.addEventListener('blur', ()=>{
        const id = String(cell.dataset.id);
        const f = String(cell.dataset.f);
        const cc = (state.cars || []).find(x=>String(x.id)===id);
        if (!cc) return;
        cc[f] = norm(cell.textContent);
        saveCars();
      });
    });
  });

  $('carsCountPill').textContent = `${(state.cars || []).length} Autos`;
}

export function initCarsPage(onAnyChange){
  state.carSelectedIds = state.carSelectedIds || new Set();

  $('btnAddCar')?.addEventListener('click', ()=>{
    state.cars = state.cars || [];
    state.cars.push({ id: makeId(), nickname:'', brand:'', plate:'', type:'' });
    saveCars();
    renderCarsTable();
    onAnyChange?.();
  });

  $('btnDeleteCar')?.addEventListener('click', ()=>{
    const sel = state.carSelectedIds || new Set();
    if (!sel.size) return alert('Bitte Zeilen anklicken (markieren).');
    if (!confirm('Ausgewählte Autos löschen?')) return;
    state.cars = (state.cars || []).filter(c=>!sel.has(String(c.id)));
    sel.clear();
    saveCars();
    renderCarsTable();
    onAnyChange?.();
  });

  $('btnSaveCars')?.addEventListener('click', ()=>{
    saveCars();
    renderCarsTable();
    onAnyChange?.();
    alert('💾 Gespeichert');
  });

  renderCarsTable();
}
