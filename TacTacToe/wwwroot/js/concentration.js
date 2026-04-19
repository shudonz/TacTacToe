const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("concentrationRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
const CARD_BACK_EMOJI = "";
let myName = sessionStorage.getItem("myName") || "";
let gameState = null;

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

/* ============================================================
   Sound Engine (Web Audio API — no external files required)
   ============================================================ */
const _ac = new (window.AudioContext || window.webkitAudioContext)();
function _resumeAudio() { if (_ac.state === 'suspended') _ac.resume(); }
function _tone(freq, type, start, dur, vol) {
    const osc = _ac.createOscillator(), gain = _ac.createGain();
    osc.connect(gain); gain.connect(_ac.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start); osc.stop(start + dur + 0.05);
}

// Soft card flip — quick descending sine sweep
function soundFlip() {
    _resumeAudio();
    const t = _ac.currentTime;
    const osc = _ac.createOscillator(), gain = _ac.createGain();
    osc.connect(gain); gain.connect(_ac.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(280, t + 0.12);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.start(t); osc.stop(t + 0.18);
}

// Matched pair — bright two-note sparkle chime
function soundMatch() {
    _resumeAudio();
    const t = _ac.currentTime;
    _tone(880,  'sine', t,        0.22, 0.30);
    _tone(1320, 'sine', t + 0.10, 0.28, 0.28);
    _tone(1760, 'sine', t + 0.20, 0.30, 0.22);
}

// No match — soft low thud
function soundMiss() {
    _resumeAudio();
    const t = _ac.currentTime;
    _tone(220, 'triangle', t,        0.18, 0.22);
    _tone(180, 'triangle', t + 0.10, 0.22, 0.16);
}

// Win — ascending sparkle fanfare
function soundWin() {
    _resumeAudio();
    const t = _ac.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => _tone(f, 'sine', t + i * 0.11, 0.32, 0.32));
}

// Lose — descending droop
function soundLose() {
    _resumeAudio();
    const t = _ac.currentTime;
    [440, 350, 280, 220].forEach((f, i) => _tone(f, 'triangle', t + i * 0.15, 0.36, 0.26));
}

// Tie — neutral double ping
function soundTie() {
    _resumeAudio();
    const t = _ac.currentTime;
    _tone(528, 'sine', t,       0.28, 0.22);
    _tone(528, 'sine', t + 0.35, 0.25, 0.14);
}

// Chat sounds (shared pattern)
function playChatSendSound() {
    _resumeAudio();
    _tone(880,  'sine', _ac.currentTime,        0.08, 0.14);
    _tone(1100, 'sine', _ac.currentTime + 0.06, 0.07, 0.10);
}
function playChatReceiveSound() {
    _resumeAudio();
    const t = _ac.currentTime;
    _tone(740, 'sine', t,        0.10, 0.18);
    _tone(988, 'sine', t + 0.09, 0.10, 0.18);
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    if (!myName) {
        const res = await fetch("/api/me");
        const me = await res.json();
        myName = me.name;
    }

    connection.on("ConcentrationUpdated", state => {
        const prev = gameState;
        gameState = state;

        if (prev && !state.isOver) {
            const newlyRevealed = state.cards.filter(c =>
                c.isRevealed && !c.isMatched &&
                !prev.cards[c.index]?.isRevealed
            );
            const newlyMatched = state.cards.filter(c =>
                c.isMatched && !prev.cards[c.index]?.isMatched
            );
            const wasRevealed = prev.cards.filter(c => c.isRevealed && !c.isMatched);
            const nowHidden   = wasRevealed.filter(c => !state.cards[c.index]?.isRevealed && !state.cards[c.index]?.isMatched);

            if (newlyMatched.length > 0)      soundMatch();
            else if (nowHidden.length > 0)    soundMiss();
            else if (newlyRevealed.length > 0) soundFlip();
        }

        if (state.isOver && (!prev || !prev.isOver)) {
            if (!state.winnerName)                         soundTie();
            else if (state.winnerName === myName)          soundWin();
            else                                           soundLose();
        }

        renderState(state);
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("statusText").textContent = name + " left the game.";
    });

    await connection.start();
    await connection.invoke("RejoinConcentrationRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

function renderState(state) {
    const players = document.getElementById("concentrationPlayers");
    players.innerHTML = "";
    state.players.forEach((p, i) => {
        const item = document.createElement("div");
        item.className = "player-bar-item" + (i === state.currentPlayerIndex && !state.isOver ? " active" : "") + (p.name === myName ? " is-me" : "");
        item.innerHTML = '<span class="room-player-name">' + esc(p.name) + '</span>'
            + '<span class="player-score">' + p.score + "</span>";
        players.appendChild(item);
    });

    const myTurn = state.players[state.currentPlayerIndex]?.name === myName;
    document.getElementById("statusText").textContent = state.isOver
        ? (state.winnerName ? (state.winnerName === myName ? "You win! 🎉" : state.winnerName + " wins!") : "It's a tie!")
        : (myTurn ? "Your turn - flip two cards" : (state.players[state.currentPlayerIndex]?.name || "Player") + "'s turn");

    const board = document.getElementById("concentrationBoard");
    board.innerHTML = "";
    state.cards.forEach(card => {
        const btn = document.createElement("button");
        btn.className = "concentration-card";
        if (card.isMatched) btn.classList.add("matched");
        if (card.isRevealed || card.isMatched) btn.classList.add("revealed");
        btn.disabled = state.isOver || !myTurn || card.isMatched || card.isRevealed || state.turnLocked;
        btn.innerHTML = (card.isRevealed || card.isMatched)
            ? '<span class="concentration-card-back">' + (card.emoji || "") + '</span>'
            : '<span class="concentration-card-front">' + CARD_BACK_EMOJI + '</span>';
        btn.onclick = () => connection.invoke("ConcentrationFlipCard", roomId, card.index);
        board.appendChild(btn);
    });

    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You found the most matches!" : state.winnerName + " wins!")
            : "It's a tie!";
        document.getElementById("resultOverlay").style.display = "flex";
    }
}

function backToLobby() {
    connection.invoke("LeaveConcentrationGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

document.getElementById("backBtn").addEventListener("click", backToLobby);
document.getElementById("backToLobby").addEventListener("click", backToLobby);

function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close = document.getElementById("chatClose"), input = document.getElementById("chatInput"),
          send = document.getElementById("chatSend"), msgs = document.getElementById("chatMessages"),
          badge = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread = 0; badge.style.display = "none"; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = "none"; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke("SendChat", groupId, m); input.value = ""; playChatSendSound(); }
    send.onclick = doSend;
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    conn.on("ChatMessage", (name, message) => {
        const el = document.createElement("div"); el.className = "chat-msg";
        el.innerHTML = '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; playChatReceiveSound(); }
    });
}

init();
