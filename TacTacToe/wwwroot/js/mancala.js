const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("mancalaRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing Mancala room id"); }

let myName = sessionStorage.getItem("myName") || "";
let gameState = null;
let _gameOverEventFired = false;
let _hintPit = -1;

// Animation state
let _pendingPickedPit = -1; // pit index the local player just clicked
let _animating = false;     // true while stones are in flight

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

/* ============================================================
   Confetti Engine
   ============================================================ */
const _confColors = ['#7c6aff','#9b7aff','#ff5c8a','#ff85a8','#36d6c3','#ffcb47','#ff8a47','#47d4ff','#b388ff','#ff80ab','#69f0ae','#ffd740'];
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
            opacity: 1, gravity: 0.11 + Math.random() * 0.09, drag: 0.98 + Math.random() * 0.015,
            wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06, fadeStart: 160
        });
    }
}
function _runConfettiCanvas(canvas, particles, maxFrames) {
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight, frame = 0;
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
        frame++; if (alive && frame < maxFrames) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}
function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight, particles = [];
    _spawnParticles(220, w / 2 + (Math.random() - 0.5) * w * 0.3, h * 0.45, 1.1, canvas, particles);
    setTimeout(() => _spawnParticles(100, w * 0.15, h * 0.35, 0.9, canvas, particles), 250);
    setTimeout(() => _spawnParticles(100, w * 0.85, h * 0.35, 0.9, canvas, particles), 400);
    setTimeout(() => _spawnParticles(80, w * 0.5, h * 0.2, 1.2, canvas, particles), 600);
    _runConfettiCanvas(canvas, particles, 360);
}

/* ============================================================
   Sound Engine
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
function soundPick() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(320, 'sine', t, 0.08, 0.22);
    _tone(480, 'sine', t + 0.05, 0.10, 0.18);
}
function soundDrop() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(200, 'triangle', t, 0.06, 0.15);
    _tone(160, 'triangle', t + 0.04, 0.07, 0.12);
}
function soundExtraTurn() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(784, 'sine', t, 0.12, 0.28);
    _tone(1047, 'sine', t + 0.1, 0.14, 0.26);
}
function soundWin() {
    _resumeAudio(); const t = _ac.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => _tone(f, 'sine', t + i * 0.11, 0.32, 0.32));
}
function soundLose() {
    _resumeAudio(); const t = _ac.currentTime;
    [440, 350, 280, 220].forEach((f, i) => _tone(f, 'triangle', t + i * 0.15, 0.36, 0.26));
}
function soundTie() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(528, 'sine', t, 0.28, 0.22); _tone(528, 'sine', t + 0.35, 0.25, 0.14);
}
function soundStoneLand() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(180 + Math.random() * 60, 'triangle', t, 0.06, 0.10);
}
function playChatSendSound() { _resumeAudio(); _tone(880, 'sine', _ac.currentTime, 0.08, 0.14); _tone(1100, 'sine', _ac.currentTime + 0.06, 0.07, 0.10); }
function playChatReceiveSound() { _resumeAudio(); const t = _ac.currentTime; _tone(740, 'sine', t, 0.10, 0.18); _tone(988, 'sine', t + 0.09, 0.10, 0.18); }

/* ============================================================
   Stone Sow Animation
   ============================================================ */
const P1_STORE = 6, P2_STORE = 13;

// Mirror of server MancalaEngine.MakeMove sow sequence
function computeSowSequence(board, pitIndex, playerIndex) {
    const skipStore = playerIndex === 0 ? P2_STORE : P1_STORE;
    let stones = board[pitIndex];
    const seq = [];
    let cur = pitIndex;
    while (stones > 0) {
        cur = (cur + 1) % 14;
        if (cur === skipStore) cur = (cur + 1) % 14;
        seq.push(cur);
        stones--;
    }
    return seq;
}

function getPitRect(pitIndex) {
    if (pitIndex === P1_STORE) return document.getElementById('storeP1').getBoundingClientRect();
    if (pitIndex === P2_STORE) return document.getElementById('storeP2').getBoundingClientRect();
    const el = document.querySelector(`[data-pit-index="${pitIndex}"]`);
    return el ? el.getBoundingClientRect() : null;
}

// Animate a single stone from one pit center to another via an arced path.
// Returns a Promise that resolves when the stone reaches its destination.
function flyStone(fromRect, toRect, isP2, delayMs, destPitIndex) {
    const DURATION = 260;
    const r = 5.5; // half stone size for centering offset
    const sx = fromRect.left + fromRect.width / 2;
    const sy = fromRect.top + fromRect.height / 2;
    const tx = toRect.left + toRect.width / 2;
    const ty = toRect.top + toRect.height / 2;
    const dist = Math.hypot(tx - sx, ty - sy);
    // Arc lifts opposite to the direction of travel (always upward for horizontal moves,
    // sideways for vertical, giving a natural stone-toss feel)
    const arcH = -(dist * 0.28 + 18);

    return new Promise(resolve => {
        const el = document.createElement('div');
        el.className = 'mancala-flying-stone' + (isP2 ? ' stone-p2' : '');
        el.style.left = (sx - r) + 'px';
        el.style.top  = (sy - r) + 'px';
        document.body.appendChild(el);

        let startTime = null;
        function step(now) {
            if (startTime === null) {
                startTime = now + delayMs;
            }
            if (now < startTime) { requestAnimationFrame(step); return; }

            const t = Math.min((now - startTime) / DURATION, 1);
            // Ease out cubic for a nice decelerating landing
            const e = 1 - Math.pow(1 - t, 3);
            const x = sx + (tx - sx) * e - r;
            const y = sy + (ty - sy) * e + Math.sin(t * Math.PI) * arcH - r;
            const scale = 1 + Math.sin(t * Math.PI) * 0.45; // puff up mid-flight
            el.style.left = x + 'px';
            el.style.top  = y + 'px';
            el.style.transform = `scale(${scale})`;

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                el.remove();
                pitRipple(destPitIndex);
                soundStoneLand();
                resolve();
            }
        }
        requestAnimationFrame(step);
    });
}

// Fly all stones in the sow sequence, staggered 70ms apart.
async function animateSow(fromPit, seq, playerIndex) {
    _animating = true;
    const fromRect = getPitRect(fromPit);
    if (!fromRect || seq.length === 0) { _animating = false; return; }

    const isP2 = playerIndex === 1;
    const STAGGER = 70; // ms between each stone launch

    // Pre-capture rects before any DOM changes
    const rects = seq.map(pit => getPitRect(pit));

    const promises = seq.map((destPit, i) => {
        const toRect = rects[i];
        if (!toRect) return Promise.resolve();
        return flyStone(fromRect, toRect, isP2, i * STAGGER, destPit);
    });

    await Promise.all(promises);
    _animating = false;
}

function pitRipple(pitIndex) {
    let el = null;
    if (pitIndex === P1_STORE) el = document.getElementById('storeP1');
    else if (pitIndex === P2_STORE) el = document.getElementById('storeP2');
    else el = document.querySelector(`[data-pit-index="${pitIndex}"]`);
    if (!el) return;
    el.classList.remove('stone-landing');
    void el.offsetWidth; // force reflow to restart animation
    el.classList.add('stone-landing');
    setTimeout(() => el.classList.remove('stone-landing'), 400);
}

// When the bot moves, infer which pit was the source by looking at the board diff.
function inferBotSourcePit(prevBoard, newBoard, playerIndex) {
    const start = playerIndex === 0 ? 0 : 7;
    const end   = playerIndex === 0 ? 6 : 13;
    // Primary: pit that went from > 0 to exactly 0 (was emptied)
    for (let i = start; i < end; i++) {
        if (prevBoard[i] > 0 && newBoard[i] === 0) return i;
    }
    // Fallback: pit with the largest decrease (large pit that wrapped back)
    let bestPit = -1, bestDiff = 0;
    for (let i = start; i < end; i++) {
        const diff = prevBoard[i] - newBoard[i];
        if (diff > bestDiff) { bestDiff = diff; bestPit = i; }
    }
    return bestPit;
}

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    if (!myName) {
        const res = await fetch("/api/me");
        const me = await res.json();
        myName = me.name;
    }

    connection.on("MancalaUpdated", async state => {
        const prev = gameState;
        gameState = state;

        // --- Determine source pit for animation ---
        let sourcePit = _pendingPickedPit;
        const animPlayerIndex = prev ? prev.currentPlayerIndex : -1;
        _pendingPickedPit = -1;

        // Bot move: infer source pit from board diff
        if (sourcePit < 0 && prev && animPlayerIndex >= 0) {
            sourcePit = inferBotSourcePit(prev.board, state.board, animPlayerIndex);
        }

        // --- Run stone animation (skip if already mid-flight to avoid pile-up) ---
        if (sourcePit >= 0 && prev && animPlayerIndex >= 0 && !_animating) {
            const seq = computeSowSequence(prev.board, sourcePit, animPlayerIndex);
            if (seq.length > 0) {
                await animateSow(sourcePit, seq, animPlayerIndex);
            }
        }

        // --- Sound effects (fire after animation so they match the visual) ---
        if (prev && !state.isOver) {
            const myIdx = state.players.findIndex(p => p.name === myName);
            const wasMyTurn = prev.currentPlayerIndex === myIdx;
            if (wasMyTurn && state.lastPitIndex >= 0) {
                const myStore = myIdx === 0 ? P1_STORE : P2_STORE;
                if (state.lastPitIndex === myStore) soundExtraTurn();
                else soundDrop();
            } else if (!wasMyTurn) {
                soundDrop();
            }
        }

        if (state.isOver && (!prev || !prev.isOver)) {
            if (!state.winnerName) { soundTie(); }
            else if (state.winnerName === myName) { soundWin(); launchConfetti(); }
            else { soundLose(); }
        }

        renderState(gameState);
    });

    connection.on("MancalaHint", hint => {
        _hintPit = hint.hintAvailable ? hint.pitIndex : -1;
        if (gameState) renderState(gameState);
        if (hint.hintAvailable) {
            document.getElementById("statusText").textContent = hint.description;
        }
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("statusText").textContent = name + " left the game.";
    });

    await connection.start();
    await connection.invoke("RejoinMancalaRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);

    document.getElementById("hintBtn").addEventListener("click", () => {
        _resumeAudio();
        connection.invoke("RequestMancalaHint", roomId);
    });
}

function renderState(state) {
    const myIdx = state.players.findIndex(p => p.name === myName);
    const myTurn = state.currentPlayerIndex === myIdx && !state.isOver;
    const p1 = state.players[0] || { name: "Player 1", isBot: false };
    const p2 = state.players[1] || { name: "Player 2", isBot: false };

    // Player chips
    const playerBar = document.getElementById("mancalaPlayers");
    playerBar.innerHTML = "";
    [p1, p2].forEach((p, i) => {
        const chip = document.createElement("div");
        chip.className = "mancala-player-chip" + (i === state.currentPlayerIndex && !state.isOver ? " active" : "") + (p.name === myName ? " is-me" : "");
        const storeVal = i === 0 ? state.board[6] : state.board[13];
        chip.innerHTML = avatarHtml(p.name, 'xs') + '<span class="mancala-player-chip-name">' + esc(p.name) + (p.isBot ? " 🤖" : "") + '</span>' + '<span class="mancala-player-chip-score">' + storeVal + '</span>';
        playerBar.appendChild(chip);
    });

    // Stores
    document.getElementById("storeP1Count").textContent = state.board[6];
    document.getElementById("storeP2Count").textContent = state.board[13];
    document.getElementById("storeP1Label").textContent = p1.name;
    document.getElementById("storeP2Label").textContent = p2.name;

    document.getElementById("storeP1").classList.toggle("active-store", state.currentPlayerIndex === 0 && !state.isOver);
    document.getElementById("storeP2").classList.toggle("active-store", state.currentPlayerIndex === 1 && !state.isOver);

    // P2 pits — displayed reversed (12 down to 7) so they face P1
    const pitsP2 = document.getElementById("pitsP2");
    pitsP2.innerHTML = "";
    for (let i = 12; i >= 7; i--) {
        pitsP2.appendChild(makePitEl(state, i, 1, myTurn, myIdx));
    }

    // P1 pits
    const pitsP1 = document.getElementById("pitsP1");
    pitsP1.innerHTML = "";
    for (let i = 0; i <= 5; i++) {
        pitsP1.appendChild(makePitEl(state, i, 0, myTurn, myIdx));
    }

    // Status text
    if (!state.isOver) {
        const extraMsg = state.extraTurn ? " (extra turn!)" : "";
        if (myTurn) {
            document.getElementById("statusText").textContent = "Your turn — pick a pit" + extraMsg;
        } else {
            document.getElementById("statusText").textContent = (state.players[state.currentPlayerIndex]?.name || "Opponent") + "'s turn" + extraMsg;
        }
        _hintPit = -1;
    } else {
        document.getElementById("statusText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You win! 🎉" : state.winnerName + " wins!")
            : "It's a tie!";
    }

    if (state.isOver) {
        const p1Score = state.board[6];
        const p2Score = state.board[13];
        document.getElementById("resultText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You win! 🎉" : state.winnerName + " wins!")
            : "It's a tie!";
        document.getElementById("resultScores").innerHTML =
            '<strong>' + esc(p1.name) + '</strong>: ' + p1Score + ' stones &nbsp;|&nbsp; <strong>' + esc(p2.name) + '</strong>: ' + p2Score + ' stones';
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event('gameOver')); }
    }
}

function makePitEl(state, pitIndex, pitOwner, myTurn, myIdx) {
    const count = state.board[pitIndex];
    const isClickable = myTurn && myIdx === pitOwner && count > 0 && !state.isOver;
    const isLast = state.lastPitIndex === pitIndex;
    const isHint = _hintPit === pitIndex;

    const btn = document.createElement("button");
    btn.className = "mancala-pit" + (isLast ? " last-pit" : "") + (isHint ? " hint-pit" : "");
    btn.disabled = !isClickable;
    btn.dataset.pitIndex = pitIndex; // used by getPitRect()

    // Label
    const lbl = document.createElement("span");
    lbl.className = "mancala-pit-label";
    lbl.textContent = pitOwner === 0 ? (pitIndex + 1) : (13 - pitIndex);
    btn.appendChild(lbl);

    // Stone count
    const countEl = document.createElement("span");
    countEl.className = "mancala-pit-count";
    countEl.textContent = count;
    btn.appendChild(countEl);

    // Visual stones (up to 12)
    if (count > 0 && count <= 16) {
        const stonesEl = document.createElement("div");
        stonesEl.className = "mancala-pit-stones";
        const show = Math.min(count, 12);
        for (let s = 0; s < show; s++) {
            const stone = document.createElement("span");
            stone.className = "mancala-stone" + (pitOwner === 1 ? " stone-p2" : "");
            stonesEl.appendChild(stone);
        }
        btn.appendChild(stonesEl);
    }

    if (isClickable) {
        btn.onclick = () => {
            // Block if an animation is already running or a move is already in-flight
            if (_animating || _pendingPickedPit >= 0) return;
            soundPick();
            _hintPit = -1;
            _pendingPickedPit = pitIndex;
            connection.invoke("MancalaPickPit", roomId, pitIndex);
        };
    }
    return btn;
}

function backToLobby() {
    connection.invoke("LeaveMancalaRoom", roomId).finally(() => { window.location.href = "/lobby"; });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").addEventListener("click", backToLobby);
    document.getElementById("backBtn2").addEventListener("click", backToLobby);
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
