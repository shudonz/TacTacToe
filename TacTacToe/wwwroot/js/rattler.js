/* ================================================================
   rattler.js  — Rattler (Snake) game client
   ================================================================ */

'use strict';

const connection = new signalR.HubConnectionBuilder()
    .withUrl('/gamehub')
    .withAutomaticReconnect()
    .build();

const roomId = sessionStorage.getItem('rattlerRoomId');
if (!roomId) { window.location.replace('/lobby'); throw new Error('Missing Rattler room id'); }

// ── State ────────────────────────────────────────────────────────
let myName = '';
let lastState = null;
let prevScores = [];
let pendingDir = null;
let isMobile = window.matchMedia('(pointer: coarse)').matches;
const GRID_CELL = 20; // fallback, will be computed from canvas size

// ── Audio ────────────────────────────────────────────────────────

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _ac = null;
function getAC() {
    if (!_ac) { try { _ac = new AudioCtx(); } catch(e){} }
    return _ac;
}

function playBeep(freq = 660, dur = 0.06, type = 'square', vol = 0.18) {
    try {
        const ac = getAC(); if (!ac) return;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.type = type; osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
        osc.start(ac.currentTime); osc.stop(ac.currentTime + dur);
    } catch(e){}
}

function playEatSound(val) {
    if (val >= 10)      { playBeep(880, 0.12, 'sawtooth', 0.22); setTimeout(() => playBeep(1320, 0.1, 'sawtooth', 0.18), 80); }
    else if (val >= 3)  { playBeep(660, 0.09, 'square', 0.18); }
    else                { playBeep(440, 0.055, 'square', 0.12); }
}

function playDeathSound() {
    playBeep(220, 0.18, 'sawtooth', 0.28);
    setTimeout(() => playBeep(110, 0.22, 'sawtooth', 0.24), 120);
}

function playWinSound() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => setTimeout(() => playBeep(n, 0.12, 'square', 0.2), i * 90));
}

function playCountdownBeep(n) {
    playBeep(n === 0 ? 1047 : 660, n === 0 ? 0.2 : 0.1, 'square', 0.18);
}

// ── Canvas ───────────────────────────────────────────────────────

const canvas = document.getElementById('rattlerCanvas');
const ctx = canvas.getContext('2d');

function cellSize() {
    return canvas.width / (lastState?.gridW || 24);
}

// ── Colours per player ───────────────────────────────────────────
const SNAKE_COLORS = [
    { head: '#00e5cc', body: '#0abfa8', eye: '#001a15' },   // teal (player 0)
    { head: '#ff8c42', body: '#e06b20', eye: '#200a00' },   // orange (player 1)
];
const FOOD_COLORS  = { 1: '#ff4d6d', 3: '#c0c0ff', 10: '#ffd700' };
const FOOD_EMOJIS  = { 1: '🍎', 3: '💎', 10: '⭐' };
const BG_COLOR     = '#0a1e2e';
const GRID_COLOR   = '#0e2538';

// ── Draw ─────────────────────────────────────────────────────────

function draw(state) {
    const cs = canvas.width / state.gridW;
    const W = state.gridW, H = state.gridH;

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid lines
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x++) {
        ctx.beginPath(); ctx.moveTo(x * cs, 0); ctx.lineTo(x * cs, H * cs); ctx.stroke();
    }
    for (let y = 0; y <= H; y++) {
        ctx.beginPath(); ctx.moveTo(0, y * cs); ctx.lineTo(W * cs, y * cs); ctx.stroke();
    }

    // Food
    state.foods.forEach(f => {
        const cx = f.x * cs + cs / 2;
        const cy = f.y * cs + cs / 2;
        const r = cs * 0.38;
        ctx.fillStyle = FOOD_COLORS[f.value] || '#ff4d6d';
        ctx.shadowColor = FOOD_COLORS[f.value] || '#ff4d6d';
        ctx.shadowBlur = f.value >= 10 ? 10 : f.value >= 3 ? 6 : 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Gold star shimmer
        if (f.value >= 10) {
            ctx.fillStyle = '#fff8';
            ctx.font = `${cs * 0.52}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', cx, cy);
        }
    });

    // Snakes
    state.players.forEach((p, pi) => {
        if (!p.bodyX || p.bodyX.length === 0) return;
        const col = SNAKE_COLORS[pi % SNAKE_COLORS.length];
        const alpha = p.dead ? 0.4 : 1;
        ctx.globalAlpha = alpha;

        // Body segments (draw from tail to head so head is on top)
        for (let i = p.bodyX.length - 1; i >= 0; i--) {
            const bx = p.bodyX[i] * cs;
            const by = p.bodyY[i] * cs;
            const isHead = i === 0;
            const pad = isHead ? 1 : 2;
            const r = (cs - pad * 2) / 2;
            ctx.fillStyle = isHead ? col.head : col.body;
            if (isHead) {
                ctx.shadowColor = col.head;
                ctx.shadowBlur = p.dead ? 0 : 8;
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.roundRect
                ? ctx.roundRect(bx + pad, by + pad, cs - pad * 2, cs - pad * 2, r * 0.55)
                : ctx.rect(bx + pad, by + pad, cs - pad * 2, cs - pad * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Eyes on head
        if (!p.dead && p.bodyX.length > 0) {
            const hx = p.bodyX[0] * cs + cs / 2;
            const hy = p.bodyY[0] * cs + cs / 2;
            const eyeR = cs * 0.1;
            const offset = cs * 0.2;
            ctx.fillStyle = col.eye;
            // Two eyes
            ctx.beginPath(); ctx.arc(hx - offset, hy - offset, eyeR, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(hx + offset, hy - offset, eyeR, 0, Math.PI * 2); ctx.fill();
        }

        ctx.globalAlpha = 1;
    });
}

// ── Score bar ────────────────────────────────────────────────────

function renderScorebar(state) {
    const bar = document.getElementById('rattlerScorebar');
    bar.innerHTML = '';
    state.players.forEach((p, i) => {
        const col = SNAKE_COLORS[i % SNAKE_COLORS.length];
        const isMe = p.name === myName;
        const chip = document.createElement('div');
        chip.className = 'rattler-score-chip' + (isMe ? ' is-me' : '') + (p.dead ? ' is-dead' : '');
        chip.innerHTML =
            `<div class="rattler-score-chip-color" style="background:${col.head}"></div>` +
            `<div class="rattler-score-chip-name">${esc(p.name)}${isMe ? ' <span style="font-size:0.7em;opacity:.7">(you)</span>' : ''}</div>` +
            `<div class="rattler-score-chip-pts">${p.score}</div>` +
            `<div class="${p.dead ? 'rattler-score-chip-dead' : 'rattler-score-chip-len'}">${p.dead ? '💀 Dead' : `🐍 ${p.length}`}</div>`;
        bar.appendChild(chip);
    });
}

// ── Status line ───────────────────────────────────────────────────

function renderStatus(state) {
    const el = document.getElementById('rattlerStatus');
    if (!state.isOver) {
        el.textContent = state.isSinglePlayer ? '🐍 vs Bot — eat food, outlast your opponent!' : '🐍 Multiplayer — best score wins!';
    }
}

// ── Game over overlay ─────────────────────────────────────────────

function showOverlay(state) {
    const overlay = document.getElementById('rattlerOverlay');
    const titleEl = document.getElementById('overlayTitle');
    const subEl   = document.getElementById('overlaySub');
    const scores  = document.getElementById('overlayScores');
    const playBtn = document.getElementById('overlayPlayAgainBtn');

    const myPlayer = state.players.find(p => p.name === myName);
    const iWon = state.winnerName === myName;

    titleEl.textContent = iWon ? '🏆 You Win!' : (state.winnerName ? `🐍 ${state.winnerName} Wins!` : 'Game Over!');
    subEl.textContent   = iWon ? 'Amazing slithering! 🎉' : (myPlayer?.dead ? "You died — better luck next time!" : "Time's up!");

    scores.innerHTML = '';
    const sorted = [...state.players].sort((a, b) => (b.score - a.score) || (a.finishRank ?? 99) - (b.finishRank ?? 99));
    sorted.forEach((p, rank) => {
        const row = document.createElement('div');
        const isWinner = p.name === state.winnerName;
        row.className = 'rattler-overlay-score-row' + (isWinner ? ' is-winner' : '');
        row.innerHTML =
            `<span>${rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉'} ${esc(p.name)}${p.name === myName ? ' (you)' : ''}</span>` +
            `<span>${p.score} pts</span>`;
        scores.appendChild(row);
    });

    if (state.isSinglePlayer) {
        playBtn.style.display = 'inline-block';
        playBtn.onclick = () => {
            overlay.classList.remove('visible');
            connection.invoke('StartRattlerSinglePlayer')
                .catch(e => console.error(e));
        };
    }

    overlay.classList.add('visible');
}

// ── Confetti ──────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#00e5cc','#ff8c42','#ffd700','#ff4d6d','#c0c0ff','#7bff83','#fff'];
function launchConfetti(count = 120) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'rattler-confetti';
            el.style.cssText = [
                `left:${Math.random() * 100}vw`,
                `background:${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]}`,
                `width:${6 + Math.random() * 8}px`,
                `height:${6 + Math.random() * 8}px`,
                `border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`,
                `animation-duration:${1.8 + Math.random() * 2.2}s`,
                `animation-delay:${Math.random() * 0.3}s`
            ].join(';');
            document.body.appendChild(el);
            el.addEventListener('animationend', () => el.remove());
        }, i * 15);
    }
}

// ── Score pop ─────────────────────────────────────────────────────

function scorePopAt(canvasX, canvasY, val, pi) {
    const wrap = document.getElementById('rattlerCanvasWrap');
    const ratio = wrap.clientWidth / canvas.width;
    const pop = document.createElement('div');
    pop.className = 'rattler-score-pop';
    pop.textContent = val >= 10 ? `+${val} ⭐` : val >= 3 ? `+${val} 💎` : `+${val}`;
    pop.style.left = (canvasX * ratio) + 'px';
    pop.style.top  = (canvasY * ratio - 10) + 'px';
    pop.style.color = val >= 10 ? '#ffd700' : val >= 3 ? '#c0c0ff' : '#ff6b6b';
    wrap.appendChild(pop);
    pop.addEventListener('animationend', () => pop.remove());
}

// ── Hint system ───────────────────────────────────────────────────

const HINTS = [
    '💡 Avoid your own tail — it follows you everywhere!',
    '💡 Gold stars (⭐) are worth 10 points. Prioritise them!',
    '💡 Cut off your opponent by curling around the food first.',
    '💡 Try to stay near the centre — more escape routes.',
    '💡 Silver diamonds (💎) are 3 points — great for a quick boost.',
    '💡 If you die first but have more points, you still win!',
    '💡 Watch your opponent\'s head — anticipate their next move.',
];
let hintIdx = 0;
let hintInterval = null;
function startHints() {
    const el = document.getElementById('rattlerHint');
    el.style.display = '';
    el.textContent = HINTS[hintIdx++ % HINTS.length];
    hintInterval = setInterval(() => {
        el.textContent = HINTS[hintIdx++ % HINTS.length];
    }, 7000);
}
function stopHints() {
    if (hintInterval) { clearInterval(hintInterval); hintInterval = null; }
    document.getElementById('rattlerHint').style.display = 'none';
}

// ── Instructions toggle ───────────────────────────────────────────

function toggleInstructions() {
    const body  = document.getElementById('instrBody');
    const arrow = document.getElementById('instrArrow');
    const open  = body.classList.toggle('open');
    arrow.textContent = open ? '▲' : '▼';
}

// ── Keyboard input ────────────────────────────────────────────────

const KEY_DIR = {
    ArrowUp:    0, KeyW: 0, w: 0,
    ArrowDown:  1, KeyS: 1, s: 1,
    ArrowLeft:  2, KeyA: 2, a: 2,
    ArrowRight: 3, KeyD: 3, d: 3,
};

document.addEventListener('keydown', e => {
    const dir = KEY_DIR[e.code] ?? KEY_DIR[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    sendDir(dir);
});

// ── D-pad ─────────────────────────────────────────────────────────

document.querySelectorAll('.dpad-btn[data-dir]').forEach(btn => {
    btn.addEventListener('touchstart', e => { e.preventDefault(); sendDir(parseInt(btn.dataset.dir, 10)); }, { passive: false });
    btn.addEventListener('click', () => sendDir(parseInt(btn.dataset.dir, 10)));
});

// ── Touch swipe ───────────────────────────────────────────────────

let touchStart = null;
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: false });
canvas.addEventListener('touchend', e => {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dx) > Math.abs(dy)) sendDir(dx > 0 ? 3 : 2);
    else                             sendDir(dy > 0 ? 1 : 0);
}, { passive: false });

function sendDir(dir) {
    if (!lastState || lastState.isOver) return;
    const me = lastState.players[lastState.myIndex];
    if (!me || me.dead) return;
    connection.invoke('RattlerChangeDir', roomId, dir).catch(e => console.error(e));
}

// ── Countdown before game start ───────────────────────────────────

async function runCountdown() {
    const overlay = document.getElementById('rattlerCountdownOverlay');
    const num = document.getElementById('rattlerCountdownNum');
    overlay.style.display = 'flex';
    for (const n of [3, 2, 1, 'GO!']) {
        num.textContent = n;
        num.style.animation = 'none';
        // Force reflow
        void num.offsetHeight;
        num.style.animation = 'countdown-pulse 0.9s ease-out forwards';
        playCountdownBeep(n === 'GO!' ? 0 : Number(n));
        await new Promise(r => setTimeout(r, 900));
    }
    overlay.style.display = 'none';
}

// ── Main update handler ───────────────────────────────────────────

let firstTickReceived = false;
let gameEndHandled = false;

connection.on('RattlerUpdated', async state => {
    if (!firstTickReceived) {
        firstTickReceived = true;
        showDpad();
        startHints();
        await runCountdown();
    }

    // Detect food eat events for score pops / sounds
    if (lastState && lastState.players && state.players) {
        state.players.forEach((p, pi) => {
            const prev = lastState.players[pi];
            if (prev && p.score > prev.score) {
                const gain = p.score - prev.score;
                playEatSound(gain);
                const cs = canvas.width / state.gridW;
                if (p.bodyX.length > 0)
                    scorePopAt(p.bodyX[0] * cs + cs / 2, p.bodyY[0] * cs + cs / 2, gain, pi);
            }
            if (prev && !prev.dead && p.dead) playDeathSound();
        });
    }

    lastState = state;
    draw(state);
    renderScorebar(state);
    renderStatus(state);

    if (state.isOver && !gameEndHandled) {
        gameEndHandled = true;
        stopHints();
        const iWon = state.winnerName === myName;
        if (iWon) {
            playWinSound();
            setTimeout(() => launchConfetti(180), 300);
        }
        setTimeout(() => showOverlay(state), iWon ? 800 : 400);
    }
});

connection.on('PlayerLeft', name => {
    showHint(`${name} disconnected.`);
});

// ── Helpers ───────────────────────────────────────────────────────

function showHint(msg) {
    const el = document.getElementById('rattlerHint');
    el.style.display = '';
    el.textContent = msg;
}

function showDpad() {
    if (isMobile || window.ontouchstart !== undefined) {
        document.getElementById('rattlerDpad').style.display = 'grid';
    }
}

function esc(s) {
    const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}

// ── Back button ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('backBtn')?.addEventListener('click', () => {
        connection.invoke('LeaveRattlerGame', roomId)
            .finally(() => { window.location.href = '/lobby'; });
    });
});

// ── Canvas resize ─────────────────────────────────────────────────

function resizeCanvas() {
    const wrap = document.getElementById('rattlerCanvasWrap');
    const w = wrap.clientWidth;
    // Keep square
    canvas.style.height = w + 'px';
    if (lastState) draw(lastState);
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 0);

// ── Initialise ────────────────────────────────────────────────────

async function init() {
    const me = await fetch('/api/me').then(r => r.json());
    myName = me.name;

    await connection.start();
    await connection.invoke('RejoinRattlerRoom', roomId);
}

init().catch(e => console.error(e));
