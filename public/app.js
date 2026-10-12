const $ = (s) => document.querySelector(s);
const views = ["auth-view", "dashboard-view", "room-view"];
let currentUser = null, currentRoom = null, messageTimer = null, roomTimer = null, lastMessageAt = null, messageIds = new Set();
let authMode = "login";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function formatDate(value) {
  try { return new Intl.DateTimeFormat("vi-VN", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit" }).format(new Date(value)); }
  catch { return ""; }
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function showNotice(selector, text) {
  const el = $(selector); if (!el) return;
  el.textContent = text; el.classList.remove("hidden");
}
function hideNotice(selector) { const el = $(selector); if (el) el.classList.add("hidden"); }
let toastTimer;
function toast(text) {
  const el = $("#global-notice"); el.textContent = text; el.classList.remove("hidden");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
}
async function api(url, options = {}) {
  const opts = { ...options, headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) } };
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") opts.body = JSON.stringify(options.body);
  const response = await fetch(url, opts);
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 401 && !url.includes("/login") && !url.includes("/register")) showAuth();
    throw new Error(data.error || `Lỗi ${response.status}`);
  }
  return data;
}
function showView(id) {
  views.forEach(v => $("#" + v).classList.toggle("hidden", v !== id));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function showAuth() {
  stopRoomTimers(); currentRoom = null;
  $("#current-user").classList.add("hidden"); $("#logout-btn").classList.add("hidden");
  showView("auth-view");
}
function setUser(user) {
  currentUser = user;
  $("#current-user").textContent = "@" + user.username;
  $("#current-user").classList.remove("hidden"); $("#logout-btn").classList.remove("hidden");
  $("#user-avatar").textContent = user.username.slice(0,1).toUpperCase();
}
function stopRoomTimers() {
  if (messageTimer) clearInterval(messageTimer);
  if (roomTimer) clearInterval(roomTimer);
  messageTimer = null; roomTimer = null;
}
function switchAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-tab]").forEach(b => b.classList.toggle("active", b.dataset.authTab === mode));
  $("#auth-title").textContent = mode === "login" ? "Chào mừng trở lại!" : "Tạo tài khoản mới";
  $("#auth-subtitle").textContent = mode === "login" ? "Đăng nhập để vào phòng học của bạn." : "Tạo tài khoản để bắt đầu học cùng bạn bè.";
  $("#auth-submit").textContent = mode === "login" ? "Đăng nhập" : "Tạo tài khoản";
  $("#password").autocomplete = mode === "login" ? "current-password" : "new-password";
  hideNotice("#auth-error");
}
document.querySelectorAll("[data-auth-tab]").forEach(b => b.addEventListener("click", () => switchAuthMode(b.dataset.authTab)));

$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault(); hideNotice("#auth-error");
  const button = $("#auth-submit"); button.disabled = true;
  try {
    const result = await api("/api/" + authMode, { method:"POST", body: {
      username: $("#username").value.trim(), password: $("#password").value
    }});
    setUser(result.user); $("#password").value = ""; await loadDashboard();
  } catch (err) { showNotice("#auth-error", err.message); }
  finally { button.disabled = false; }
});
$("#logout-btn").addEventListener("click", async () => {
  try { await api("/api/logout", { method:"POST" }); } catch {}
  showAuth(); toast("Đã đăng xuất.");
});

async function loadDashboard() {
  stopRoomTimers(); showView("dashboard-view");
  try {
    const result = await api("/api/rooms");
    const list = $("#rooms-list");
    if (!result.rooms.length) {
      list.innerHTML = '<div class="empty-state">Chưa có phòng nào. Tạo phòng mới hoặc nhập mã phòng để tham gia nhé!</div>'; return;
    }
    list.innerHTML = result.rooms.map(room => `
      <article class="room-card" tabindex="0" role="button" data-room-id="${escapeHtml(room.id)}">
        <div class="room-card-top"><div class="room-mark">${escapeHtml(room.name.slice(0,1).toUpperCase())}</div><span class="role-tag">${room.role === "owner" ? "Chủ phòng" : "Thành viên"}</span></div>
        <h3>${escapeHtml(room.name)}</h3><p>${escapeHtml(room.description || "Cùng nhau học tập và chia sẻ tài liệu.")}</p>
        <div class="room-card-bottom"><span>⌁ Mã ${escapeHtml(room.code)}</span><span>Vào phòng →</span></div>
      </article>`).join("");
    list.querySelectorAll("[data-room-id]").forEach(card => {
      const open = () => openRoom(card.dataset.roomId);
      card.addEventListener("click", open); card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  } catch (err) { $("#rooms-list").innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}
$("#refresh-rooms").addEventListener("click", loadDashboard);
$("#create-room-form").addEventListener("submit", async e => {
  e.preventDefault(); hideNotice("#create-error");
  const button = e.submitter; if (button) button.disabled = true;
  try {
    const result = await api("/api/rooms", { method:"POST", body: { name: $("#room-name").value, description: $("#room-description").value } });
    $("#create-room-form").reset(); await openRoom(result.room.id); toast("Đã tạo phòng!");
  } catch (err) { showNotice("#create-error", err.message); }
  finally { if (button) button.disabled = false; }
});
$("#join-room-form").addEventListener("submit", async e => {
  e.preventDefault(); hideNotice("#join-error");
  const button = e.submitter; if (button) button.disabled = true;
  try {
    const result = await api("/api/rooms/join", { method:"POST", body: { code: $("#room-code").value } });
    $("#join-room-form").reset(); await openRoom(result.room.id); toast("Đã tham gia phòng!");
  } catch (err) { showNotice("#join-error", err.message); }
  finally { if (button) button.disabled = false; }
});
$("#room-code").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0,8); });
$("#back-to-rooms").addEventListener("click", loadDashboard);
$("#copy-code").addEventListener("click", async () => {
  if (!currentRoom) return;
  try { await navigator.clipboard.writeText(currentRoom.code); toast("Đã sao chép mã phòng!"); }
  catch { toast("Mã phòng: " + currentRoom.code); }
});

async function openRoom(id) {
  stopRoomTimers(); currentRoom = null; lastMessageAt = null; messageIds = new Set();
  showView("room-view");
  $("#chat-messages").innerHTML = '<div class="empty-state">Đang tải tin nhắn...</div>';
  $("#files-list").innerHTML = '<div class="empty-state">Đang tải file...</div>';
  try {
    const result = await api("/api/rooms/" + encodeURIComponent(id));
    currentRoom = result.room;
    $("#room-heading").textContent = result.room.name;
    $("#room-description-view").textContent = result.room.description || "Cùng nhau học tập và chia sẻ tài liệu.";
    $("#room-code-view").textContent = result.room.code;
    $("#member-count").textContent = `${result.members.length} thành viên`;
    $("#members-list").innerHTML = result.members.map(m => `<div class="member-row"><div class="member-avatar">${escapeHtml(m.username.slice(0,1).toUpperCase())}</div><span class="member-name">${escapeHtml(m.username)}</span>${m.role === "owner" ? '<span class="owner-tag">Chủ phòng</span>' : ""}</div>`).join("");
    await Promise.all([loadMessages(true), loadFiles()]);
    messageTimer = setInterval(() => loadMessages(false), 2500);
    roomTimer = setInterval(() => refreshMembers(id), 15000);
  } catch (err) { toast(err.message); await loadDashboard(); }
}
async function refreshMembers(id) {
  if (!currentRoom || currentRoom.id !== id) return;
  try {
    const result = await api("/api/rooms/" + encodeURIComponent(id));
    $("#member-count").textContent = `${result.members.length} thành viên`;
    $("#members-list").innerHTML = result.members.map(m => `<div class="member-row"><div class="member-avatar">${escapeHtml(m.username.slice(0,1).toUpperCase())}</div><span class="member-name">${escapeHtml(m.username)}</span>${m.role === "owner" ? '<span class="owner-tag">Chủ phòng</span>' : ""}</div>`).join("");
  } catch {}
}
async function loadMessages(initial) {
  if (!currentRoom) return;
  try {
    const query = lastMessageAt && !initial ? "?after=" + encodeURIComponent(lastMessageAt) : "";
    const result = await api(`/api/rooms/${encodeURIComponent(currentRoom.id)}/messages${query}`);
    const container = $("#chat-messages");
    if (initial) { container.innerHTML = ""; messageIds = new Set(); }
    for (const m of result.messages) {
      if (messageIds.has(m.id)) continue;
      messageIds.add(m.id);
      const el = document.createElement("div");
      el.className = "message" + (m.user_id === currentUser.id ? " mine" : "");
      const meta = document.createElement("div"); meta.className = "message-meta";
      const who = document.createElement("strong"); who.textContent = m.username;
      const when = document.createElement("span"); when.textContent = formatDate(m.created_at);
      meta.append(who, when);
      const bubble = document.createElement("div"); bubble.className = "message-bubble"; bubble.textContent = m.body;
      el.append(meta, bubble); container.append(el);
      if (!lastMessageAt || new Date(m.created_at) > new Date(lastMessageAt)) lastMessageAt = m.created_at;
    }
    if (initial || result.messages.length) container.scrollTop = container.scrollHeight;
    if (initial && !result.messages.length) container.innerHTML = '<div class="empty-state">Chưa có tin nhắn. Hãy bắt đầu cuộc thảo luận đầu tiên!</div>';
  } catch (err) { if (initial) $("#chat-messages").innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}
$("#chat-form").addEventListener("submit", async e => {
  e.preventDefault(); if (!currentRoom) return;
  const input = $("#chat-input"), body = input.value.trim(); if (!body) return;
  const button = e.submitter; if (button) button.disabled = true; hideNotice("#chat-error");
  try {
    await api(`/api/rooms/${encodeURIComponent(currentRoom.id)}/messages`, { method:"POST", body:{ body } });
    input.value = ""; await loadMessages(false); input.focus();
  } catch (err) { showNotice("#chat-error", err.message); }
  finally { if (button) button.disabled = false; }
});
async function loadFiles() {
  if (!currentRoom) return;
  try {
    const result = await api(`/api/rooms/${encodeURIComponent(currentRoom.id)}/files`);
    const list = $("#files-list");
    if (!result.files.length) { list.innerHTML = '<div class="empty-state">Chưa có tài liệu nào.</div>'; return; }
    list.innerHTML = result.files.map(f => {
      const ext = (f.original_name.split(".").pop() || "FILE").slice(0,4).toUpperCase();
      return `<div class="file-row"><div class="file-icon">${escapeHtml(ext)}</div><div class="file-info"><strong>${escapeHtml(f.original_name)}</strong><small>${escapeHtml(f.username)} · ${formatSize(f.size_bytes)}</small></div><button class="download-btn" data-download="${escapeHtml(f.id)}" title="Tải xuống">↓</button></div>`;
    }).join("");
    list.querySelectorAll("[data-download]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true;
      try { const result = await api("/api/files/" + encodeURIComponent(btn.dataset.download) + "/download"); window.location.href = result.url; }
      catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    }));
  } catch (err) { $("#files-list").innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`; }
}
$("#upload-form").addEventListener("submit", async e => {
  e.preventDefault(); hideNotice("#file-error");
  const file = $("#file-input").files[0]; if (!file) { showNotice("#file-error", "Hãy chọn file trước."); return; }
  if (file.size > 10 * 1024 * 1024) { showNotice("#file-error", "File vượt quá 10 MB."); return; }
  if (!currentRoom) return;
  const button = e.submitter; if (button) { button.disabled = true; button.textContent = "Đang tải..."; }
  try {
    const data = new FormData(); data.append("file", file);
    await api(`/api/rooms/${encodeURIComponent(currentRoom.id)}/files`, { method:"POST", body:data });
    $("#file-input").value = ""; await loadFiles(); toast("Đã gửi tài liệu!");
  } catch (err) { showNotice("#file-error", err.message); }
  finally { if (button) { button.disabled = false; button.textContent = "Tải lên"; } }
});

(async function init() {
  try {
    const result = await api("/api/me");
    setUser(result.user); await loadDashboard();
  } catch { showAuth(); }
})();
