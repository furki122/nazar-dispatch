import { state } from "./state.js";
import { norm } from "./utils.js";
import { saveCustomers } from "./customers.js";
import { saveGeoCache } from "./geocode.js"; // ✅ wichtig

function $(id){ return document.getElementById(id); }

let isOpen = false;
let currentCustomerId = null;
let picked = null; // { formatted, plz, city, country, lat, lon }

// ✅ Promise resolver, damit route.js warten kann
let resolver = null;

function safeText(x){ return (x ?? "").toString().trim(); }

function pickFromPlace(place){
  const out = { formatted:"", plz:"", city:"", country:"", lat:null, lon:null };

  out.formatted = safeText(place?.formattedAddress || place?.formatted_address || "");

  try{
    const loc = place?.location || place?.geometry?.location;
    if (loc){
      const lat = typeof loc.lat === "function" ? loc.lat() : loc.lat;
      const lng = typeof loc.lng === "function" ? loc.lng() : (loc.lng ?? loc.lon ?? loc.longitude);
      if (Number.isFinite(lat)) out.lat = Number(lat);
      if (Number.isFinite(lng)) out.lon = Number(lng);
    }
  }catch{}

  const comps = place?.addressComponents || place?.address_components || [];
  const get = (type) => {
    const c = comps.find(c => Array.isArray(c.types) && c.types.includes(type));
    return safeText(c?.longText || c?.long_name || "");
  };

  out.plz = get("postal_code");
  out.city = get("locality") || get("postal_town") || get("administrative_area_level_2");
  out.country = get("country");

  return out;
}

function updateStatus(msg){
  const status = $("addrFixStatus");
  if (status) status.textContent = msg;
}

function enableSave(enabled){
  const btnSave = $("addrFixSave");
  if (btnSave) btnSave.disabled = !enabled;
}

function getManualValue(){
  const el = $("addrFixAuto");
  if (!el) return "";
  if (typeof el.value === "string") return el.value;
  const attr = el.getAttribute("value");
  return attr || "";
}

// ✅ schreibt in Customer + geoCache
function applyToCustomer(customer, data){
  const formatted = norm(data.formatted || "");
  if (!formatted) return false;

  customer.adresse = formatted;
  customer.__address = formatted;
  customer.__addressGeo = formatted;

  if (data.plz) customer.postleitzahl = String(data.plz);
  if (data.city) customer.ort = String(data.city);
  if (data.country) customer.land = String(data.country);

  if (Number.isFinite(data.lat) && Number.isFinite(data.lon)){
    customer.lat = Number(data.lat);
    customer.lon = Number(data.lon);

    // ✅ super wichtig: auch in geoCache speichern damit geocodeAddress sofort Treffer hat
    state.geoCache = state.geoCache || {};
    state.geoCache[formatted] = { lat: customer.lat, lon: customer.lon, ts: Date.now() };
    saveGeoCache?.();
  }

  return true;
}

export function initAddressFixModal(){
  const overlay = $("addrFixOverlay");
  const btnSave = $("addrFixSave");
  const btnCancel = $("addrFixCancel");
  const hint = $("addrFixHint");
  const auto = $("addrFixAuto");

  if (!overlay || !btnSave || !btnCancel || !hint || !auto){
    console.warn("AddressFixModal: Modal elements missing. Check index.html IDs.");
    return;
  }

  // Cancel
  btnCancel.addEventListener("click", ()=>closeModal(false));
  window.addEventListener("keydown", (e)=>{
    if (e.key === "Escape" && isOpen) closeModal(false);
  });

  // manual typing => allow save
  const manualWatcher = () => {
    if (!isOpen) return;
    const v = norm(getManualValue());
    if (v && !picked){
      enableSave(true);
      updateStatus("✍️ Manuell eingegeben – Speichern möglich");
    } else if (!v && !picked){
      enableSave(false);
      updateStatus("Warte auf Auswahl…");
    }
  };

  auto.addEventListener("input", manualWatcher);
  auto.addEventListener("change", manualWatcher);

  // Google place selection
  auto.addEventListener("gmp-placeselect", async (ev) => {
    try{
      picked = null;
      enableSave(false);
      updateStatus("⏳ Adresse wird geladen…");

      const place = ev?.place;
      if (!place){
        updateStatus("⚠️ Keine Place-Daten");
        enableSave(!!norm(getManualValue()));
        return;
      }

      let details = place;
      if (typeof place.fetchFields === "function"){
        try{
          const r = await place.fetchFields({
            fields: ["formattedAddress","location","addressComponents"]
          });
          details = r || place;
        }catch(err){
          console.warn("fetchFields failed:", err);
          updateStatus("⚠️ Google Places nicht verfügbar (403). Bitte Adresse manuell eingeben.");
          enableSave(!!norm(getManualValue()));
          return;
        }
      }

      const data = pickFromPlace(details);
      const fallbackText = norm(getManualValue());
      if (!data.formatted && fallbackText) data.formatted = fallbackText;

      picked = data;

      if (picked?.formatted){
        updateStatus("✅ Adresse gewählt");
        enableSave(true);
      }else{
        updateStatus("⚠️ Bitte Adresse auswählen oder eintippen");
        enableSave(!!fallbackText);
      }
    }catch(err){
      console.warn("Place select error:", err);
      picked = null;
      updateStatus("⚠️ Fehler bei Auswahl – bitte manuell eingeben");
      enableSave(!!norm(getManualValue()));
    }
  });

  // Save
  btnSave.addEventListener("click", ()=>{
    if (!currentCustomerId) return;

    const customer = (state.customers || []).find(x => String(x.id) === String(currentCustomerId));
    if (!customer){
      closeModal(false);
      return;
    }

    const manual = norm(getManualValue());
    const data = picked?.formatted ? picked : (manual ? { formatted: manual } : null);

    if (!data?.formatted){
      updateStatus("⚠️ Bitte Adresse eingeben");
      enableSave(false);
      return;
    }

    const ok = applyToCustomer(customer, data);
    if (!ok){
      updateStatus("⚠️ Adresse ungültig");
      return;
    }

    saveCustomers?.();

    window.dispatchEvent(new CustomEvent("customers:updated", { detail: { customerId: currentCustomerId } }));

    // ✅ resolve true = gespeichert
    closeModal(true);
  });
}

// ✅ neue async open-Funktion: route.js kann awaiten
export function openAddressFixModal(customer, reasonText){
  const overlay = $("addrFixOverlay");
  const hint = $("addrFixHint");
  const auto = $("addrFixAuto");

  if (!overlay || !hint || !auto) return;

  isOpen = true;
  currentCustomerId = String(customer?.id || "");
  picked = null;

  const original = norm(customer?.adresse || customer?.__addressGeo || customer?.__address || "");
  if (typeof auto.value === "string") auto.value = original;
  else auto.setAttribute("value", original);

  hint.textContent = `Nicht gefunden: ${reasonText || ""}\nKunde: ${customer?.firmenname || ""}`;
  updateStatus("Warte auf Auswahl…");
  enableSave(!!original);

  overlay.classList.remove("hidden");
}

// ✅ Promise wrapper
export function openAddressFixModalAsync(customer, reasonText){
  openAddressFixModal(customer, reasonText);
  return new Promise((resolve)=>{
    resolver = resolve; // true/false
  });
}

export function closeModal(saved){
  const overlay = $("addrFixOverlay");
  if (overlay) overlay.classList.add("hidden");

  const r = resolver;
  resolver = null;

  isOpen = false;
  currentCustomerId = null;
  picked = null;

  // resolve promise after close
  if (typeof r === "function") r(!!saved);
}