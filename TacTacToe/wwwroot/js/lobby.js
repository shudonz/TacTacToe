const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
// No game selected on initial load — user must pick one. This hides all game
// sections so the page shows only the game picker buttons.
let selectedGame = "";

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
            // On mobile, scroll the detail panel into view
            const detail = document.querySelector(".lobby-detail");
            if (detail && window.innerWidth < 768) detail.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });

    function updateSections() {
        const panels = {
            tictactoe:     "tttPanel",
            yahtzee:       "yahtzeePanel",
            slots:         "slotsPanel",
            concentration: "concentrationPanel"
        };

        // Show welcome state when no game is selected, otherwise hide it
        document.getElementById("lobbyEmptyState").style.display = selectedGame ? "none" : "";

        // Show only the selected game's panel
        Object.entries(panels).forEach(([game, id]) => {
            document.getElementById(id).style.display = selectedGame === game ? "" : "none";
        });

        // Only request room lists for the selected game
        if (selectedGame === "tictactoe")     connection.invoke("GetTttRooms");
        else if (selectedGame === "slots")    connection.invoke("GetSlotsRooms");
        else if (selectedGame === "concentration") connection.invoke("GetConcentrationRooms");
        else if (selectedGame === "yahtzee")  connection.invoke("GetYahtzeeRooms");
    }

    // TTT room list
    connection.on("TttRoomList", rooms => {
        const list = document.getElementById("tttRoomList");
        const noRooms = document.getElementById("noTttRooms");
        list.innerHTML = "";
        const open = rooms.filter(r => !r.started);
        if (open.length === 0) {
            noRooms.style.display = "block";
        } else {
            noRooms.style.display = "none";
            open.forEach(r => {
                const isFull = r.isFull;
                const card = document.createElement("div");
                card.className = "player-card room-list-card" + (isFull ? " room-full" : "");
                const badge = isFull
                    ? '<span class="room-badge room-badge-full">Full</span>'
                    : '<span class="room-badge room-badge-open">Open</span>';
                card.innerHTML =
                    '<span class="game-option-icon" style="font-size:1.4rem;">✕○</span>'
                    + '<div class="room-card-info">'
                    + '<span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span>'
                    + '</div>'
                    + '<div class="room-card-right">'
                    + '<span class="room-player-count-badge">' + r.playerCount + '/2</span>'
                    + badge
                    + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '')
                    + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => {
                        e.stopPropagation();
                        joinTttRoom(r.id);
                    });
                    card.onclick = () => joinTttRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("TttRoomCreated", roomId => {
        sessionStorage.setItem("tttRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/ttt-room";
    });

    // Slots room list
    connection.on("SlotsRoomList", rooms => {
        const list = document.getElementById("slotsRoomList");
        const noRooms = document.getElementById("noSlotsRooms");
        list.innerHTML = "";
        const open = rooms.filter(r => !r.started);
        if (open.length === 0) {
            noRooms.style.display = "block";
        } else {
            noRooms.style.display = "none";
            open.forEach(r => {
                const isFull = r.isFull;
                const card = document.createElement("div");
                card.className = "player-card room-list-card" + (isFull ? " room-full" : "");
                const badge = isFull ? '<span class="room-badge room-badge-full">Full</span>' : '<span class="room-badge room-badge-open">Open</span>';
                card.innerHTML =
                    '<span class="game-option-icon" style="font-size:1.4rem;">🎰</span>'
                    + '<div class="room-card-info"><span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span></div>'
                    + '<div class="room-card-right"><span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badge + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '') + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => { e.stopPropagation(); joinSlotsRoom(r.id); });
                    card.onclick = () => joinSlotsRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("SlotsRoomCreated", roomId => {
        sessionStorage.setItem("slotsRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/slots-room";
    });

    connection.on("SlotsSinglePlayerStarted", roomId => {
        sessionStorage.setItem("slotsRoomId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/slots";
    });

    // Concentration room list
    connection.on("ConcentrationRoomList", rooms => {
        const list = document.getElementById("concentrationRoomList");
        const noRooms = document.getElementById("noConcentrationRooms");
        list.innerHTML = "";
        const open = rooms.filter(r => !r.started);
        if (open.length === 0) {
            noRooms.style.display = "block";
        } else {
            noRooms.style.display = "none";
            open.forEach(r => {
                const isFull = r.isFull;
                const card = document.createElement("div");
                card.className = "player-card room-list-card" + (isFull ? " room-full" : "");
                const badge = isFull ? '<span class="room-badge room-badge-full">Full</span>' : '<span class="room-badge room-badge-open">Open</span>';
                card.innerHTML =
                    '<span class="game-option-icon" style="font-size:1.4rem;">🧩</span>'
                    + '<div class="room-card-info"><span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span></div>'
                    + '<div class="room-card-right"><span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badge + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '') + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => { e.stopPropagation(); joinConcentrationRoom(r.id); });
                    card.onclick = () => joinConcentrationRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("ConcentrationRoomCreated", roomId => {
        sessionStorage.setItem("concentrationRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/concentration-room";
    });

    connection.on("ConcentrationSinglePlayerStarted", roomId => {
        sessionStorage.setItem("concentrationRoomId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/concentration";
    });

    // Yahtzee room list
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
                        joinYahtzeeRoom(r.id);
                    });
                    card.onclick = () => joinYahtzeeRoom(r.id);
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

    connection.on("YahtzeeSinglePlayerStarted", roomId => {
        sessionStorage.setItem("gameId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/yahtzee";
    });

    // TTT SP navigates through lobby GameStarted
    connection.on("GameStarted", (gameId, mark, xName, oName) => {
        sessionStorage.setItem("gameId", gameId);
        sessionStorage.setItem("myMark", mark);
        sessionStorage.setItem("xName", xName);
        sessionStorage.setItem("oName", oName);
        window.location.href = "/game";
    });

    await connection.start();
    updateSections();

    // Single player — Tic Tac Toe
    document.getElementById("tttRegularBtn").addEventListener("click", () => { sessionStorage.setItem("isSinglePlayer", "1"); spInvoke("StartSinglePlayerTTT", "regular"); });
    document.getElementById("tttHardBtn").addEventListener("click",    () => { sessionStorage.setItem("isSinglePlayer", "1"); spInvoke("StartSinglePlayerTTT", "hard"); });

    // Single player — Yahtzee
    document.getElementById("yahtzeeRegularBtn").addEventListener("click", () => spInvoke("StartYahtzeeSinglePlayer", "regular"));
    document.getElementById("yahtzeeHardBtn").addEventListener("click",    () => spInvoke("StartYahtzeeSinglePlayer", "hard"));

    // Auto-join via invite link (defaults to Yahtzee when no game query is provided)
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get("join");
    const gameParam = params.get("game");
    if (joinParam) {
        window.history.replaceState({}, "", "/lobby");
        if (gameParam === "ttt") joinTttRoom(joinParam);
        else if (gameParam === "slots") joinSlotsRoom(joinParam);
        else if (gameParam === "concentration") joinConcentrationRoom(joinParam);
        else joinYahtzeeRoom(joinParam);
    }

    // Create TTT room
    document.getElementById("createTttRoomBtn").addEventListener("click", () => {
        document.getElementById("newTttRoomName").value = "";
        document.getElementById("createTttRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newTttRoomName").focus(), 50);
    });
    document.getElementById("createTttRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createTttRoomModal").style.display = "none";
    });
    document.getElementById("createTttRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newTttRoomName").value.trim() || "Tic Tac Toe";
        document.getElementById("createTttRoomModal").style.display = "none";
        connection.invoke("CreateTttRoom", name);
    });
    document.getElementById("newTttRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createTttRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createTttRoomCancelBtn").click();
    });

    // Slots single player
    document.getElementById("slotsSpBtn").addEventListener("click", () => {
        sessionStorage.setItem("myName", me.name);
        connection.invoke("StartSlotsSinglePlayer");
    });

    // Create Slots room
    document.getElementById("createSlotsRoomBtn").addEventListener("click", () => {
        document.getElementById("newSlotsRoomName").value = "";
        document.getElementById("createSlotsRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newSlotsRoomName").focus(), 50);
    });
    document.getElementById("createSlotsRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createSlotsRoomModal").style.display = "none";
    });
    document.getElementById("createSlotsRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newSlotsRoomName").value.trim() || "Slots Room";
        document.getElementById("createSlotsRoomModal").style.display = "none";
        connection.invoke("CreateSlotsRoom", name);
    });
    document.getElementById("newSlotsRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createSlotsRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createSlotsRoomCancelBtn").click();
    });

    // Concentration single player
    document.getElementById("concentrationEasyBtn").addEventListener("click",    () => spConcentration("easy"));
    document.getElementById("concentrationRegularBtn").addEventListener("click", () => spConcentration("regular"));
    document.getElementById("concentrationHardBtn").addEventListener("click",    () => spConcentration("hard"));

    // Create Concentration room
    document.getElementById("createConcentrationRoomBtn").addEventListener("click", () => {
        document.getElementById("newConcentrationRoomName").value = "";
        document.getElementById("createConcentrationRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newConcentrationRoomName").focus(), 50);
    });
    document.getElementById("createConcentrationRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createConcentrationRoomModal").style.display = "none";
    });
    document.getElementById("createConcentrationRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newConcentrationRoomName").value.trim() || "Concentration Madness";
        document.getElementById("createConcentrationRoomModal").style.display = "none";
        connection.invoke("CreateConcentrationRoom", name);
    });
    document.getElementById("newConcentrationRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createConcentrationRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createConcentrationRoomCancelBtn").click();
    });

    // Create Yahtzee room
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

function joinSlotsRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinSlotsRoom", roomId).then(() => {
        sessionStorage.setItem("slotsRoomId", roomId);
        window.location.href = "/slots-room";
    });
}

function joinTttRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinTttRoom", roomId).then(() => {
        sessionStorage.setItem("tttRoomId", roomId);
        window.location.href = "/ttt-room";
    });
}

function joinYahtzeeRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinYahtzeeRoom", roomId).then(() => {
        sessionStorage.setItem("yahtzeeRoomId", roomId);
        window.location.href = "/yahtzee-room";
    });
}

function joinConcentrationRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinConcentrationRoom", roomId).then(() => {
        sessionStorage.setItem("concentrationRoomId", roomId);
        window.location.href = "/concentration-room";
    });
}

// Ensures the connection is live before invoking a hub method
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

function spConcentration(difficulty) {
    const ids = { easy: "concentrationEasyBtn", regular: "concentrationRegularBtn", hard: "concentrationHardBtn" };
    const labels = { easy: "Easy", regular: "Regular", hard: "💀 Hard" };
    const btn = document.getElementById(ids[difficulty]);
    if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }

    const doInvoke = () => connection.invoke("StartConcentrationSinglePlayer", difficulty).catch(err => {
        console.error("spConcentration failed:", err);
        if (btn) { btn.disabled = false; btn.textContent = labels[difficulty]; }
    });

    if (connection.state === signalR.HubConnectionState.Connected) {
        doInvoke();
    } else {
        connection.start().then(doInvoke).catch(err => {
            console.error("Reconnect failed:", err);
            if (btn) { btn.disabled = false; btn.textContent = labels[difficulty]; }
        });
    }
}

/* ----------------------------------------------------------------
   Mobile tooltip support — tap a [data-tooltip] button to reveal,
   tap anywhere else (or wait 2.5 s) to dismiss.
----------------------------------------------------------------- */
(function initTooltipTouch() {
    let _activeTooltip = null;
    let _dismissTimer  = null;

    function dismiss() {
        if (_activeTooltip) { _activeTooltip.classList.remove("tooltip-active"); _activeTooltip = null; }
        clearTimeout(_dismissTimer);
    }

    document.addEventListener("touchstart", e => {
        const target = e.target.closest("[data-tooltip]");
        if (target) {
            if (_activeTooltip === target) { dismiss(); return; }   // second tap hides it
            dismiss();
            _activeTooltip = target;
            target.classList.add("tooltip-active");
            _dismissTimer = setTimeout(dismiss, 2500);
        } else {
            dismiss();
        }
    }, { passive: true });
})();

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
