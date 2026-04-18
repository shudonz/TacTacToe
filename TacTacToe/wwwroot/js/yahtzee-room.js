const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("yahtzeeRoomId");
let myName = "";
let isHost = false;

function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;

    document.getElementById("roomCode").textContent = "Room ID: " + roomId;

    connection.on("YahtzeeRoomUpdated", room => renderRoom(room));

    connection.on("YahtzeeGameStarted", room => {
        sessionStorage.setItem("gameId", room.id);
        sessionStorage.setItem("myName", myName);
        window.location.href = "/yahtzee";
    });

    connection.on("KickedFromRoom", () => {
        alert("You were kicked from the room.");
        window.location.href = "/lobby";
    });

    await connection.start();
    await connection.invoke("RejoinYahtzeeRoom", roomId);
    initChat(connection, roomId, false);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById("roomTitle").textContent = room.settings.roomName || "Yahtzee Room";

    // Players
    const list = document.getElementById("roomPlayers");
    list.innerHTML = "";
    const countHtml = '<div class="room-player-count">' + room.players.length + '/' + room.settings.maxPlayers + ' players</div>';
    list.innerHTML = countHtml;
    room.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "room-player" + (p.name === myName ? " is-me" : "");
        let html = '<span class="room-player-name">' + escapeHtml(p.name) + '</span>';
        if (p.name === room.hostName) html += '<span class="room-host-badge">HOST</span>';
        if (p.name === myName) html += '<span class="you-tag">You</span>';
        if (isHost && p.name !== myName) {
            html += '<button class="btn-kick" onclick="kickPlayer(\'' + escapeHtml(p.name) + '\')">✕</button>';
        }
        el.innerHTML = html;
        list.appendChild(el);
    });

    // Settings panel
    if (isHost) {
        document.getElementById("settingsPanel").style.display = "block";
        document.getElementById("settingsReadonly").style.display = "none";
        const s = room.settings;
        document.getElementById("sRoomName").value = s.roomName;
        document.getElementById("sMaxPlayers").value = s.maxPlayers;
        document.getElementById("sRollsPerTurn").value = s.rollsPerTurn;
        document.getElementById("sNumDice").value = s.numberOfDice;
        document.getElementById("sUpperThreshold").value = s.upperBonusThreshold;
        document.getElementById("sUpperBonus").value = s.upperBonusPoints;
        document.getElementById("sTurnTime").value = s.turnTimeLimitSeconds;
        document.getElementById("sFullHouse").value = s.fullHouseScore;
        document.getElementById("sSmStraight").value = s.smallStraightScore;
        document.getElementById("sLgStraight").value = s.largeStraightScore;
        document.getElementById("sYahtzee").value = s.yahtzeeScore;
        document.getElementById("sForce").checked = s.forceScoreBestCategory;
        document.getElementById("sPrivate").checked = s.isPrivate;
        document.getElementById("startBtn").style.display = room.players.length >= 2 ? "inline-block" : "none";
        document.getElementById("waitMsg").style.display = "none";
    } else {
        document.getElementById("settingsPanel").style.display = "none";
        document.getElementById("settingsReadonly").style.display = "block";
        const s = room.settings;
        document.getElementById("settingsDisplay").innerHTML =
            '<div>' + settingLine("Max Players", s.maxPlayers) +
            settingLine("Rolls/Turn", s.rollsPerTurn) +
            settingLine("Dice", s.numberOfDice) +
            settingLine("Upper Bonus", s.upperBonusThreshold + " → " + s.upperBonusPoints + "pts") +
            settingLine("Turn Time", s.turnTimeLimitSeconds === 0 ? "Unlimited" : s.turnTimeLimitSeconds + "s") +
            settingLine("Full House", s.fullHouseScore) +
            settingLine("Sm Straight", s.smallStraightScore) +
            settingLine("Lg Straight", s.largeStraightScore) +
            settingLine("Yahtzee", s.yahtzeeScore) +
            settingLine("Force Best", s.forceScoreBestCategory ? "Yes" : "No") + '</div>';
        document.getElementById("startBtn").style.display = "none";
        document.getElementById("waitMsg").style.display = "block";
    }
}

function settingLine(label, value) {
    return '<div class="setting-ro"><span class="setting-ro-label">' + label + '</span><span class="setting-ro-val">' + value + '</span></div>';
}

document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    const settings = {
        roomName: document.getElementById("sRoomName").value,
        maxPlayers: parseInt(document.getElementById("sMaxPlayers").value) || 4,
        rollsPerTurn: parseInt(document.getElementById("sRollsPerTurn").value) || 3,
        numberOfDice: parseInt(document.getElementById("sNumDice").value) || 5,
        upperBonusThreshold: parseInt(document.getElementById("sUpperThreshold").value) || 63,
        upperBonusPoints: parseInt(document.getElementById("sUpperBonus").value) || 35,
        turnTimeLimitSeconds: parseInt(document.getElementById("sTurnTime").value) || 0,
        fullHouseScore: parseInt(document.getElementById("sFullHouse").value) || 25,
        smallStraightScore: parseInt(document.getElementById("sSmStraight").value) || 30,
        largeStraightScore: parseInt(document.getElementById("sLgStraight").value) || 40,
        yahtzeeScore: parseInt(document.getElementById("sYahtzee").value) || 50,
        forceScoreBestCategory: document.getElementById("sForce").checked,
        isPrivate: document.getElementById("sPrivate").checked
    };
    connection.invoke("UpdateYahtzeeSettings", roomId, settings);
});

document.getElementById("startBtn").addEventListener("click", () => {
    connection.invoke("StartYahtzeeGame", roomId);
});

function kickPlayer(name) {
    connection.invoke("KickPlayer", roomId, name);
}

document.getElementById("backBtn").addEventListener("click", () => {
    connection.invoke("LeaveYahtzee", roomId).then(() => { window.location.href = "/lobby"; });
});

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
        if (isLobby) conn.invoke('SendLobbyChat', msg);
        else conn.invoke('SendChat', groupId, msg);
        input.value = '';
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    conn.on('ChatMessage', (name, message, time) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = '<span class="chat-name">' + escapeHtml(name) + '</span> <span class="chat-text">' + escapeHtml(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}

init();
