import { state } from './state.js';
import { $, norm, lowerKeys, debounce } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';

function key(){
  const uid = mustUser(state);
  return scopedKey(uid, "customers_v1");
}

function makeId(){
  return crypto.randomUUID?.() || String(Date.now())+Math.random();
}

function computeDerived(c){
  c.firmenname = norm(c.firmenname);
  c.adresse = norm(c.adresse);
  c.postleitzahl = norm(c.postleitzahl);
  c.ort = norm(c.ort);
  c.land = norm(c.land) || "Österreich";
  c.bezirk = norm(c.bezirk);

  // PLZ->Wien Bezirk
  const plz4 = c.postleitzahl.replace(/\D/g,"").slice(0,4);
  if (plz4 && plz4.startsWith("1")){
    if (!c.ort) c.ort = "Wien";
    const bez = plz4.slice(1,3); // 1010 -> 01
    const n = parseInt(bez, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 23){
      if (!c.bezirk) c.bezirk = String(n);
    }
  }

  // __address display
  const parts = [];
  if (c.firmenname) parts.push(c.firmenname);
  if (c.adresse) parts.push(c.adresse);
  const plzort = [c.postleitzahl, c.ort].filter(Boolean).join(" ").trim();
  if (plzort) parts.push(plzort);
  if (c.land) parts.push(c.land);
  c.__address = parts.join(", ");

  // __addressGeo
  const geo = [];
  if (c.adresse) geo.push(c.adresse);
  const city = plz4.startsWith("1") ? "Wien" : c.ort;
  const plzCity = [plz4, city].filter(Boolean).join(" ").trim();
  if (plzCity) geo.push(plzCity);
  geo.push(c.land || "Österreich");
  c.__addressGeo = geo.filter(Boolean).join(", ");
}

export function loadCustomers(){
  state.customers = getJson(key(), []);
  // backwards compatible: ensure openInvoices exists
  for (const c of state.customers){
    if (c.openInvoices === undefined) c.openInvoices = 0;
  }
  for (const c of state.customers) computeDerived(c);
}

export function saveCustomers(){
  setJson(key(), state.customers);
}

export function parseCustomersFromExcel(file){
  // requires global XLSX loaded
  return file.arrayBuffer().then(buf=>{
    const wb = XLSX.read(buf, { type:"array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval:"" });
    const rows = raw.map(r=>lowerKeys(r));

    const pick = (r, ...keys) => {
      for (const k of keys){
        if (r[k] !== undefined && String(r[k]).trim() !== "") return r[k];
      }
      return "";
    };

    const out = rows.map(r=>{
      const c = {
        id: makeId(),
        today: false,
        firmenname: pick(r, "firmenname","firma","name"),
        adresse: pick(r, "adresse","straße","strasse"),
        postleitzahl: pick(r, "postleitzahl","plz"),
        ort: pick(r, "ort","stadt","city"),
        land: pick(r, "land","country"),
        bezirk: pick(r, "bezirk","district"),
        openInvoices: Number(pick(r, "offenerechnungen","offene rechnungen","rechnungen","invoices","openinvoices")) || 0,
      };
      computeDerived(c);
      return c;
    });
    return out;
  });
}

function filteredCustomers(){
  const q = norm($("custSearch").value).toLowerCase();
  const onlyToday = $("onlyToday").checked;
  return state.customers.filter(c=>{
    if (onlyToday && !c.today) return false;
    if (!q) return true;
    const hay = `${c.firmenname} ${c.adresse} ${c.postleitzahl} ${c.ort} ${c.land} ${c.bezirk}`.toLowerCase();
    return hay.includes(q);
  });
}

export function getTodayCustomers(){
  return state.customers.filter(c=>!!c.today);
}

export function initCustomersPage(onAnyChange){
  const tb = $("customersTbody");

  if (!state.customerSelectedIds) state.customerSelectedIds = new Set();

  const rerender = () => {
    renderCustomersTable();
    onAnyChange?.();
  };

  $("customersExcel").addEventListener("change", async ()=>{
    const f = $("customersExcel").files?.[0];
    if (!f) return;
    try{
      const list = await parseCustomersFromExcel(f);
      state.customers = list;
      saveCustomers();
      rerender();
      alert(`✅ Importiert: ${list.length} Kunden`);
    }catch(e){
      alert("❌ Excel Import Fehler: " + (e.message || String(e)));
    }finally{
      $("customersExcel").value = "";
    }
  });

  $("btnAddCustomerRow").addEventListener("click", ()=>{
    const c = { id: makeId(), today:false, firmenname:"", adresse:"", postleitzahl:"", ort:"", land:"Österreich", bezirk:"" };
    computeDerived(c);
    state.customers.push(c);
    saveCustomers();
    rerender();
    setTimeout(()=>tb.parentElement?.scrollTo({ top: 999999, behavior:"smooth" }), 0);
  });

  $("btnDeleteCustomerRows").addEventListener("click", ()=>{
    const delIds = new Set(Array.from(state.customerSelectedIds || []));
    if (!delIds.size) return alert("Bitte Zeilen anklicken (markieren).");
    if (!confirm(`Ausgewählte Kunden löschen (${delIds.size})?`)) return;
    state.customers = state.customers.filter(c=>!delIds.has(c.id));
    state.customerSelectedIds.clear();
    saveCustomers();
    rerender();
  });

  $("btnSaveCustomers").addEventListener("click", ()=>{
    readTableToState();
    saveCustomers();
    rerender();
    alert("💾 Gespeichert");
  });

  $("btnCheckDups").addEventListener("click", ()=>{
    markDuplicates();
  });

  $("btnRemoveDups").addEventListener("click", ()=>{
    const removed = removeDuplicates();
    saveCustomers();
    rerender();
    alert(`🧽 Duplikate entfernt: ${removed}`);
  });

  $("custSearch").addEventListener("input", debounce(()=>rerender(), 120));
  $("onlyToday").addEventListener("change", rerender);

  // paste TSV rows into tbody
  tb.addEventListener("paste", (e)=>{
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    if (text.includes("\t") || text.includes("\n")){
      e.preventDefault();
      pasteTsv(text);
      saveCustomers();
      rerender();
    }
  });

  renderCustomersTable();
}

function renderCustomersTable(){
  const tb = $("customersTbody");
  tb.innerHTML = "";

  const list = filteredCustomers();
  for (const c of list){
    const tr = document.createElement("tr");
    tr.dataset.id = c.id;
    tr.classList.toggle('rowselected', state.customerSelectedIds?.has(String(c.id)));
    tr.innerHTML = `
      <td><input class="todaychk" type="checkbox" data-today="${c.id}" ${c.today ? "checked":""}></td>
      <td><div class="cell" contenteditable data-f="firmenname" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="adresse" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="postleitzahl" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="ort" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="land" data-id="${c.id}"></div></td>
      <td><div class="cell" contenteditable data-f="bezirk" data-id="${c.id}"></div></td>
    `;
    tb.appendChild(tr);

    tr.querySelector('[data-f="firmenname"]').textContent = c.firmenname || "";
    tr.querySelector('[data-f="adresse"]').textContent = c.adresse || "";
    tr.querySelector('[data-f="postleitzahl"]').textContent = c.postleitzahl || "";
    tr.querySelector('[data-f="ort"]').textContent = c.ort || "";
    tr.querySelector('[data-f="land"]').textContent = c.land || "";
    tr.querySelector('[data-f="bezirk"]').textContent = c.bezirk || "";

    // row select (for delete)
    tr.addEventListener('click', (e)=>{
      // don't toggle selection when clicking the today checkbox
      if (e.target && e.target.matches('input.todaychk')) return;
      const id = String(c.id);
      const set = state.customerSelectedIds;
      if (set.has(id)) set.delete(id); else set.add(id);
      tr.classList.toggle('rowselected', set.has(id));
    });

    // today checkbox
    tr.querySelector('[data-today]')?.addEventListener("change", (e)=>{
      const id = e.target.dataset.today;
      const cc = state.customers.find(x=>x.id===id);
      if (!cc) return;
      cc.today = !!e.target.checked;
      saveCustomers();
      // KPI update handled outside
    });

    // blur update for cells
    tr.querySelectorAll(".cell").forEach(cell=>{
      cell.addEventListener("blur", ()=>{
        const id = cell.dataset.id;
        const f = cell.dataset.f;
        const cc = state.customers.find(x=>x.id===id);
        if (!cc) return;
        if (f === 'openInvoices'){
          const n = Number(String(cell.textContent || '').replace(',', '.'));
          cc.openInvoices = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
          cell.textContent = String(cc.openInvoices);
        } else {
          cc[f] = norm(cell.textContent);
        }
        computeDerived(cc);
        saveCustomers();
      });
    });
  }

  $("customersCountPill").textContent = `${state.customers.length} Kunden`;
}

function readTableToState(){
  const cells = Array.from(document.querySelectorAll("#customersTbody .cell"));
  const byId = new Map();
  for (const el of cells){
    const id = el.dataset.id;
    const f = el.dataset.f;
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)[f] = norm(el.textContent);
  }

  state.customers = state.customers.map(c=>{
    const upd = byId.get(c.id);
    if (!upd) return c;
    const merged = { ...c, ...upd };
    if (merged.openInvoices !== undefined){
      const n = Number(String(merged.openInvoices || '').replace(',', '.'));
      merged.openInvoices = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }
    computeDerived(merged);
    return merged;
  });

  // today checkbox state
  const todays = Array.from(document.querySelectorAll("#customersTbody [data-today]"));
  for (const el of todays){
    const id = el.dataset.today;
    const cc = state.customers.find(x=>x.id===id);
    if (cc) cc.today = el.checked;
  }
}

function normKey(c){
  const name = norm(c.firmenname).toLowerCase();
  const addr = norm(c.adresse).toLowerCase();
  const plz = norm(c.postleitzahl).replace(/\D/g,"").slice(0,4);
  return `${name}|${addr}|${plz}`;
}

function markDuplicates(){
  const rows = Array.from(document.querySelectorAll("#customersTbody tr"));
  rows.forEach(r=>r.classList.remove("dup"));

  const seen = new Map();
  for (const c of state.customers){
    const k = normKey(c);
    if (!k.replaceAll("|","")) continue;
    seen.set(k, (seen.get(k)||0)+1);
  }
  const dups = new Set(Array.from(seen.entries()).filter(([,v])=>v>1).map(([k])=>k));

  for (const r of rows){
    const id = r.dataset.id;
    const c = state.customers.find(x=>x.id===id);
    if (!c) continue;
    if (dups.has(normKey(c))) r.classList.add("dup");
  }
}

function removeDuplicates(){
  const seen = new Set();
  let removed = 0;
  const out = [];
  for (const c of state.customers){
    const k = normKey(c);
    if (!k.replaceAll("|","")) { out.push(c); continue; }
    if (seen.has(k)){ removed++; continue; }
    seen.add(k);
    out.push(c);
  }
  state.customers = out;
  return removed;
}

function pasteTsv(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim()!=="");
  for (const line of lines){
    const cols = line.split("\t");
    const c = { id: makeId(), today:false,
      firmenname: cols[0] ?? "",
      adresse: cols[1] ?? "",
      postleitzahl: cols[2] ?? "",
      ort: cols[3] ?? "",
      land: cols[4] ?? "Österreich",
      bezirk: cols[5] ?? "",
    };
    computeDerived(c);
    state.customers.push(c);
  }
}
