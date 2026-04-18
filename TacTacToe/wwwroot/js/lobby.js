const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
let myConnectionId = null;
let selectedGame = "tictactoe";

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    document.getElementById("userName").textContent = me.name;
    document.getElementById("userAvatar").src = me.picture || "https://ui-avatars.com/api/?name=" + encodeURIComponent(me.name) + "&background=6c63ff&color=fff";

    // Game picker
    document.querySelectorAll(".game-option").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".game-option").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedGame = btn.dataset.game;
            updateSections();
        });
    });

    function updateSections() {
        const ttt = selectedGame === "tictactoe";
        document.getElementById("tttSection").style.display = ttt ? "" : "none";
        document.getElementById("tttHint").style.display = ttt ? "" : "none";
        document.getElementById("tttSinglePlayer").style.display = ttt ? "" : "none";
        document.getElementById("playerList").style.display = ttt ? "" : "none";
        document.getElementById("waitingMsg").style.display = ttt ? "" : "none";
        document.getElementById("yahtzeeSection").style.display = ttt ? "none" : "";
        if (!ttt) connection.invoke("GetYahtzeeRooms");
    }

    connection.on("LobbyUpdated", players => {
        const list = document.getElementById("playerList");
        const waiting = document.getElementById("waitingMsg");
        list.innerHTML = "";
        const others = players.filter(p => p.connectionId !== myConnectionId);
        if (others.length === 0) {
            waiting.style.display = selectedGame === "tictactoe" ? "block" : "none";
        } else {
            waiting.style.display = "none";
        }
        players.forEach(p => {
            const isMe = p.connectionId === myConnectionId;
            const card = document.createElement("div");
            card.className = "player-card" + (isMe ? " is-me" : "");
            card.innerHTML = '<img class="avatar" src="' + (p.picture || "https://ui-avatars.com/api/?name=" + encodeURIComponent(p.name) + "&background=6c63ff&color=fff") + '" alt="">'
                + '<span class="name">' + escapeHtml(p.name) + '</span>'
                + (isMe ? '<span class="you-tag">You</span>' : "");
            if (!isMe) card.onclick = () => challengePlayer(p.connectionId);
            list.appendChild(card);
        });
    });

    connection.on("YahtzeeRoomList", rooms => {
        const list = document.getElementById("roomList");
        const noRooms = document.getElementById("noRooms");
        list.innerHTML = "";
        const openRooms = rooms.filter(r => !r.started);
        if (openRooms.length === 0) {
            noRooms.style.display = "block";
        } else {
            noRooms.style.display = "none";
            openRooms.forEach(r => {
                const isFull = r.isFull;
                const card = document.createElement("div");
                card.className = "player-card room-list-card" + (isFull ? " room-full" : "");
                const badges = isFull
                    ? '<span class="room-badge room-badge-full">Full</span>'
                    : '<span class="room-badge room-badge-open">Open</span>';
                card.innerHTML =
                    '<span class="game-option-icon" style="font-size:1.4rem;">&#127922;</span>'
                    + '<div class="room-card-info">'
                    + '<span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span>'
                    + '</div>'
                    + '<div class="room-card-right">'
                    + '<span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badges
                    + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '')
                    + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => {
                        e.stopPropagation();
                        joinRoom(r.id);
                    });
                    card.onclick = () => joinRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("YahtzeeRoomCreated", roomId => {
        sessionStorage.setItem("isSinglePlayer", "0");
        sessionStorage.setItem("yahtzeeRoomId", roomId);
        window.location.href = "/yahtzee-room";
    });

    connection.on("ChallengeReceived", (challengerId, name, picture, gameType) => {
        document.getElementById("challengeText").textContent = name + " challenges you to Tic Tac Toe!";
        document.getElementById("challengeModal").style.display = "flex";
        document.getElementById("acceptBtn").onclick = () => {
            sessionStorage.setItem("isSinglePlayer", "0");
            connection.invoke("AcceptChallenge", challengerId);
            document.getElementById("challengeModal").style.display = "none";
        };
        document.getElementById("declineBtn").onclick = () => {
            connection.invoke("DeclineChallenge", challengerId);
            document.getElementById("challengeModal").style.display = "none";
        };
    });

    connection.on("ChallengeDeclined", name => {
        document.getElementById("pendingModal").style.display = "none";
        alert(name + " declined your challenge.");
    });

    connection.on("GameStarted", (gameId, mark, xName, oName) => {
        sessionStorage.setItem("gameId", gameId);
        sessionStorage.setItem("myMark", mark);
        sessionStorage.setItem("xName", xName);
        sessionStorage.setItem("oName", oName);
        window.location.href = "/game";
    });

    connection.on("YahtzeeSinglePlayerStarted", roomId => {
        sessionStorage.setItem("gameId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/yahtzee";
    });

    await connection.start();
    myConnectionId = connection.connectionId;
    updateSections();

    // Single player — Tic Tac Toe
    document.getElementById("tttRegularBtn").addEventListener("click", () => { sessionStorage.setItem("isSinglePlayer", "1"); spInvoke("StartSinglePlayerTTT", "regular"); });
    document.getElementById("tttHardBtn").addEventListener("click",    () => { sessionStorage.setItem("isSinglePlayer", "1"); spInvoke("StartSinglePlayerTTT", "hard"); });

    // Single player — Yahtzee
    document.getElementById("yahtzeeRegularBtn").addEventListener("click", () => spInvoke("StartYahtzeeSinglePlayer", "regular"));
    document.getElementById("yahtzeeHardBtn").addEventListener("click",    () => spInvoke("StartYahtzeeSinglePlayer", "hard"));

    // Auto-join if an invite link was used (?join=roomId)
    const joinParam = new URLSearchParams(window.location.search).get("join");
    if (joinParam) {
        window.history.replaceState({}, "", "/lobby");
        joinRoom(joinParam);
    }

    // Create room button — open modal
    document.getElementById("createRoomBtn").addEventListener("click", () => {
        document.getElementById("newRoomName").value = "";
        document.getElementById("createRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newRoomName").focus(), 50);
    });

    document.getElementById("createRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createRoomModal").style.display = "none";
    });

    document.getElementById("createRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newRoomName").value.trim() || "Yahtzee Room";
        document.getElementById("createRoomModal").style.display = "none";
        connection.invoke("CreateYahtzeeRoom", name);
    });

    document.getElementById("newRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createRoomCancelBtn").click();
    });

    // Chat
    initChat(connection, null, true);
}

function joinRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinYahtzeeRoom", roomId).then(() => {
        sessionStorage.setItem("yahtzeeRoomId", roomId);
        window.location.href = "/yahtzee-room";
    });
}

function challengePlayer(connId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("Challenge", connId, "tictactoe");
    document.getElementById("pendingModal").style.display = "flex";
    setTimeout(() => { document.getElementById("pendingModal").style.display = "none"; }, 15000);
}

// Ensures the connection is live before invoking a hub method — handles
// the mobile case where the browser may have suspended the WebSocket.
function spInvoke(method, difficulty) {
    const btn = document.getElementById(
        method === "StartSinglePlayerTTT"
            ? (difficulty === "hard" ? "tttHardBtn" : "tttRegularBtn")
            : (difficulty === "hard" ? "yahtzeeHardBtn" : "yahtzeeRegularBtn")
    );
    if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }

    const doInvoke = () => connection.invoke(method, difficulty).catch(err => {
        console.error("spInvoke failed:", err);
        if (btn) { btn.disabled = false; btn.textContent = difficulty === "hard" ? "💀 Hard" : "Regular"; }
    });

    if (connection.state === signalR.HubConnectionState.Connected) {
        doInvoke();
    } else {
        connection.start().then(doInvoke).catch(err => {
            console.error("Reconnect failed:", err);
            if (btn) { btn.disabled = false; btn.textContent = difficulty === "hard" ? "💀 Hard" : "Regular"; }
        });
    }
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
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
        if (isLobby) conn.invoke('SendLobbyChat', msg);
        else conn.invoke('SendChat', groupId, msg);
        input.value = '';
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    const eventName = isLobby ? 'LobbyChatMessage' : 'ChatMessage';
    conn.on(eventName, (name, message, time) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = '<span class="chat-name">' + escapeHtml(name) + '</span> <span class="chat-text">' + escapeHtml(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}

init();
