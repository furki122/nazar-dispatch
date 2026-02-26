export const state = {
  user: null,
  isDriver: false,
  driverId: '',
  driver: null,
  settings: {
    startAddress: "Laxenburger Straße 365, 1230 Wien",
    routingEngine: "osrm",
  },
  customers: [], // {id, today:boolean, firmenname, adresse, postleitzahl, ort, land, bezirk, __address, __addressGeo, geo:{lat,lon}?}
  drivers: [],   // {id, name, car, note, username?}
  assignments: {}, // driverId -> [customerId,...]
  geoCache: {}, // address -> {lat,lon,ts}
  lastRoute: null, // {driverId, order:[customerId], stops:[{label,address,lat,lon}], geojson}
};
