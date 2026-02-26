import { state } from "./state.js";
import { getJson, setJson, scopedKey, mustUser } from "./storage.js";
import { norm } from "./utils.js";

function key() {
  const uid = mustUser(state);
  return scopedKey(uid, "geocache_v1");
}

export function loadGeoCache() {
  state.geoCache = getJson(key(), {});
}

export function saveGeoCache() {
  setJson(key(), state.geoCache);
}

export function clearGeoCache() {
  state.geoCache = {};
  saveGeoCache();
}

/**
 * Intelligent Geocoding (Nominatim via local proxy) with:
 * - strong cleanup (Top, Stiege, Tür, U6 Station, ggü., etc.)
 * - multiple candidate queries
 * - intelligent ranking (choose most likely match)
 *
 * REQUIREMENT:
 *   proxy.js should call Nominatim with limit>=5, addressdetails=1, countrycodes=at, accept-language=de
 *   e.g.:
 *   https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=at&accept-language=de&addressdetails=1&q=...
 */
export async function geocodeAddress(address) {
  address = norm(address);
  if (!address) return null;

  const clean = (s) =>
    (s || "")
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/,+/g, ",")
      .trim();

  const stripApartment = (s) => {
    s = clean(s);

    // strasse variations
    s = s.replace(/\bstrasse\b/ig, "straße");
    s = s.replace(/\bstr\.?\b/ig, "straße");

    // Remove apartment/unit hints (Top/Wohnung/Stiege/Tür/Whg/Apt)
    s = s
      .replace(/\/\s*top\s*\d+[a-z]?/ig, "")
      .replace(/\btop\s*\d+[a-z]?\b/ig, "")
      .replace(/\bwhg\.?\s*\d+[a-z]?\b/ig, "")
      .replace(/\bapt\.?\s*\d+[a-z]?\b/ig, "")
      .replace(/\bwohnung\s*\d+[a-z]?\b/ig, "")
      .replace(/\btür\s*\d+[a-z]?\b/ig, "")
      .replace(/\bstiege\s*[a-z0-9]+\b/ig, "");

    // "59/2" -> "59"
    s = s.replace(/(\d+)\s*\/\s*\d+\b/g, "$1");

    return clean(s);
  };

  const stripNonAddressNoise = (s) => {
    s = clean(s);

    // remove typical dispatch notes that break geocoding
    s = s
      .replace(/\bu\s*\d+\b/ig, "") // U6
      .replace(/\bstation\b/ig, "")
      .replace(/\bggü\.?\b/ig, "")
      .replace(/\bgegenüber\b/ig, "")
      .replace(/\bnahe\b/ig, "")
      .replace(/\bbei\b/ig, "")
      .replace(/\becke\b/ig, "")
      .replace(/\bggue\.?\b/ig, "")
      .replace(/\bgegenueber\b/ig, "");

    // common punctuation leftovers
    s = s.replace(/\(\s*\)/g, "");
    return clean(s);
  };

  const splitPlaceSuffixes = (s) => {
    s = clean(s);

    // SPECIAL: "...hauptstrasse" -> "... Hauptstraße"
    s = s.replace(/([A-Za-zÄÖÜäöüß]+)\s*hauptstrasse\b/gi, "$1 Hauptstraße");
    s = s.replace(/([A-Za-zÄÖÜäöüß]+)\s*hauptstraße\b/gi, "$1 Hauptstraße");

    // Split glued place suffixes (NOT 'straße' to avoid breaking words like Erdbergstraße)
    const suffixes = ["markt", "platz", "gasse", "ring", "gürtel", "allee", "weg", "kai", "steig", "hof"];
    for (const suf of suffixes) {
      const re = new RegExp(`([A-Za-zÄÖÜäöüß]+)(${suf})\\b`, "i");
      s = s.replace(re, "$1 $2");
    }

    // normalize strasse again
    s = s.replace(/\bstrasse\b/ig, "straße");
    s = s.replace(/\bstr\.?\b/ig, "straße");

    return clean(s);
  };

  const normalizeQuery = (s) => {
    s = stripApartment(s);
    s = stripNonAddressNoise(s);

    // common typo fix (optional but helps your example)
    s = s.replace(/\bantan\b/ig, "anton");

    s = splitPlaceSuffixes(s);

    // space between letter and number: "...e98" -> "...e 98"
    s = s.replace(/([A-Za-zÄÖÜäöüß])(\d)/g, "$1 $2");

    // normalize strasse/str.
    s = s.replace(/\bstr\.?\b/ig, "straße");
    s = s.replace(/\bstrasse\b/ig, "straße");

    // remove duplicate country if user already added
    s = s.replace(/,\s*österreich\b/ig, ", Österreich");

    return clean(s);
  };

  // Extract hints from address string for scoring
  const extractHints = (s) => {
    const out = { postcode: "", city: "", house: "", roadGuess: "" };
    const mPlz = s.match(/\b(\d{4})\b/);
    if (mPlz) out.postcode = mPlz[1];

    // crude house number (supports "119-121" -> "119")
    const mHouse = s.match(/\b(\d{1,5})(?:\s*-\s*\d{1,5})?\b/);
    if (mHouse) out.house = mHouse[1];

    // city
    if (/\bwien\b/i.test(s)) out.city = "wien";

    // roadGuess: take part before first comma, strip number-ish tail
    const first = clean(s.split(",")[0] || "");
    out.roadGuess = first.replace(/\b\d+[a-z]?\b/ig, "").trim().toLowerCase();

    return out;
  };

  const original = clean(address);
  const q0 = normalizeQuery(original);

  // ✅ Cache (try multiple keys)
  const cached = state.geoCache[q0] || state.geoCache[original] || state.geoCache[address];
  if (cached && cached.lat && cached.lon) return cached;

  const hints = extractHints(q0);

  // Candidate generation
  const candidates = [];
  const add = (x) => {
    x = clean(x);
    if (x && !candidates.includes(x)) candidates.push(x);
  };

  // Base without duplicate "Wien/Österreich" appends
  const base = clean(q0)
    .replace(/,\s*österreich\b/ig, "")
    .replace(/,\s*wien\b/ig, "")
    .trim();

  add(q0);
    const preferVienna = (hints.city === 'wien') || (hints.postcode && hints.postcode.startsWith('1'));
  if (preferVienna){
    add(`${base}, Wien`);
    add(`${base}, Wien, Österreich`);
  } else {
    // don't force Vienna for non-Vienna addresses (e.g. Graz)
    add(`${base}, Österreich`);
  }

  // If no house number, also try just the first segment + postcode/city if present
  const firstSeg = clean(base.split(",")[0] || base);
  if (firstSeg) {
    if (preferVienna){
      if (hints.postcode) add(`${firstSeg}, ${hints.postcode} Wien`);
      add(`${firstSeg}, Wien`);
      add(`${firstSeg}, Wien, Österreich`);
    } else {
      if (hints.postcode) add(`${firstSeg}, ${hints.postcode} Österreich`);
      add(`${firstSeg}, Österreich`);
    }
  }

  // Hyphenated street variant: "Anton Baumgartner Straße" -> "Anton-Baumgartner-Straße"
  const hyphenStreet = (txt) => {
    if (!/straße/i.test(txt)) return null;
    return txt.replace(/\b([A-Za-zÄÖÜäöüß]+)\s+([A-Za-zÄÖÜäöüß]+)\s+straße\b/i, "$1-$2-Straße");
  };
  const h1 = hyphenStreet(q0);
  if (h1) add(h1);

  // House range -> first number
  add(q0.replace(/(\d+)\s*-\s*(\d+)/, "$1"));
  if (h1) add(h1.replace(/(\d+)\s*-\s*(\d+)/, "$1"));

  // Special: if user glued "hauptstrasse" without space earlier, try a stronger split variant
  add(q0.replace(/([A-Za-zÄÖÜäöüß]+)hauptstraße\b/i, "$1 Hauptstraße"));
  add(q0.replace(/([A-Za-zÄÖÜäöüß]+)hauptstrasse\b/i, "$1 Hauptstraße"));

  // ---------- Intelligent ranking ----------
  const scoreResult = (it, candidateQuery) => {
    let score = 0;

    const addr = it.address || {};
    const city = String(addr.city || addr.town || addr.village || addr.municipality || "").toLowerCase();
    const postcode = String(addr.postcode || "");
    const road = String(addr.road || addr.pedestrian || addr.footway || addr.cycleway || "").toLowerCase();
    const house = String(addr.house_number || "");

    // Country/region preference
    const country = String(addr.country || "").toLowerCase();
    if (country.includes("österreich") || country.includes("austria")) score += 20;

    // Vienna preference
    if (preferVienna) {
    if (city.includes("wien")) score += 40;
  } else {
    if (city.includes("wien")) score -= 10;
  }

    // Postcode match
    if (hints.postcode) {
      if (postcode === hints.postcode) score += 50;
      else if (postcode && postcode.startsWith("1") && hints.postcode.startsWith("1")) score += 10; // still Vienna-ish
      else if (postcode) score -= 5;
    } else {
      // no postcode hint: still prefer Vienna postcodes
      if (postcode.startsWith("1")) score += 5;
    }

    // House number match
    if (hints.house) {
      if (house === hints.house) score += 35;
      else if (house && house.startsWith(hints.house)) score += 15;
      else if (house) score -= 4;
    }

    // Road similarity (very light heuristic)
    if (hints.roadGuess) {
      const rg = hints.roadGuess;
      if (road && rg && road.includes(rg)) score += 25;
      else if (road && rg && rg.includes(road)) score += 15;
      else if (road && rg) {
        // token overlap
        const a = new Set(rg.split(/\s+/).filter(Boolean));
        const b = new Set(road.split(/\s+/).filter(Boolean));
        let overlap = 0;
        for (const t of a) if (b.has(t)) overlap++;
        score += Math.min(12, overlap * 4);
      }
    }

    // Type/class preference: prefer buildings/addresses over vague places
    const cls = String(it.class || "").toLowerCase();
    const typ = String(it.type || "").toLowerCase();
    if (cls === "building" || cls === "place" || cls === "highway") score += 3;
    if (typ === "house" || typ === "residential" || typ === "building") score += 6;

    // Prefer more precise results (has house number)
    if (house) score += 6;

    // Prefer if display name contains "Wien"
    const disp = String(it.display_name || "").toLowerCase();
    if (disp.includes("wien")) score += 6;
    // Prefer closer to our candidate query (light heuristic)
    if (candidateQuery) {
      const cq = String(candidateQuery).toLowerCase();
      if (disp && cq && disp.includes(cq)) score += 4;
    }

    return score;
  };

  // --- fetch helpers (proxy -> relative -> nominatim fallback) ---
  const tryFetchJson = async (url) => {
    try{
      const res = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    }catch(_e){
      return null;
    }
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const fetchGeocodeResults = async (q) => {
    const enc = encodeURIComponent(q);

    // 1) local proxy (best)
    let data = await tryFetchJson(`http://127.0.0.1:5055/api/geocode?q=${enc}`);
    if (Array.isArray(data) && data.length) return data;


    // 3) direct Nominatim (works without backend; be gentle)
    await sleep(350);
    data = await tryFetchJson(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=at&accept-language=de&q=${enc}`
    );
    if (Array.isArray(data) && data.length) return data;

    return null;
  };

  let bestScore = -Infinity;
  let bestPick = null;

  try {
    for (const q of candidates) {
      const data = await fetchGeocodeResults(q);
      if (!Array.isArray(data) || !data.length) continue;

      for (const it of data) {
        const lat = parseFloat(it.lat);
        const lon = parseFloat(it.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const sc = scoreResult(it, q);
        if (sc > bestScore) {
          bestScore = sc;
          bestPick = { it, lat, lon };
        }
      }
    }

    if (!bestPick) {
      console.warn("Geocode: keine Ergebnisse für", address, "→ tried:", candidates);
      return null;
    }

    const geo = { lat: bestPick.lat, lon: bestPick.lon, ts: Date.now() };

    // Cache under multiple keys
    state.geoCache[q0] = geo;
    state.geoCache[original] = geo;
    saveGeoCache();

    return geo;
  } catch (err) {
    console.error("Geocode Fehler:", err);
    return null;
  }
}
