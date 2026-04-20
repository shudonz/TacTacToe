const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("solitaireRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Solitaire room id");
}
let myName = "";
let isHost = false;

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText)
        return navigator.clipboard.writeText(text).catch(() => execCopy(text));
    execCopy(text);
}
function execCopy(text) {
    const el = document.createElement("textarea");
    el.value = text; el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(el); el.select();
    el.setSelectionRange(0, el.value.length);
    document.execCommand("copy"); document.body.removeChild(el);
}

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;
    await fetchAvatars([myName]);

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById("roomCode").textContent = shortCode;
    document.getElementById("copyCodeBtn").addEventListener("click", () => {
        copyToClipboard(shortCode); showCopyToast("Room code copied!");
    });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
        copyToClipboard(window.location.origin + "/lobby?join=" + roomId + "&game=solitaire");
        showCopyToast("Invite link copied!");
    });

    connection.on("SolitaireRoomUpdated", room => renderRoom(room));
    connection.on("SolitaireRoomDissolved", () => { alert("The room was closed."); window.location.href = "/lobby"; });
    connection.on("KickedFromRoom", () => { alert("You were kicked."); window.location.href = "/lobby"; });
    connection.on("SolitaireGameStarted", room => {
        sessionStorage.setItem("solitaireRoomId", room.id);
        window.location.href = "/solitaire";
    });

    await connection.start();
    await connection.invoke("RejoinSolitaireRoom", roomId);
    initChat(connection, roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = esc(room.settings.roomName);
    document.getElementById("playerCount").textContent = room.players.length + "/" + room.settings.maxPlayers;

    fetchAvatars(room.players.map(p => p.name)).then(() => _renderPlayerList(room));
    _renderPlayerList(room);
}

function _renderPlayerList(room) {
    isHost = room.hostName === myName;
    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        let html = avatarHtml(p.name, 'sm') + '<span class="room-player-name">' + esc(p.name) + '</span>';
        if (p.name === room.hostName) html += '<span class="room-host-badge">HOST</span>';
        if (p.name === myName) html += '<span class="you-tag">You</span>';
        if (isHost && p.name !== myName)
            html += '<button class="btn-kick" onclick="kickPlayer(\'' + esc(p.name).replace(/'/g, "\\'") + '\')">&#x2715;</button>';
        el.innerHTML = html;
        list.appendChild(el);
    });

    if (isHost) {
        const canStart = room.players.length >= 2;
        document.getElementById("startBtn").style.display = "inline-block";
        document.getElementById("startBtn").disabled = !canStart;
        document.getElementById("waitMsg").style.display = "none";
        if (!canStart) document.getElementById("startBtn").title = "Need at least 2 players to start";
    } else {
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
        document.getElementById("hostNameWait").textContent = room.hostName;
    }
}

document.getElementById("startBtn").addEventListener("click", () => connection.invoke("StartSolitaireGame", roomId));
function kickPlayer(name) { connection.invoke("KickSolitairePlayer", roomId, name); }
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").addEventListener("click", () =>
        connection.invoke("LeaveSolitaireRoom", roomId).then(() => { window.location.href = "/lobby"; }));
});

function showCopyToast(msg) {
    let t = document.getElementById("copyToast");
    if (!t) { t = document.createElement("div"); t.id = "copyToast"; t.className = "copy-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("copy-toast-show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("copy-toast-show"), 2500);
}

function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close  = document.getElementById("chatClose"),  input = document.getElementById("chatInput"),
          send   = document.getElementById("chatSend"),   msgs  = document.getElementById("chatMessages"),
          badge  = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread = 0; badge.style.display = "none"; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick  = () => { chatOpen = false; panel.style.display = "none"; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke("SendChat", groupId, m); input.value = ""; }
    send.onclick = doSend;
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    conn.on("ChatMessage", (name, message) => {
        const el = document.createElement("div"); el.className = "chat-msg";
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; }
    });
}

init();
