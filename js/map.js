import { state } from './state.js';
import { $, esc, norm } from './utils.js';

let map = null;
let markersLayer = null;
let routeLayer = null;

export function initMap(){
  map = L.map('map', { zoomControl:true }).setView([48.2082, 16.3738], 11);
  // Better looking basemap (Carto Voyager)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  routeLayer = L.geoJSON(null, {
    weight: 6,
    opacity: 0.9,
  }).addTo(map);
}

export function clearMap(){
  markersLayer?.clearLayers();
  routeLayer?.clearLayers();
  updateMapList([], []);
}

export function zoomVienna(){
  map.setView([48.2082, 16.3738], 11, { animate:true });
}

export function renderMapFromStops(stops, geojson=null){
  if (!map) return;
  markersLayer.clearLayers();
  routeLayer.clearLayers();

  const markers = [];
  for (let i=0;i<stops.length;i++){
    const s = stops[i];
    if (Number.isFinite(s.lat) && Number.isFinite(s.lon)){
      const m = L.marker([s.lat, s.lon]).addTo(markersLayer);
      m.bindTooltip(`${i+1}. ${s.label || ""}`, { permanent:false });
      markers.push(m);
    } else {
      markers.push(null);
    }
  }

  if (geojson){
    routeLayer.addData(geojson);
    try{
      const b = routeLayer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.2));
    }catch{}
  }else{
    // fit to markers
    const latlngs = markers.filter(Boolean).map(m=>m.getLatLng());
    if (latlngs.length){
      const b = L.latLngBounds(latlngs);
      map.fitBounds(b.pad(0.2));
    }
  }

  updateMapList(stops, markers);
}

// Show customers as pins (used on Start map when no driver/route is selected)
export function renderMapFromCustomers(customers){
  if (!map) return;
  markersLayer.clearLayers();
  routeLayer.clearLayers();

  const list = (customers || []).slice();
  const markers = [];

  const toAddress = (c) => {
    // Build a stable address string for geoCache lookup
    const city = [c.postleitzahl, c.ort].filter(Boolean).join(' ').trim();
    return [c.adresse, city, c.land].filter(Boolean).join(', ').trim();
  };

  for (const c of list){
    const addr = toAddress(c);
    const key = norm(addr);
    const g = state.geoCache?.[key] || null;
    const lat = g?.lat;
    const lon = g?.lon;
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      const name = c.firmenname || '(ohne Name)';
      const m = L.circleMarker([lat, lon], {
        radius: 7,
        weight: 2,
        fillOpacity: 0.85,
      }).addTo(markersLayer);
      m.bindTooltip(`${esc(name)}`, { permanent:false });
      markers.push(m);
    } else {
      markers.push(null);
    }
  }

  // Fit map to markers
  const latlngs = markers.filter(Boolean).map(m=>m.getLatLng());
  if (latlngs.length){
    const b = L.latLngBounds(latlngs);
    map.fitBounds(b.pad(0.2));
  }

  // Reuse list UI: show customers (no numbering)
  const stopsLike = list.map(c=>({
    label: c.firmenname || '(ohne Name)',
    address: toAddress(c),
  }));
  updateMapList(stopsLike, markers);
}

function updateMapList(stops, markersRef){
  const host = document.getElementById("mapList");
  if (!host) return;

  host.innerHTML = "";
  if (!stops.length){
    host.innerHTML = `<div class="tiny muted">Keine Stops. Wähle Kunden (Heute) → Zuweisen → Route erstellen.</div>`;
    return;
  }

  for (let i=0;i<stops.length;i++){
    const s = stops[i];
    const row = document.createElement("div");
    row.className = "maprow";
    row.innerHTML = `
      <div class="maprow-nr">${i+1}</div>
      <div class="maprow-txt">
        <div class="maprow-title">${esc(s.label || "")}</div>
        <div class="maprow-addr">${esc(s.address || "")}</div>
      </div>
    `;
    row.addEventListener("click", () => {
      const m = markersRef?.[i];
      if (m && typeof m.getLatLng === "function"){
        const ll = m.getLatLng();
        map.setView(ll, Math.max(map.getZoom(), 15), { animate:true });
        m.openTooltip?.();
      }
    });
    host.appendChild(row);
  }
}
