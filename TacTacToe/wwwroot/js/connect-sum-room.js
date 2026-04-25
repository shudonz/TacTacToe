const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("connectSumRoomId");
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing ConnectSum room id"); }

let myName = sessionStorage.getItem("myName") || "";
let hostName = "";

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    if (!myName) {
        const res = await fetch("/api/me");
        const me = await res.json();
        myName = me.name;
        document.getElementById("navbarUsername").textContent = me.name;
    }

    connection.on("ConnectSumRoomUpdated", room => renderRoom(room));
    connection.on("ConnectSumRoomDissolved", () => { alert("The room was dissolved."); window.location.href = "/lobby"; });
    connection.on("ConnectSumGameStarted", () => { window.location.href = "/connect-sum"; });

    await connection.start();
    await connection.invoke("RejoinConnectSumRoom", roomId);

    document.getElementById("roomCode").textContent = roomId.slice(0, 8).toUpperCase();
    document.getElementById("copyCodeBtn").addEventListener("click", () => {
        navigator.clipboard.writeText(roomId.slice(0, 8).toUpperCase());
    });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
        navigator.clipboard.writeText(window.location.origin + "/lobby?join=" + roomId + "&game=connect-sum");
    });
    document.getElementById("startBtn").addEventListener("click", () => {
        connection.invoke("StartConnectSumGame", roomId);
    });
    document.getElementById("backBtn").addEventListener("click", () => {
        connection.invoke("LeaveConnectSumRoom", roomId).finally(() => { window.location.href = "/lobby"; });
    });

    initChat(connection, roomId);
}

function renderRoom(room) {
    hostName = room.hostName;
    document.getElementById("roomTitle").textContent = room.settings?.roomName || "🔴 Connect a Sum Room";
    const players = room.players || [];
    document.getElementById("playerCount").textContent = players.length + "/2";

    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    players.forEach(p => {
        const div = document.createElement("div");
        div.className = "room-player-item" + (p.name === myName ? " is-me" : "");
        div.innerHTML = avatarHtml(p.name, 'sm') + '<span class="room-player-name">' + esc(p.name) + (p.name === room.hostName ? ' <span class="host-badge">Host</span>' : '') + '</span>';
        list.appendChild(div);
    });

    const isHost = myName === room.hostName;
    const canStart = players.length >= 2;
    document.getElementById("startBtn").style.display = isHost ? "inline-flex" : "none";
    document.getElementById("startBtn").disabled = !canStart;
    document.getElementById("waitMsg").style.display = !isHost ? "block" : "none";
    if (!isHost) document.getElementById("hostNameWait").textContent = room.hostName;
}

function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close = document.getElementById("chatClose"), input = document.getElementById("chatInput"),
          send = document.getElementById("chatSend"), msgs = document.getElementById("chatMessages"),
          badge = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread = 0; badge.style.display = "none"; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = "none"; };
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
