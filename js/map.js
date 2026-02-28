import { state } from './state.js';
import { $, esc, norm } from './utils.js';

let map = null;
let markersLayer = null;
let routeLayer = null;

export function initMap(){
  map = L.map('map', { zoomControl:true }).setView([48.2082, 16.3738], 11);

  // store for other modules (invalidateSize)
  state.map = map;

  // Better looking basemap (Carto Voyager)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // Use a simple layerGroup so we can draw either GeoJSON OR a polyline fallback
  routeLayer = L.layerGroup().addTo(map);
}

export function invalidateMapSize(){
  // Leaflet needs this when the map container was hidden and becomes visible again
  if (map) map.invalidateSize(true);
}

export function clearMap(){
  markersLayer?.clearLayers();
  routeLayer?.clearLayers();
  updateMapList([], []);
}

export function zoomVienna(){
  if (!map) return;
  map.setView([48.2082, 16.3738], 11, { animate:true });
}

// ✅ Route: markers + polyline ONLY here (selected driver)
export function renderMapFromStops(stops, geojson=null){
  if (!map) return;

  markersLayer.clearLayers();
  routeLayer.clearLayers();

  const markers = [];
  const latlngs = [];

  for (let i=0;i<(stops||[]).length;i++){
    const s = stops[i];
    const lat = Number(s.lat ?? s.latitude);
    const lon = Number(s.lon ?? s.lng ?? s.longitude);

    if (Number.isFinite(lat) && Number.isFinite(lon)){
      const ll = [lat, lon];
      latlngs.push(ll);

      const m = L.marker(ll).addTo(markersLayer);
      m.bindTooltip(`${i+1}. ${s.label || ""}`, { permanent:false });
      markers.push(m);
    } else {
      markers.push(null);
    }
  }

  // ✅ Polyline: prefer geojson; fallback to simple polyline from stop coordinates
  if (geojson){
    try{
      const gj = L.geoJSON(geojson, { weight: 6, opacity: 0.9 });
      gj.addTo(routeLayer);

      const b = gj.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.2));
    }catch{
      // fallback below
      if (latlngs.length >= 2){
        const pl = L.polyline(latlngs, { weight: 6, opacity: 0.9 });
        pl.addTo(routeLayer);
        map.fitBounds(pl.getBounds().pad(0.2));
      }
    }
  } else {
    // fallback polyline (still ONLY for selected driver)
    if (latlngs.length >= 2){
      const pl = L.polyline(latlngs, { weight: 6, opacity: 0.9 });
      pl.addTo(routeLayer);
      map.fitBounds(pl.getBounds().pad(0.2));
    } else if (latlngs.length){
      const b = L.latLngBounds(latlngs);
      map.fitBounds(b.pad(0.2));
    }
  }

  updateMapList(stops || [], markers);
}

// ✅ Customers: ONLY pins, NEVER polyline (no selected driver)
export function renderMapFromCustomers(customers){
  if (!map) return;

  markersLayer.clearLayers();
  routeLayer.clearLayers(); // ensure no leftover route line

  const list = (customers || []).slice();
  const markers = [];

  const toAddress = (c) => {
    const city = [c.postleitzahl, c.ort].filter(Boolean).join(' ').trim();
    return [c.adresse, city, c.land].filter(Boolean).join(', ').trim();
  };

  for (const c of list){
    const addr = toAddress(c);
    const key = norm(addr);
    const g = state.geoCache?.[key] || null;

    const lat = Number(g?.lat);
    const lon = Number(g?.lon);

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

  // List UI: show customers (no route line)
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