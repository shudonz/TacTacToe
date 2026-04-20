const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("tttRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Tic Tac Toe room id");
}
let myName = "";
let isHost = false;

function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => execCopy(text));
    }
    execCopy(text);
}
function execCopy(text) {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, el.value.length); // iOS
    document.execCommand("copy");
    document.body.removeChild(el);
}

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;
    // Pre-cache own avatar
    await fetchAvatars([myName]);

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById("roomCode").textContent = shortCode;

    document.getElementById("copyCodeBtn").addEventListener("click", () => {
        copyToClipboard(shortCode);
        showCopyToast("Room code copied!");
    });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
        const link = window.location.origin + "/lobby?join=" + roomId + "&game=ttt";
        copyToClipboard(link);
        showCopyToast("Invite link copied!");
    });

    connection.on("TttRoomUpdated", room => renderRoom(room));

    connection.on("TttRoomDissolved", () => {
        alert("The host left and the room was closed.");
        window.location.href = "/lobby";
    });

    connection.on("KickedFromRoom", () => {
        alert("You were kicked from the room.");
        window.location.href = "/lobby";
    });

    // When the host starts the game, both players receive GameStarted
    connection.on("GameStarted", (gameId, mark, xName, oName) => {
        sessionStorage.setItem("gameId", gameId);
        sessionStorage.setItem("myMark", mark);
        sessionStorage.setItem("xName", xName);
        sessionStorage.setItem("oName", oName);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/game";
    });

    await connection.start();
    await connection.invoke("RejoinTttRoom", roomId);
    initChat(connection, roomId, false);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = escapeHtml(room.roomName) || "Tic Tac Toe Room";
    document.getElementById("playerCount").textContent = room.players.length + "/2";

    // Fetch any avatars we haven't seen yet, then re-render the list
    fetchAvatars(room.players.map(p => p.name)).then(() => _renderPlayerList(room));
    _renderPlayerList(room); // render immediately with whatever is cached
}

function _renderPlayerList(room) {
    isHost = room.hostName === myName;
    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        let html = avatarHtml(p.name, 'sm') + '<span class="room-player-name">' + escapeHtml(p.name) + '</span>';
        if (p.name === room.hostName) html += '<span class="room-host-badge">HOST</span>';
        if (p.name === myName) html += '<span class="you-tag">You</span>';
        if (isHost && p.name !== myName) {
            html += '<button class="btn-kick" onclick="kickPlayer(\'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\')">✕</button>';
        }
        el.innerHTML = html;
        list.appendChild(el);
    });

    if (isHost) {
        const canStart = room.players.length >= 2;
        document.getElementById("startBtn").style.display = "inline-block";
        document.getElementById("startBtn").disabled = !canStart;
        document.getElementById("startBtn").title = canStart ? "" : "Need 2 players to start";
        document.getElementById("waitMsg").style.display = "none";
    } else {
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
        document.getElementById("hostNameWait").textContent = room.hostName;
    }
}

document.getElementById("startBtn").addEventListener("click", () => {
    connection.invoke("StartTttGame", roomId);
});

function kickPlayer(name) {
    connection.invoke("KickTttPlayer", roomId, name);
}

document.getElementById("backBtn").addEventListener("click", () => {
    connection.invoke("LeaveTttRoom", roomId).then(() => { window.location.href = "/lobby"; });
});

function showCopyToast(msg) {
    let toast = document.getElementById("copyToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "copyToast";
        toast.className = "copy-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("copy-toast-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("copy-toast-show"), 2500);
}

function initChat(conn, groupId, isLobby) {
    let chatOpen = false;
    let unread = 0;
    const toggle = document.getElementById('chatToggle');
    const panel = document.getElementById('chatPanel');
    const close = document.getElementById('chatClose');
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const msgs = document.getElementById('chatMessages');
    const badge = document.getElementById('chatBadge');

    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? 'flex' : 'none'; if (chatOpen) { unread = 0; badge.style.display = 'none'; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = 'none'; };

    function doSend() {
        const msg = input.value.trim();
        if (!msg) return;
        conn.invoke('SendChat', groupId, msg);
        input.value = '';
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    conn.on('ChatMessage', (name, message) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + escapeHtml(name) + '</span> <span class="chat-text">' + escapeHtml(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}

init();
