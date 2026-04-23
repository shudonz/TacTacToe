const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("battleBoatRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Battle Boat room id");
}
let myName = "";
let isHost = false;

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

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
    el.setSelectionRange(0, el.value.length);
    document.execCommand("copy");
    document.body.removeChild(el);
}

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById("roomCode").textContent = shortCode;
    document.getElementById("copyCodeBtn").addEventListener("click", () => {
        copyToClipboard(shortCode);
        showCopyToast("Room code copied!");
    });
    document.getElementById("copyLinkBtn").addEventListener("click", () => {
        copyToClipboard(window.location.origin + "/lobby?join=" + roomId + "&game=battle-boat");
        showCopyToast("Invite link copied!");
    });

    connection.on("BattleBoatRoomUpdated", room => renderRoom(room));
    connection.on("BattleBoatRoomDissolved", () => { alert("The room was closed."); window.location.href = "/lobby"; });
    connection.on("KickedFromRoom", () => { alert("You were kicked."); window.location.href = "/lobby"; });
    connection.on("BattleBoatGameStarted", room => {
        sessionStorage.setItem("battleBoatRoomId", room.id);
        sessionStorage.setItem("battleBoatMultiplayer", "1");
        window.location.href = "/battle-boat-game";
    });

    await connection.start();
    await connection.invoke("RejoinBattleBoatRoom", roomId);
    initChat(connection, roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = room.settings.roomName || "Battle Boat Match";
    document.getElementById("playerCount").textContent = room.players.length + "/" + room.settings.maxPlayers;

    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        const name = document.createElement("span");
        name.className = "room-player-name";
        name.textContent = p.name;
        el.appendChild(name);
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
            kick.textContent = "✕";
            kick.addEventListener("click", () => kickPlayer(p.name));
            el.appendChild(kick);
        }
        list.appendChild(el);
    });

    if (isHost) {
        const canStart = room.players.length === 2;
        document.getElementById("startBtn").style.display = "inline-block";
        document.getElementById("startBtn").disabled = !canStart;
        document.getElementById("waitMsg").style.display = "none";
    } else {
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
        document.getElementById("hostNameWait").textContent = room.hostName;
    }
}

document.getElementById("startBtn").addEventListener("click", () => connection.invoke("StartBattleBoatGame", roomId));
function kickPlayer(name) { connection.invoke("KickBattleBoatPlayer", roomId, name); }
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").addEventListener("click", () =>
        connection.invoke("LeaveBattleBoatRoom", roomId).then(() => { window.location.href = "/lobby"; }));
});

function showCopyToast(msg) {
    let t = document.getElementById("copyToast");
    if (!t) { t = document.createElement("div"); t.id = "copyToast"; t.className = "copy-toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("copy-toast-show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("copy-toast-show"), 2500);
}

init();
