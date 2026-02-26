import { state } from './state.js';
import { $, norm } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';
import { clearGeoCache } from './geocode.js';

function key(){
  const uid = mustUser(state);
  return scopedKey(uid, "settings_v1");
}

export function loadSettings(){
  const s = getJson(key(), null);
  if (s){
    state.settings = { ...state.settings, ...s };
  }
}

export function saveSettings(){
  setJson(key(), state.settings);
}

export function initSettingsPage(onAnyChange){
  $("btnSaveSettings").addEventListener("click", ()=>{
    state.settings.startAddress = norm($("setStartAddress").value) || state.settings.startAddress;
    state.settings.routingEngine = $("routingEngine").value || "osrm";
    saveSettings();
    $("startAddress").value = state.settings.startAddress;
    onAnyChange?.();
    alert("💾 Settings gespeichert");
  });

  $("btnClearGeoCache").addEventListener("click", ()=>{
    if (!confirm("Geocache löschen? Danach wird neu geocodet.")) return;
    clearGeoCache();
    alert("🧹 Geocache gelöscht");
  });
}

export function renderSettings(){
  $("setStartAddress").value = state.settings.startAddress || "";
  $("routingEngine").value = state.settings.routingEngine || "osrm";
}
