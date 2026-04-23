const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("puzzleTimeRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Puzzle Time room id");
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

function imageLabel(key) {
    if (key === "emoji-space") return "Space Quest";
    if (key === "emoji-ocean") return "Ocean Life";
    if (key === "emoji-snacks") return "Snack Party";
    return "Emoji Garden";
}

async function init() {
    const me = await fetch("/api/me").then(r => r.json());
    myName = me.name;

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById("roomCode").textContent = shortCode;
    document.getElementById("copyCodeBtn").addEventListener("click", () => {
        copyToClipboard(shortCode); showCopyToast("Room code copied!");
    });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
        copyToClipboard(window.location.origin + "/lobby?join=" + roomId + "&game=puzzle-time");
        showCopyToast("Invite link copied!");
    });

    connection.on("PuzzleTimeRoomUpdated", room => renderRoom(room));
    connection.on("PuzzleTimeRoomDissolved", () => { alert("The room was closed."); window.location.href = "/lobby"; });
    connection.on("KickedFromRoom", () => { alert("You were kicked."); window.location.href = "/lobby"; });
    connection.on("PuzzleTimeGameStarted", room => {
        sessionStorage.setItem("puzzleTimeRoomId", room.id);
        window.location.href = "/puzzle-time";
    });

    await connection.start();
    await connection.invoke("RejoinPuzzleTimeRoom", roomId);
    initChat(connection, roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = room.settings.roomName || "Puzzle Time Room";
    document.getElementById("playerCount").textContent = room.players.length + "/" + room.settings.maxPlayers;
    document.getElementById("roomSettingsText").textContent =
        `Design: ${imageLabel(room.settings.imageKey)} · Pieces: ${room.settings.pieceCount}`;

    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        const nameEl = document.createElement("span");
        nameEl.className = "room-player-name";
        nameEl.textContent = p.name;
        el.appendChild(nameEl);

        if (p.name === room.hostName) {
            const host = document.createElement("span");
            host.className = "room-host-badge";
            host.textContent = "HOST";
            el.appendChild(host);
        }
        if (p.name === myName) {
            const you = document.createElement("span");
            you.className = "you-tag";
            you.textContent = "You";
            el.appendChild(you);
        }
        if (isHost && p.name !== myName) {
            const kick = document.createElement("button");
            kick.className = "btn-kick";
            kick.type = "button";
            kick.innerHTML = "&#x2715;";
            kick.addEventListener("click", () => kickPlayer(p.name));
            el.appendChild(kick);
        }
        list.appendChild(el);
    });

    if (isHost) {
        const canStart = room.players.length >= 2;
        document.getElementById("startBtn").style.display = "inline-block";
        document.getElementById("startBtn").disabled = !canStart;
        document.getElementById("waitMsg").style.display = "none";
    } else {
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
        document.getElementById("hostNameWait").textContent = room.hostName;
    }
}

document.getElementById("startBtn").addEventListener("click", () => connection.invoke("StartPuzzleTimeGame", roomId));
function kickPlayer(name) { connection.invoke("KickPuzzleTimePlayer", roomId, name); }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").addEventListener("click", () =>
        connection.invoke("LeavePuzzleTimeRoom", roomId).then(() => { window.location.href = "/lobby"; }));
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
        el.innerHTML = '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; }
    });
}

init();
