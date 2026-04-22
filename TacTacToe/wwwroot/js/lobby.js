const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
let selectedGame = "";

function showPlaySections(key) {
    const el = document.getElementById(key + "PlaySections");
    if (!el) return;
    // Reset animation so it replays cleanly
    el.classList.remove("is-visible");
    el.style.display = "";
    void el.offsetHeight; // force reflow
    el.classList.add("is-visible");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── Dashboard ───────────────────────────────────────────────── */
const DASH_GAMES = [
    { key: "tictactoe",     api: "TicTacToe",     icon: "✕○",  label: "Tic Tac Toe"   },
    { key: "yahtzee",       api: "Yahtzee",        icon: "🎲",  label: "Yahtzee"        },
    { key: "slots",         api: "Slots",          icon: "🎰",  label: "Slots"          },
    { key: "concentration", api: "Concentration",  icon: "🧩",  label: "Concentration"  },
    { key: "solitaire",     api: "Solitaire",      icon: "🂡",  label: "Solitaire"      },
    { key: "pegsolitaire",  api: "PegSolitaire",   icon: "🟠",  label: "Peg Solitaire"  },
    { key: "chinese-checkers", api: "ChineseCheckers", icon: "🎮", label: "Chinese Checkers" },
];

async function loadDashboard(me) {
    // Fetch all histories in parallel
    const histories = await Promise.all(
        DASH_GAMES.map(g =>
            fetch("/api/me/history?game=" + encodeURIComponent(g.api) + "&limit=200")
                .then(r => r.ok ? r.json() : []).catch(() => [])
        )
    );

    /* ── Overall summary pills ────────────────────────────────── */
    let totalGames = 0, totalWins = 0, totalLosses = 0, totalSecs = 0;
    DASH_GAMES.forEach((g, i) => {
        const h = histories[i];
        totalGames  += h.length;
        totalWins   += h.filter(e => e.result === "Win").length;
        totalLosses += h.filter(e => e.result === "Loss").length;
        totalSecs   += h.reduce((s, e) => s + (e.timePlayed || 0), 0);
    });
    const winRate = (totalWins + totalLosses) > 0
        ? Math.round(totalWins / (totalWins + totalLosses) * 100) : null;
    const timeStr = totalSecs >= 3600
        ? Math.floor(totalSecs / 3600) + "h " + Math.floor((totalSecs % 3600) / 60) + "m"
        : totalSecs >= 60
            ? Math.floor(totalSecs / 60) + "m"
            : totalSecs > 0 ? totalSecs + "s" : null;

    const pills = [
        { label: "Games Played", value: totalGames,                  icon: "🎮" },
        { label: "Total Wins",   value: totalWins,                   icon: "🏆" },
        { label: "Win Rate",     value: winRate  != null ? winRate + "%" : "—", icon: "📈" },
        { label: "Time Played",  value: timeStr  || "—",             icon: "⏱️" },
    ];
    document.getElementById("dashSummary").innerHTML = pills.map(p =>
        `<div class="dash-pill">` +
        `<span class="dash-pill-icon">${p.icon}</span>` +
        `<span class="dash-pill-value">${p.value}</span>` +
        `<span class="dash-pill-label">${p.label}</span>` +
        `</div>`
    ).join("");

    /* ── Per-game rows ────────────────────────────────────────── */
    const rowsEl = document.getElementById("dashGameRows");
    rowsEl.innerHTML = "";
    DASH_GAMES.forEach((g, i) => {
        const h      = histories[i];
        const played = h.length;
        const wins   = h.filter(e => e.result === "Win").length;
        const losses = h.filter(e => e.result === "Loss").length;
        const draws  = h.filter(e => e.result === "Draw").length;
        const hasWL  = wins > 0 || losses > 0;
        const wr     = hasWL ? Math.round(wins / (wins + losses) * 100) : null;
        const best   = played > 0 ? Math.max(...h.map(e => e.score || 0)) : 0;
        const last   = played > 0
            ? new Date(Math.max(...h.map(e => new Date(e.playedAt))))
                  .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
            : null;

        const row = document.createElement("div");
        row.className = "dash-game-row" + (played === 0 ? " dash-game-row-unplayed" : "");

        if (played === 0) {
            row.innerHTML =
                `<span class="dash-game-row-icon">${g.icon}</span>` +
                `<div class="dash-game-row-body">` +
                    `<span class="dash-game-row-name">${g.label}</span>` +
                    `<span class="dash-game-row-unseen">No games played yet</span>` +
                `</div>`;
        } else {
            const wlHtml = hasWL
                ? `<span class="dash-wr-win">${wins}W</span>` +
                  (losses > 0 ? ` <span class="dash-wr-sep">/</span> <span class="dash-wr-loss">${losses}L</span>` : "") +
                  (draws  > 0 ? ` <span class="dash-wr-sep">/</span> <span class="dash-wr-draw">${draws}D</span>` : "")
                : `${played} played`;

            const barHtml = wr !== null
                ? `<div class="dash-winbar"><div class="dash-winbar-fill" style="width:${wr}%"></div></div>` : "";

            row.innerHTML =
                `<span class="dash-game-row-icon">${g.icon}</span>` +
                `<div class="dash-game-row-body">` +
                    `<div class="dash-game-row-top">` +
                        `<span class="dash-game-row-name">${g.label}</span>` +
                        `<span class="dash-game-row-meta">${wlHtml}` +
                        (wr !== null ? ` <span class="dash-wr-pct">&nbsp;· ${wr}%</span>` : "") +
                        `</span>` +
                    `</div>` +
                    barHtml +
                    `<div class="dash-game-row-bottom">` +
                        `<span class="dash-game-row-sub">${played} game${played !== 1 ? "s" : ""}` +
                        (best > 0 ? ` &middot; Best&nbsp;<strong>${best.toLocaleString()}</strong>` : "") +
                        `</span>` +
                        (last ? `<span class="dash-game-row-last">Last played ${last}</span>` : "") +
                    `</div>` +
                `</div>`;
        }
        rowsEl.appendChild(row);
    });

    /* ── Recent activity feed ─────────────────────────────────── */
    const all = [];
    DASH_GAMES.forEach((g, i) =>
        histories[i].forEach(e => all.push({ ...e, _label: g.label, _icon: g.icon }))
    );
    all.sort((a, b) => new Date(b.playedAt) - new Date(a.playedAt));

    const recentEl = document.getElementById("dashRecentList");
    if (all.length === 0) {
        recentEl.innerHTML =
            `<div class="dash-no-games">` +
            `<span class="dash-no-games-icon">🎮</span>` +
            `No games played yet — select a game on the left to jump in!` +
            `</div>`;
        return;
    }

    recentEl.innerHTML = all.slice(0, 15).map(e => {
        const r       = (e.result || "").toLowerCase();
        const rCls    = r === "win" ? "win" : r === "loss" ? "loss" : r === "draw" ? "draw" : "complete";
        const rTxt    = e.result || "Played";
        const score   = e.score > 0 ? e.score.toLocaleString() + " pts" : "";
        const timeTxt = e.timePlayed > 0
            ? (e.timePlayed >= 60
                ? Math.floor(e.timePlayed / 60) + "m " + (e.timePlayed % 60) + "s"
                : e.timePlayed + "s")
            : "";
        const date = e.playedAt
            ? new Date(e.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : "";
        return `<div class="dash-recent-row">` +
            `<span class="dash-recent-icon">${e._icon}</span>` +
            `<div class="dash-recent-body">` +
                `<span class="dash-recent-game">${e._label}</span>` +
                (timeTxt ? `<span class="dash-recent-time">${timeTxt}</span>` : "") +
            `</div>` +
            `<span class="dash-recent-result ${rCls}">${rTxt}</span>` +
            (score ? `<span class="dash-recent-score">${score}</span>` : "") +
            (date  ? `<span class="dash-recent-date">${date}</span>` : "") +
            `</div>`;
    }).join("");
}

async function init() {
    const res = await fetch("/api/me");
    const me = await res.json();
    document.getElementById("userName").textContent = me.name;
    // Cache own avatar
    await fetchAvatars([me.name]);
    if (me.avatar) {
        document.getElementById("userAvatarEmoji").textContent = me.avatar;
        document.getElementById("userAvatarEmoji").style.display = "inline-flex";
        document.getElementById("userAvatar").style.display = "none";
    } else {
        document.getElementById("userAvatar").src = "https://ui-avatars.com/api/?name=" + encodeURIComponent(me.name) + "&background=12919E&color=fff";
        document.getElementById("userAvatar").style.display = "inline-block";
        document.getElementById("userAvatarEmoji").style.display = "none";
    }
    if (me.isAdmin) document.getElementById("adminLink").style.display = "flex";

    // Load the activity dashboard in the background
    loadDashboard(me);

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
        const panels = {
            tictactoe:     "tttPanel",
            yahtzee:       "yahtzeePanel",
            slots:         "slotsPanel",
            concentration: "concentrationPanel",
            solitaire:     "solitairePanel",
            pegsolitaire:  "pegsolitairePanel",
            "chinese-checkers": "chineseCheckersPanel"
        };

        // Leaderboard containers per game  [apiGameType, lbId, histId]
        const lbMap = {
            tictactoe:     ["TicTacToe",     "ttt-lobby-lb", "ttt-lobby-hist"],
            yahtzee:       ["Yahtzee",        "ytz-lobby-lb", "ytz-lobby-hist"],
            slots:         ["Slots",          "slt-lobby-lb", "slt-lobby-hist"],
            concentration: ["Concentration",  "con-lobby-lb", "con-lobby-hist"],
            solitaire:     ["Solitaire",      "sol-lobby-lb", "sol-lobby-hist"],
            pegsolitaire:  ["PegSolitaire",   "peg-lobby-lb", "peg-lobby-hist"],
            "chinese-checkers": ["ChineseCheckers", "cc-lobby-lb", "cc-lobby-hist"]
        };

        // Show welcome state when no game is selected, otherwise hide it
        document.getElementById("lobbyEmptyState").style.display = selectedGame ? "none" : "";

        // Show only the selected game's panel; hide all play sections on game switch
        Object.entries(panels).forEach(([game, id]) => {
            document.getElementById(id).style.display = selectedGame === game ? "" : "none";
        });
        ["ttt", "yahtzee", "slots", "concentration", "solitaire", "pegsolitaire", "chineseCheckers"].forEach(key => {
            const el = document.getElementById(key + "PlaySections");
            if (el) { el.style.display = "none"; el.classList.remove("is-visible"); }
        });

        // Only request room lists for the selected game
        if (selectedGame === "tictactoe")         connection.invoke("GetTttRooms");
        else if (selectedGame === "slots")         connection.invoke("GetSlotsRooms");
        else if (selectedGame === "concentration") connection.invoke("GetConcentrationRooms");
        else if (selectedGame === "solitaire")     connection.invoke("GetSolitaireRooms");
        else if (selectedGame === "pegsolitaire")  connection.invoke("GetPegSolitaireRooms");
        else if (selectedGame === "chinese-checkers") connection.invoke("GetChineseCheckersRooms");
        else if (selectedGame === "yahtzee")       connection.invoke("GetYahtzeeRooms");

        // Load leaderboard + personal history for the selected game
        if (selectedGame && lbMap[selectedGame]) {
            const [apiType, lbId, histId] = lbMap[selectedGame];
            loadLeaderboard(apiType, document.getElementById(lbId), 5);
            loadPersonalHistory(apiType, document.getElementById(histId), 5);
        }
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

    // Solitaire room list
    connection.on("SolitaireRoomList", rooms => {
        const list = document.getElementById("solitaireRoomList");
        const noRooms = document.getElementById("noSolitaireRooms");
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
                    '<span class="game-option-icon" style="font-size:1.4rem;">🂡</span>'
                    + '<div class="room-card-info"><span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span></div>'
                    + '<div class="room-card-right"><span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badge + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '') + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => { e.stopPropagation(); joinSolitaireRoom(r.id); });
                    card.onclick = () => joinSolitaireRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("SolitaireRoomCreated", roomId => {
        sessionStorage.setItem("solitaireRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/solitaire-room";
    });

    connection.on("SolitaireSinglePlayerStarted", roomId => {
        sessionStorage.setItem("solitaireRoomId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/solitaire";
    });

    // Peg Solitaire room list
    connection.on("PegSolitaireRoomList", rooms => {
        const list = document.getElementById("pegSolitaireRoomList");
        const noRooms = document.getElementById("noPegSolitaireRooms");
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
                    '<span class="game-option-icon" style="font-size:1.4rem;">🟠</span>'
                    + '<div class="room-card-info"><span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span></div>'
                    + '<div class="room-card-right"><span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badge + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '') + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => { e.stopPropagation(); joinPegSolitaireRoom(r.id); });
                    card.onclick = () => joinPegSolitaireRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    // Chinese Checkers room list
    connection.on("ChineseCheckersRoomList", rooms => {
        const list = document.getElementById("chineseCheckersRoomList");
        const noRooms = document.getElementById("noChineseCheckersRooms");
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
                    '<span class="game-option-icon" style="font-size:1.4rem;">🎮</span>'
                    + '<div class="room-card-info"><span class="name">' + escapeHtml(r.roomName) + '</span>'
                    + '<span class="room-card-host">Hosted by ' + escapeHtml(r.hostName) + '</span></div>'
                    + '<div class="room-card-right"><span class="room-player-count-badge">' + r.playerCount + '/' + r.maxPlayers + '</span>'
                    + badge + (!isFull ? '<button class="btn btn-accept room-join-btn">Join &rarr;</button>' : '') + '</div>';
                if (!isFull) {
                    card.querySelector(".room-join-btn").addEventListener("click", e => { e.stopPropagation(); joinChineseCheckersRoom(r.id); });
                    card.onclick = () => joinChineseCheckersRoom(r.id);
                }
                list.appendChild(card);
            });
        }
    });

    connection.on("PegSolitaireRoomCreated", roomId => {
        sessionStorage.setItem("pegSolitaireRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/peg-solitaire-room";
    });

    connection.on("PegSolitaireSinglePlayerStarted", roomId => {
        sessionStorage.setItem("pegSolitaireRoomId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/peg-solitaire";
    });

    connection.on("ChineseCheckersRoomCreated", roomId => {
        sessionStorage.setItem("chineseCheckersRoomId", roomId);
        sessionStorage.setItem("isSinglePlayer", "0");
        window.location.href = "/chinese-checkers-room";
    });

    connection.on("ChineseCheckersSinglePlayerStarted", roomId => {
        sessionStorage.setItem("chineseCheckersRoomId", roomId);
        sessionStorage.setItem("myName", me.name);
        sessionStorage.setItem("isSinglePlayer", "1");
        window.location.href = "/chinese-checkers";
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
        else if (gameParam === "solitaire") joinSolitaireRoom(joinParam);
        else if (gameParam === "pegsolitaire") joinPegSolitaireRoom(joinParam);
        else if (gameParam === "chinese-checkers") joinChineseCheckersRoom(joinParam);
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

    // Solitaire single player
    document.getElementById("solitaireSpBtn").addEventListener("click", () => {
        sessionStorage.setItem("myName", me.name);
        connection.invoke("StartSolitaireSinglePlayer");
    });

    // Create Solitaire room
    document.getElementById("createSolitaireRoomBtn").addEventListener("click", () => {
        document.getElementById("newSolitaireRoomName").value = "";
        document.getElementById("createSolitaireRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newSolitaireRoomName").focus(), 50);
    });
    document.getElementById("createSolitaireRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createSolitaireRoomModal").style.display = "none";
    });
    document.getElementById("createSolitaireRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newSolitaireRoomName").value.trim() || "Solitaire Room";
        document.getElementById("createSolitaireRoomModal").style.display = "none";
        connection.invoke("CreateSolitaireRoom", name);
    });
    document.getElementById("newSolitaireRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createSolitaireRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createSolitaireRoomCancelBtn").click();
    });

    // Peg Solitaire single player
    document.getElementById("pegSolitaireSpBtn").addEventListener("click", () => {
        sessionStorage.setItem("myName", me.name);
        connection.invoke("StartPegSolitaireSinglePlayer");
    });

    // Create Peg Solitaire room
    document.getElementById("createPegSolitaireRoomBtn").addEventListener("click", () => {
        document.getElementById("newPegSolitaireRoomName").value = "";
        document.getElementById("createPegSolitaireRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newPegSolitaireRoomName").focus(), 50);
    });
    document.getElementById("createPegSolitaireRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createPegSolitaireRoomModal").style.display = "none";
    });
    document.getElementById("createPegSolitaireRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newPegSolitaireRoomName").value.trim() || "Peg Solitaire Room";
        document.getElementById("createPegSolitaireRoomModal").style.display = "none";
        connection.invoke("CreatePegSolitaireRoom", name);
    });
    document.getElementById("newPegSolitaireRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createPegSolitaireRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createPegSolitaireRoomCancelBtn").click();
    });

    // Chinese Checkers single player
    document.getElementById("chineseCheckersSpBtn").addEventListener("click", () => {
        sessionStorage.setItem("myName", me.name);
        const botCount = parseInt(document.getElementById("ccBotCountSelect").value, 10) || 5;
        connection.invoke("StartChineseCheckersSinglePlayer", botCount);
    });

    // Create Chinese Checkers room
    document.getElementById("createChineseCheckersRoomBtn").addEventListener("click", () => {
        document.getElementById("newChineseCheckersRoomName").value = "";
        document.getElementById("createChineseCheckersRoomModal").style.display = "flex";
        setTimeout(() => document.getElementById("newChineseCheckersRoomName").focus(), 50);
    });
    document.getElementById("createChineseCheckersRoomCancelBtn").addEventListener("click", () => {
        document.getElementById("createChineseCheckersRoomModal").style.display = "none";
    });
    document.getElementById("createChineseCheckersRoomConfirmBtn").addEventListener("click", () => {
        const name = document.getElementById("newChineseCheckersRoomName").value.trim() || "Chinese Checkers Room";
        document.getElementById("createChineseCheckersRoomModal").style.display = "none";
        connection.invoke("CreateChineseCheckersRoom", name);
    });
    document.getElementById("newChineseCheckersRoomName").addEventListener("keydown", e => {
        if (e.key === "Enter") document.getElementById("createChineseCheckersRoomConfirmBtn").click();
        if (e.key === "Escape") document.getElementById("createChineseCheckersRoomCancelBtn").click();
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

function joinSolitaireRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinSolitaireRoom", roomId).then(() => {
        sessionStorage.setItem("solitaireRoomId", roomId);
        window.location.href = "/solitaire-room";
    });
}

function joinPegSolitaireRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinPegSolitaireRoom", roomId).then(() => {
        sessionStorage.setItem("pegSolitaireRoomId", roomId);
        window.location.href = "/peg-solitaire-room";
    });
}

function joinChineseCheckersRoom(roomId) {
    sessionStorage.setItem("isSinglePlayer", "0");
    connection.invoke("JoinChineseCheckersRoom", roomId).then(() => {
        sessionStorage.setItem("chineseCheckersRoomId", roomId);
        window.location.href = "/chinese-checkers-room";
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
