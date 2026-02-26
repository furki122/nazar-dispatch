import { state } from './state.js';
import { $, norm, esc } from './utils.js';
import { getJson, setJson, scopedKey, mustUser } from './storage.js';

// Rooms:
//  - '__all__'  => Team-Chat (alle)
//  - '<driverId>' => Privat-Chat (Admin <-> Fahrer)

function keyChat(roomId){
  const uid = mustUser(state);
  return scopedKey(uid, `chat_${String(roomId || '')}_v1`);
}

function loadChat(roomId){
  return getJson(keyChat(roomId), []);
}

function saveChat(roomId, msgs){
  setJson(keyChat(roomId), msgs);
}

function keyActiveChatRoom(){
  const uid = mustUser(state);
  return scopedKey(uid, 'active_chatroom_v1');
}

function getRooms(){
  const rooms = [];

  // Team room always
  rooms.push({
    id: '__all__',
    title: '🌍 Team-Chat',
    sub: 'Alle sehen das',
    icon: '🌍'
  });

  if (state.isDriver){
    const myId = String(state.driver?.id || '');
    if (myId){
      rooms.push({
        id: myId,
        title: '📦 Dispatch',
        sub: 'Privat: du + Zentrale',
        icon: '📦'
      });
    }
    return rooms;
  }

  // Admin: one room per driver
  for (const d of (state.drivers || [])){
    rooms.push({
      id: String(d.id),
      title: `🚗 ${d.name || 'Fahrer'}`,
      sub: d.username ? `@${d.username}` : 'Privat-Chat',
      icon: '🚗'
    });
  }

  return rooms;
}

function getLastSnippet(roomId){
  const msgs = loadChat(roomId);
  if (!msgs.length) return 'Noch keine Nachrichten';
  const m = msgs[msgs.length - 1];
  const who = m.from ? `${m.from}: ` : '';
  return (who + (m.text || '')).slice(0, 80);
}

function setActiveRoom(roomId){
  state.chatActiveRoomId = String(roomId || '__all__');
  setJson(keyActiveChatRoom(), state.chatActiveRoomId);
  renderChatUI();
}

function ensureActiveRoom(){
  const saved = String(getJson(keyActiveChatRoom(), '') || '');
  const rooms = getRooms();
  const pick = rooms.find(r => r.id === saved)?.id || rooms[0]?.id || '__all__';
  state.chatActiveRoomId = String(pick);
}

function renderList(){
  const list = $('chatList');
  if (!list) return;

  const rooms = getRooms();
  list.innerHTML = '';

  for (const r of rooms){
    const el = document.createElement('div');
    el.className = 'chat-item' + (String(state.chatActiveRoomId) === String(r.id) ? ' active' : '');
    el.dataset.room = r.id;

    const snippet = getLastSnippet(r.id);
    el.innerHTML = `
      <div class="chat-ava">${esc(r.icon || '💬')}</div>
      <div class="chat-meta">
        <div class="chat-name">${esc(r.title)}</div>
        <div class="chat-snippet">${esc(snippet)}</div>
      </div>
      <div class="chat-badge">${esc(r.sub || '')}</div>
    `;

    el.addEventListener('click', ()=> setActiveRoom(r.id));
    list.appendChild(el);
  }

  // left subtitle
  const sub = $('chatLeftSub');
  if (sub){
    sub.textContent = state.isDriver
      ? 'Du siehst nur deine Chats'
      : `${(state.drivers || []).length} Fahrer + Team-Chat`;
  }
}

function renderMessages(){
  const roomId = String(state.chatActiveRoomId || '__all__');
  const box = $('chatBox');
  const hint = $('chatHint');
  const roomSub = $('chatRoomSub');
  const status = $('chatStatus');
  if (!box || !hint) return;

  const rooms = getRooms();
  const room = rooms.find(r => String(r.id) === roomId) || rooms[0];

  hint.textContent = room?.title || 'Chat';
  if (roomSub) roomSub.textContent = room?.sub || '';
  if (status) status.textContent = 'bereit';

  box.innerHTML = '';
  const msgs = loadChat(roomId);
  if (!msgs.length){
    box.innerHTML = `<div class="tiny muted">Noch keine Nachrichten.</div>`;
    return;
  }

  const me = state.isDriver ? (state.driver?.name || 'Fahrer') : (state.user?.name || 'Admin');

  for (const m of msgs){
    const div = document.createElement('div');
    const isMe = String(m.from || '') === String(me);
    div.className = 'msg' + (isMe ? ' me' : '');
    const time = new Date(m.ts).toLocaleString();
    div.innerHTML = `
      <div class="mmeta"><span>${esc(m.from || '')}</span><span>${esc(time)}</span></div>
      <div class="mtext">${esc(m.text || '')}</div>
    `;
    box.appendChild(div);
  }
  box.scrollTop = box.scrollHeight;
}

function renderChatUI(){
  renderList();
  renderMessages();
}

function sendChat(){
  const roomId = String(state.chatActiveRoomId || '__all__');
  const text = norm($('chatInput')?.value || '');
  if (!text) return;

  const msgs = loadChat(roomId);
  const from = state.isDriver ? (state.driver?.name || 'Fahrer') : (state.user?.name || 'Admin');
  msgs.push({ from, text, ts: Date.now() });
  saveChat(roomId, msgs);

  $('chatInput').value = '';
  renderChatUI();
}

export function initChatPage(){
  ensureActiveRoom();

  $('btnSendChat')?.addEventListener('click', sendChat);
  $('chatInput')?.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){
      e.preventDefault();
      sendChat();
    }
  });

  $('btnClearChat')?.addEventListener('click', ()=>{
    const roomId = String(state.chatActiveRoomId || '__all__');
    const rooms = getRooms();
    const room = rooms.find(r => String(r.id) === roomId);
    const name = room?.title || 'Chat';
    if (!confirm(`${name} löschen?`)) return;
    saveChat(roomId, []);
    renderChatUI();
  });

  // If drivers list changes later (admin adds drivers), refresh list
  window.addEventListener('drivers:updated', ()=>{
    // keep active room if possible
    const rooms = getRooms();
    if (!rooms.find(r => String(r.id) === String(state.chatActiveRoomId))){
      state.chatActiveRoomId = rooms[0]?.id || '__all__';
    }
    renderChatUI();
  });

  renderChatUI();
}
