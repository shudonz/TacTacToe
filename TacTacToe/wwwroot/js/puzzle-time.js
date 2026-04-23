const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("puzzleTimeRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Puzzle Time room id");
}

let myName = sessionStorage.getItem("myName") || "";
let state = null;
let prevState = null;
let selectedTileId = null;
let _ac = null;
let _gameOverEventFired = false;

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function audioCtx() {
    if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    return _ac;
}
function tone(freq, dur = 0.11, vol = 0.1, type = 'sine', delay = 0) {
    const ac = audioCtx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
    o.connect(g); g.connect(ac.destination);
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
}
function sndSelect() { tone(620, 0.08, 0.1); }
function sndMove() { tone(440, 0.06, 0.12); tone(780, 0.09, 0.08, 'sine', 0.05); }
function sndRotate() { tone(720, 0.06, 0.08); tone(520, 0.09, 0.08, 'triangle', 0.04); }
function sndDeny() { tone(220, 0.15, 0.09, 'triangle'); }
function sndWin() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 0.12, 'sine', i * 0.1)); }

function launchConfetti(count = 120) {
    const colors = ['#fbbf24', '#f472b6', '#36d6c3', '#7c6aff', '#12919E', '#ff8a47'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'pt-confetti';
            el.style.left = (Math.random() * 100) + '%';
            el.style.background = colors[i % colors.length];
            el.style.animationDuration = (1.4 + Math.random() * 1.6) + 's';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3400);
        }, i * 14);
    }
}

function tileById(id) {
    return state?.tiles?.find(t => t.id === id) || null;
}

function isMine(tile) {
    return !!tile && tile.lockedByName === myName;
}

function getGrid() {
    const rows = state?.settings?.grid?.rows || 5;
    const cols = state?.settings?.grid?.cols || 5;
    return { rows, cols };
}

function updateStatusText() {
    const status = document.getElementById("puzzleStatusText");
    if (!state) { status.textContent = "Loading puzzle…"; return; }
    if (state.isOver) {
        status.textContent = state.winnerName
            ? (state.winnerName === myName ? "You solved the puzzle! 🎉" : `${state.winnerName} solved the puzzle!`)
            : "Puzzle solved!";
        return;
    }

    const meLock = state.tiles.find(t => isMine(t));
    if (meLock) {
        status.textContent = `Locked ${meLock.face} · click a board slot to place it or rotate it.`;
        return;
    }

    status.textContent = "Select a tile to lock it, then place/rotate it.";
}

function renderPlayers() {
    const bar = document.getElementById("puzzlePlayers");
    bar.innerHTML = "";
    fetchAvatars(state.players.map(p => p.name));
    state.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "player-bar-item" + (p.name === myName ? " is-me" : "") + (!p.connected ? " player-disconnected" : "");
        el.innerHTML = avatarHtml(p.name, 'sm') +
            '<span class="room-player-name">' + esc(p.name) + '</span>' +
            '<span class="player-score">' + (p.connected ? 'Online' : 'Away') + '</span>';
        bar.appendChild(el);
    });
}

function renderPreview() {
    const grid = document.getElementById("puzzlePreviewGrid");
    const { cols } = getGrid();
    grid.style.gridTemplateColumns = `repeat(${cols}, minmax(24px, 1fr))`;
    grid.innerHTML = "";
    state.previewFaces.forEach(face => {
        const cell = document.createElement("div");
        cell.className = "puzzle-cell puzzle-preview-cell";
        cell.textContent = face;
        grid.appendChild(cell);
    });
}

function renderBoard() {
    const board = document.getElementById("puzzleBoardGrid");
    const { cols } = getGrid();
    board.style.gridTemplateColumns = `repeat(${cols}, minmax(24px, 1fr))`;
    board.innerHTML = "";

    const bySlot = new Map();
    state.tiles.forEach(t => bySlot.set(t.currentIndex, t));

    for (let idx = 0; idx < state.tiles.length; idx++) {
        const tile = bySlot.get(idx);
        const btn = document.createElement("button");
        btn.className = "puzzle-cell puzzle-tile";
        if (tile) {
            const mine = isMine(tile);
            const lockedOther = tile.isLocked && !mine;
            if (selectedTileId === tile.id) btn.classList.add("selected");
            if (lockedOther) btn.classList.add("locked-other");
            if (mine) btn.classList.add("locked-me");
            btn.style.transform = `rotate(${tile.rotation * 90}deg)`;
            btn.innerHTML = '<span class="puzzle-face">' + tile.face + '</span>' +
                (tile.lockedByName ? '<span class="puzzle-lock-badge">' + esc(tile.lockedByName) + '</span>' : '');

            btn.onclick = () => onTileClick(tile, idx);
        }
        board.appendChild(btn);
    }

    document.getElementById("rotateLeftBtn").disabled = !selectedTileId || state.isOver;
    document.getElementById("rotateRightBtn").disabled = !selectedTileId || state.isOver;
    document.getElementById("unlockTileBtn").disabled = !selectedTileId || state.isOver;
    document.getElementById("puzzleLockHint").textContent = selectedTileId
        ? "Tile locked by you. Click any board cell to move it."
        : "Select a tile to lock it, then place or rotate it.";
}

function syncSelectedTile() {
    const selected = selectedTileId ? tileById(selectedTileId) : null;
    if (!selected || !isMine(selected)) selectedTileId = null;
}

function onTileClick(tile, targetIndex) {
    if (!state || state.isOver) return;

    const selected = selectedTileId ? tileById(selectedTileId) : null;

    if (selected && isMine(selected)) {
        if (selected.id === tile.id) {
            connection.invoke("ReleasePuzzleTileLock", roomId, selected.id);
            selectedTileId = null;
            return;
        }
        connection.invoke("MovePuzzleTile", roomId, selected.id, targetIndex);
        return;
    }

    if (tile.isLocked && !isMine(tile)) {
        sndDeny();
        return;
    }

    selectedTileId = tile.id;
    connection.invoke("AcquirePuzzleTileLock", roomId, tile.id);
}

function sideEffects(oldState, next) {
    if (!oldState || !next) return;

    const prevById = new Map(oldState.tiles.map(t => [t.id, t]));
    let moved = false, rotated = false;
    next.tiles.forEach(t => {
        const p = prevById.get(t.id);
        if (!p) return;
        if (p.currentIndex !== t.currentIndex) moved = true;
        if (p.rotation !== t.rotation) rotated = true;
    });

    if (moved) sndMove();
    else if (rotated) sndRotate();

    const hadLock = oldState.tiles.some(t => isMine(t));
    const hasLock = next.tiles.some(t => isMine(t));
    if (!hadLock && hasLock) sndSelect();

    if (next.isOver && !oldState.isOver) {
        sndWin();
        launchConfetti();
    }
}

function render() {
    if (!state) return;

    syncSelectedTile();
    renderPlayers();
    renderPreview();
    renderBoard();
    updateStatusText();

    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You finished Puzzle Time!" : `${state.winnerName} finished the puzzle!`)
            : "Puzzle completed!";
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event("gameOver")); }
    }
}

function backToLobby() {
    connection.invoke("LeavePuzzleTimeGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

async function init() {
    if (!myName) {
        const me = await fetch("/api/me").then(r => r.json());
        myName = me.name;
    }

    connection.on("PuzzleTimeUpdated", s => {
        sideEffects(state, s);
        prevState = state;
        state = s;
        render();
    });

    connection.on("PuzzleTileLockRejected", () => {
        sndDeny();
        selectedTileId = null;
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("puzzleStatusText").textContent = name + " left the game.";
    });

    await connection.start();
    await connection.invoke("RejoinPuzzleTimeRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
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

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("rotateLeftBtn").addEventListener("click", () => {
        const tile = selectedTileId ? tileById(selectedTileId) : null;
        if (!tile || !isMine(tile)) return;
        connection.invoke("RotatePuzzleTile", roomId, tile.id, false);
    });
    document.getElementById("rotateRightBtn").addEventListener("click", () => {
        const tile = selectedTileId ? tileById(selectedTileId) : null;
        if (!tile || !isMine(tile)) return;
        connection.invoke("RotatePuzzleTile", roomId, tile.id, true);
    });
    document.getElementById("unlockTileBtn").addEventListener("click", () => {
        const tile = selectedTileId ? tileById(selectedTileId) : null;
        if (!tile || !isMine(tile)) return;
        connection.invoke("ReleasePuzzleTileLock", roomId, tile.id);
        selectedTileId = null;
    });
    document.getElementById("backBtn").addEventListener("click", backToLobby);
    document.getElementById("backToLobby").addEventListener("click", backToLobby);
});

init();
