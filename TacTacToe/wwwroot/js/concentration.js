const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("concentrationRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Concentration game room id");
}
const CARD_BACK_EMOJI = "";
let myName = sessionStorage.getItem("myName") || "";
let gameState = null;
let _gameOverEventFired = false;

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

/* ============================================================
   Confetti Engine
   ============================================================ */
const _confColors = [
    '#7c6aff','#9b7aff','#ff5c8a','#ff85a8',
    '#36d6c3','#ffcb47','#ff8a47','#47d4ff',
    '#b388ff','#ff80ab','#69f0ae','#ffd740'
];

function _spawnParticles(count, originX, originY, speedScale, canvas, particles) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (2 + Math.random() * 9) * speedScale;
        particles.push({
            x: originX, y: originY,
            vx: Math.cos(angle) * speed * (0.6 + Math.random()),
            vy: Math.sin(angle) * speed * -1.2 - Math.random() * 5 * speedScale,
            size: 4 + Math.random() * 6,
            color: _confColors[Math.floor(Math.random() * _confColors.length)],
            rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 14,
            shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
            opacity: 1, gravity: 0.11 + Math.random() * 0.09,
            drag: 0.98 + Math.random() * 0.015,
            wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06,
            fadeStart: 160
        });
    }
}

function _runConfettiCanvas(canvas, particles, maxFrames) {
    const ctx = canvas.getContext('2d');
    let w = canvas.width  = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;
        for (const p of particles) {
            p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5; p.y += p.vy;
            p.rotation += p.rotSpeed; p.wobble += p.wobbleSpeed;
            if (frame > p.fadeStart) p.opacity -= 0.016;
            if (p.opacity <= 0) continue;
            alive = true;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity); ctx.fillStyle = p.color;
            if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
            else if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            else ctx.fillRect(-p.size / 2, -1, p.size, 2.5);
            ctx.restore();
        }
        frame++;
        if (alive && frame < maxFrames) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}

// Full-screen celebration burst (game win)
function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const w = canvas.width = window.innerWidth;
    const h = canvas.height = window.innerHeight;
    const particles = [];
    // Centre burst
    _spawnParticles(220, w / 2 + (Math.random() - 0.5) * w * 0.3, h * 0.45, 1.1, canvas, particles);
    // Delayed side bursts for layered chaos
    setTimeout(() => _spawnParticles(100, w * 0.15, h * 0.35, 0.9, canvas, particles), 250);
    setTimeout(() => _spawnParticles(100, w * 0.85, h * 0.35, 0.9, canvas, particles), 400);
    setTimeout(() => _spawnParticles(80,  w * 0.5,  h * 0.2,  1.2, canvas, particles), 600);
    _runConfettiCanvas(canvas, particles, 360);
}

// Small localised burst from a screen position (card match)
function launchMiniConfetti(x, y) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9998;pointer-events:none;';
    document.body.appendChild(canvas);
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    _spawnParticles(45, x, y, 0.7, canvas, particles);
    particles.forEach(p => { p.fadeStart = 60; }); // fade faster for mini burst
    _runConfettiCanvas(canvas, particles, 180);
}

// Fire mini bursts from every matched card element
function burstFromMatchedCards(cardIndexes) {
    const board = document.getElementById('concentrationBoard');
    if (!board) return;
    const cards = board.querySelectorAll('.concentration-card');
    cardIndexes.forEach(idx => {
        const el = cards[idx];
        if (!el) return;
        const r = el.getBoundingClientRect();
        launchMiniConfetti(r.left + r.width / 2, r.top + r.height / 2);
    });
}

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

            if (newlyMatched.length > 0) {
                soundMatch();
                // Confetti burst from each matched card — fires for ALL players, not just you
                setTimeout(() => burstFromMatchedCards(newlyMatched.map(c => c.index)), 120);
            } else if (nowHidden.length > 0)    soundMiss();
            else if (newlyRevealed.length > 0) soundFlip();
        }

        if (state.isOver && (!prev || !prev.isOver)) {
            if (!state.winnerName)                { soundTie(); }
            else if (state.winnerName === myName) { soundWin(); launchConfetti(); }
            else                                  { soundLose(); }
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
    fetchAvatars(state.players.map(p => p.name));
    players.innerHTML = "";
    state.players.forEach((p, i) => {
        const item = document.createElement("div");
        item.className = "player-bar-item" + (i === state.currentPlayerIndex && !state.isOver ? " active" : "") + (p.name === myName ? " is-me" : "");
        item.innerHTML = avatarHtml(p.name, 'sm') + '<span class="room-player-name">' + esc(p.name) + '</span>'
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
        if (card.isMatched)  btn.classList.add("matched");
        if (card.isRevealed || card.isMatched) btn.classList.add("revealed");
        // Gold border on cards the current player flipped this turn (visible to everyone)
        if (card.isRevealed && !card.isMatched) btn.classList.add("just-flipped");
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
        if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event('gameOver')); }
    }
}

function backToLobby() {
    connection.invoke("LeaveConcentrationGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").addEventListener("click", backToLobby);
    document.getElementById("backToLobby").addEventListener("click", backToLobby);
});

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
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; playChatReceiveSound(); }
    });
}

init();
