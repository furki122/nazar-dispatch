import { norm } from './utils.js';

export function getJson(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  }catch{
    return fallback;
  }
}

export function setJson(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}

export function del(key){
  localStorage.removeItem(key);
}

export function scopedKey(userId, suffix){
  return `nazar_${userId}_${suffix}`;
}

export function mustUser(state){
  if (!state.user) throw new Error("Nicht eingeloggt.");
  return state.user.id;
}

export function cleanEmail(email){
  return norm(email).toLowerCase();
}
