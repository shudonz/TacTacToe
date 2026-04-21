const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("chineseCheckersRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Chinese Checkers room id");
}

let myName = "";
let isHost = false;

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => execCopy(text));
    execCopy(text);
}
function execCopy(text) {
    const el = document.createElement("textarea");
    el.value = text; el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(el); el.select();
    document.execCommand("copy"); document.body.removeChild(el);
}

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById("roomCode").textContent = shortCode;
    document.getElementById("copyCodeBtn").onclick = () => { copyToClipboard(shortCode); showCopyToast("Room code copied!"); };
    document.getElementById("copyLinkBtn").onclick = () => {
        copyToClipboard(window.location.origin + "/lobby?join=" + roomId + "&game=chinese-checkers");
        showCopyToast("Invite link copied!");
    };

    connection.on("ChineseCheckersRoomUpdated", renderRoom);
    connection.on("ChineseCheckersRoomDissolved", () => { alert("The room was closed."); window.location.href = "/lobby"; });
    connection.on("KickedFromRoom", () => { alert("You were kicked."); window.location.href = "/lobby"; });
    connection.on("ChineseCheckersGameStarted", room => {
        sessionStorage.setItem("chineseCheckersRoomId", room.id);
        window.location.href = "/chinese-checkers";
    });

    await connection.start();
    await connection.invoke("RejoinChineseCheckersRoom", roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = room.settings.roomName || "Chinese Checkers Room";
    document.getElementById("playerCount").textContent = room.players.length + "/" + room.settings.maxPlayers;

    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";

    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        el.innerHTML = '<span class="room-player-name">' + esc(p.name) + '</span>';
        if (p.name === room.hostName) el.innerHTML += '<span class="room-host-badge">HOST</span>';
        if (p.name === myName) el.innerHTML += '<span class="you-tag">You</span>';
        if (isHost && p.name !== myName) el.innerHTML += '<button class="btn-kick" onclick="kickPlayer(\'' + esc(p.name).replace(/'/g, "\\'") + '\')">&#x2715;</button>';
        list.appendChild(el);
    });

    const fillWrap = document.getElementById("fillBotsWrap");
    fillWrap.style.display = isHost ? "" : "none";

    if (isHost) {
        document.getElementById("startBtn").style.display = "inline-block";
        document.getElementById("waitMsg").style.display = "none";
        const canStart = room.players.length >= 2 || document.getElementById("fillBotsToggle").checked;
        document.getElementById("startBtn").disabled = !canStart;
    } else {
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
        document.getElementById("hostNameWait").textContent = room.hostName;
    }
}

document.getElementById("startBtn").addEventListener("click", () => {
    const fillBots = !!document.getElementById("fillBotsToggle").checked;
    connection.invoke("StartChineseCheckersGame", roomId, fillBots);
});

document.getElementById("fillBotsToggle").addEventListener("change", () => {
    const startBtn = document.getElementById("startBtn");
    if (isHost && startBtn.style.display !== "none") startBtn.disabled = false;
});

function kickPlayer(name) { connection.invoke("KickChineseCheckersPlayer", roomId, name); }

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("backBtn").addEventListener("click", () =>
        connection.invoke("LeaveChineseCheckersRoom", roomId).then(() => { window.location.href = "/lobby"; }));
});

function showCopyToast(msg) {
    let t = document.getElementById("copyToast");
    if (!t) { t = document.createElement("div"); t.id = "copyToast"; t.className = "copy-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("copy-toast-show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("copy-toast-show"), 2500);
}

init();
