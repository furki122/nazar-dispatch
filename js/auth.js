import { $, norm, sha256 } from './utils.js';
import { getJson, setJson, del, cleanEmail } from './storage.js';

const USERS_KEY = "nazar_users_v1";
const SESSION_KEY = "nazar_session_v1";
const DRIVER_ACCOUNTS_KEY = "nazar_driver_accounts_v1";

// ---------------- users (admin) ----------------
function loadUsers(){
  return getJson(USERS_KEY, []);
}
function saveUsers(users){
  setJson(USERS_KEY, users);
}

export function getSession(){
  return getJson(SESSION_KEY, null);
}
export function clearSession(){
  del(SESSION_KEY);
}

// ---------------- GLOBAL localStorage helpers ----------------
// Driver accounts MUST be global, not scoped.
function getGlobal(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{
    return fallback;
  }
}
function setGlobal(key, val){
  localStorage.setItem(key, JSON.stringify(val));
}

function loadDriverAccounts(){
  return getGlobal(DRIVER_ACCOUNTS_KEY, []);
}
function saveDriverAccounts(list){
  setGlobal(DRIVER_ACCOUNTS_KEY, list);
}

// ---------------- admin register/login ----------------
export async function register(name, email, password){
  name = norm(name);
  email = cleanEmail(email);
  password = norm(password);

  if (!name) throw new Error("Name fehlt.");
  if (!email.includes("@")) throw new Error("E-Mail ungültig.");
  if (password.length < 6) throw new Error("Passwort min. 6 Zeichen.");

  const users = loadUsers();
  if (users.some(u => u.email === email)) throw new Error("E-Mail existiert schon.");

  const id = crypto.randomUUID?.() || String(Date.now())+Math.random();
  const pass = await sha256(password);
  const user = { id, name, email, pass };
  users.push(user);
  saveUsers(users);

  setJson(SESSION_KEY, { type: 'admin', userId: id });
  return user;
}

export async function login(email, password){
  email = cleanEmail(email);
  password = norm(password);

  const users = loadUsers();
  const u = users.find(x => x.email === email);
  if (!u) throw new Error("User nicht gefunden.");

  const pass = await sha256(password);
  if (pass !== u.pass) throw new Error("Passwort falsch.");

  setJson(SESSION_KEY, { type: 'admin', userId: u.id });
  return u;
}

// ---------------- Driver credentials ----------------
// Stored globally in localStorage so driver login can find them.
export async function upsertDriverAccount(ownerUserId, driverId, username, passwordOrNull, displayName){
  ownerUserId = String(ownerUserId || '');
  driverId = String(driverId || '');
  username = norm(username).toLowerCase();
  const pwd = norm(passwordOrNull);
  displayName = norm(displayName);

  if (!ownerUserId || !driverId) return;

  const list = loadDriverAccounts();

  // ensure unique username across all drivers (case-insensitive)
  if (username){
    const dup = list.find(a =>
      (a.username || '').toLowerCase() === username &&
      !(String(a.ownerUserId) === ownerUserId && String(a.driverId) === driverId)
    );
    if (dup) throw new Error('Fahrer-Benutzername existiert bereits.');
  }

  const idx = list.findIndex(a => String(a.ownerUserId) === ownerUserId && String(a.driverId) === driverId);
  const prev = idx >= 0 ? list[idx] : null;

  const next = {
    ownerUserId,
    driverId,
    username: username || (prev?.username || ''),
    pass: prev?.pass || '',
    name: displayName || (prev?.name || ''),
    ts: Date.now()
  };

  if (pwd){
    if (pwd.length < 4) throw new Error('Fahrer-Passwort min. 4 Zeichen.');
    next.pass = await sha256(pwd);
  }

  if (idx >= 0) list[idx] = next;
  else list.push(next);

  saveDriverAccounts(list);
}

export function removeDriverAccount(ownerUserId, driverId){
  ownerUserId = String(ownerUserId || '');
  driverId = String(driverId || '');
  if (!ownerUserId || !driverId) return;

  const list = loadDriverAccounts();
  const next = list.filter(a => !(String(a.ownerUserId) === ownerUserId && String(a.driverId) === driverId));
  saveDriverAccounts(next);
}

export async function loginDriver(username, password){
  username = norm(username).toLowerCase();
  password = norm(password);

  if (!username) throw new Error('Benutzername fehlt.');
  if (!password) throw new Error('Passwort fehlt.');

  const list = loadDriverAccounts();
  const a = list.find(x => (x.username || '').toLowerCase() === username);
  if (!a) throw new Error('Fahrer nicht gefunden.');
  if (!a.pass) throw new Error('Fahrer hat noch kein Passwort.');

  const pass = await sha256(password);
  if (pass !== a.pass) throw new Error('Passwort falsch.');

  setJson(SESSION_KEY, { type: 'driver', ownerUserId: a.ownerUserId, driverId: a.driverId });

  const owner = getUserById(a.ownerUserId);
  if (!owner) throw new Error('Owner-Account nicht gefunden.');
  return { owner, driverId: a.driverId };
}

export function getUserById(id){
  const users = loadUsers();
  return users.find(u => u.id === id) || null;
}

export function wireAuthUI(onAuthed){
  const overlay = $("authOverlay");
  const tabLogin = $("tabLogin");
  const tabRegister = $("tabRegister");
  const tabDriverLogin = $("tabDriverLogin");
  const loginPane = $("loginPane");
  const registerPane = $("registerPane");
  const driverLoginPane = $("driverLoginPane");

  const show = (mode) => {
    const isLogin = mode === "login";
    const isDriver = mode === 'driver';
    tabLogin.classList.toggle("active", isLogin);
    tabRegister.classList.toggle("active", mode === 'register');
    tabDriverLogin?.classList.toggle('active', isDriver);

    loginPane.classList.toggle("hidden", !isLogin);
    registerPane.classList.toggle("hidden", mode !== 'register');
    driverLoginPane?.classList.toggle('hidden', !isDriver);
  };

  tabLogin.addEventListener("click", ()=>show("login"));
  tabRegister.addEventListener("click", ()=>show("register"));
  tabDriverLogin?.addEventListener('click', ()=>show('driver'));

  $("btnRegister").addEventListener("click", async ()=>{
    try{
      const user = await register($("regName").value, $("regEmail").value, $("regPassword").value);
      overlay.classList.add("hidden");
      onAuthed(user);
    }catch(e){
      alert(e.message || String(e));
    }
  });

  $("btnLogin").addEventListener("click", async ()=>{
    try{
      const user = await login($("loginEmail").value, $("loginPassword").value);
      overlay.classList.add("hidden");
      onAuthed(user);
    }catch(e){
      alert(e.message || String(e));
    }
  });

  $("btnDriverLogin")?.addEventListener('click', async ()=>{
    try{
      const res = await loginDriver($("driverLoginUser").value, $("driverLoginPassword").value);
      overlay.classList.add('hidden');
      onAuthed(res.owner, { asDriver: true, driverId: res.driverId });
    }catch(e){
      alert(e.message || String(e));
    }
  });

  return { showOverlay: ()=>overlay.classList.remove("hidden"), hideOverlay: ()=>overlay.classList.add("hidden") };
}