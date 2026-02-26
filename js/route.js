import { state } from "./state.js";
import { norm } from "./utils.js";
import { geocodeAddress } from "./geocode.js";
import { openAddressFixModalAsync } from "./addressFixModal.js";

function findCustomer(cid){
  const id = String(cid);
  return (state.customers || []).find(x => String(x.id) === id);
}

function getCustomerAddress(c){
  // bevorzugt die “gefixte” adresse
  return norm(c.__addressGeo || c.__address || c.adresse || "");
}

async function ensureCoordsForCustomer(c){
  // 1) Wenn schon lat/lon gespeichert -> sofort ok
  const lat = Number(c.lat);
  const lon = Number(c.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)){
    return { lat, lon, address: getCustomerAddress(c) };
  }

  // 2) sonst Geocode versuchen
  const addr = getCustomerAddress(c);
  if (!addr) return null;

  const geo = await geocodeAddress(addr);
  if (geo?.lat && geo?.lon){
    // speichern (damit später kein neuer request)
    c.lat = Number(geo.lat);
    c.lon = Number(geo.lon);
    return { lat: c.lat, lon: c.lon, address: addr };
  }

  // 3) fail -> Modal öffnen und warten
  const ok = await openAddressFixModalAsync(c, addr);
  if (!ok) return null; // user cancelled

  // nach speichern nochmal versuchen (jetzt sollte lat/lon gesetzt sein)
  const lat2 = Number(c.lat);
  const lon2 = Number(c.lon);
  if (Number.isFinite(lat2) && Number.isFinite(lon2)){
    return { lat: lat2, lon: lon2, address: getCustomerAddress(c) };
  }

  // fallback: geocode nochmal mit neuer adresse
  const addr2 = getCustomerAddress(c);
  const geo2 = await geocodeAddress(addr2);
  if (geo2?.lat && geo2?.lon){
    c.lat = Number(geo2.lat);
    c.lon = Number(geo2.lon);
    return { lat: c.lat, lon: c.lon, address: addr2 };
  }

  return null;
}

// Build optimized route using OSRM Trip
export async function buildOptimizedRoute(driverId, customerIds){
  const startAddress = norm(state.settings?.startAddress || "");
  if (!startAddress) throw new Error("Start-Adresse fehlt (Settings).");
  if (!customerIds?.length) throw new Error("Keine Kunden ausgewählt/zugewiesen.");

  // Start coords
  let startGeo = await geocodeAddress(startAddress);
  if (!startGeo) throw new Error("Start-Adresse konnte nicht geocodet werden.");

  const stops = [];
  const coords = [`${startGeo.lon},${startGeo.lat}`]; // lon,lat

  // Kunden coords sichern (inkl. Modal-Fix)
  for (const cid of customerIds.map(String)){
    const c = findCustomer(cid);
    if (!c) continue;

    const got = await ensureCoordsForCustomer(c);
    if (!got){
      throw new Error(`Adresse muss korrigiert werden: ${c.firmenname || ""}`);
    }

    stops.push({
      id: String(cid),
      label: c.firmenname || "Kunde",
      address: got.address,
      lat: got.lat,
      lon: got.lon
    });
    coords.push(`${got.lon},${got.lat}`);
  }

  if (coords.length < 2) throw new Error("Keine gültigen Stopps gefunden.");

  // OSRM Trip optimize order
  const url = `https://router.project-osrm.org/trip/v1/driving/${coords.join(";")}?source=first&roundtrip=false&overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Routing Fehler (OSRM).");
  const data = await res.json();
  if (!data.trips || !data.trips.length) throw new Error("Keine Route gefunden.");

  const trip = data.trips[0];
  const waypoints = data.waypoints || [];

  const order = waypoints
    .map((w, inputIndex)=>({ inputIndex, order: w.waypoint_index }))
    .sort((a,b)=>a.order-b.order)
    .map(x=>x.inputIndex);

  const orderedStops = [];
  orderedStops.push({
    id: "__start__",
    label: "Start (Depot)",
    address: startAddress,
    lat: startGeo.lat,
    lon: startGeo.lon
  });

  for (const inputIndex of order){
    if (inputIndex === 0) continue;
    const stop = stops[inputIndex - 1];
    if (stop) orderedStops.push(stop);
  }

  return {
    driverId,
    orderCustomerIds: orderedStops.filter(s=>s.id !== "__start__").map(s=>s.id),
    stops: orderedStops,
    geojson: trip.geometry,
    distance_m: trip.distance,
    duration_s: trip.duration,
  };
}