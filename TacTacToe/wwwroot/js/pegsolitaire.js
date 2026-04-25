const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
let roomId = sessionStorage.getItem('pegSolitaireRoomId');
const isSinglePlayer = sessionStorage.getItem('isSinglePlayer') === '1';
if (!roomId) {
    window.location.replace('/lobby');
    throw new Error('Missing Peg Solitaire room id');
}

// ── Board geometry ─────────────────────────────────
const TRI_ROWS = [[0], [1, 2], [3, 4, 5], [6, 7, 8, 9], [10, 11, 12, 13, 14]];
const MOVE_TRIPLES = (() => {
    const dirs = [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, 0], [1, 1]];
    const toIndex = (r, c) => (r * (r + 1) / 2) + c;
    const valid = (r, c) => r >= 0 && r < 5 && c >= 0 && c <= r;
    const out = [];
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c <= r; c++) {
            const from = toIndex(r, c);
            for (const [dr, dc] of dirs) {
                const r1 = r + dr, c1 = c + dc;
                const r2 = r + dr * 2, c2 = c + dc * 2;
                if (!valid(r1, c1) || !valid(r2, c2)) continue;
                out.push({ from, over: toIndex(r1, c1), to: toIndex(r2, c2) });
            }
        }
    }
    return out;
})();

// ── State ──────────────────────────────────────────
let myName = '';
let roomState = null;
let myPlayer = null;
let selectedFrom = -1;
let _gameOverEventFired = false;
let _boardEntranceAnimated = false;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Audio (Web Audio API, no external files) ───────
let _audioCtx = null;
function _ac() {
    if (!_audioCtx) {
        try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    return _audioCtx;
}

function _tone(freq, dur, type = 'sine', vol = 0.26, delay = 0) {
    try {
        const ctx = _ac(); if (!ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        g.gain.setValueAtTime(0, ctx.currentTime + delay);
        g.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + dur);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur + 0.05);
    } catch (e) {}
}

function playSound(type) {
    switch (type) {
        case 'select':
            _tone(660, 0.12, 'sine', 0.22); break;
        case 'jump':
            _tone(320, 0.07, 'triangle', 0.28);
            _tone(900, 0.09, 'sine', 0.22, 0.06);
            _tone(220, 0.18, 'triangle', 0.32, 0.13);
            break;
        case 'setup':
            _tone(520, 0.10, 'sine', 0.30);
            _tone(360, 0.16, 'triangle', 0.22, 0.07);
            break;
        case 'invalid':
            _tone(180, 0.14, 'sawtooth', 0.12); break;
        case 'win-genius':
            [523, 659, 784, 1047, 1319].forEach((f, i) => _tone(f, 0.32, 'sine', 0.38, i * 0.13));
            _tone(1047, 0.6, 'sine', 0.3, 0.68);
            break;
        case 'win-smart':
            [523, 659, 784, 1047].forEach((f, i) => _tone(f, 0.26, 'sine', 0.34, i * 0.12)); break;
        case 'win-avg':
            [523, 659, 784].forEach((f, i) => _tone(f, 0.22, 'sine', 0.30, i * 0.12)); break;
        case 'game-over':
            [440, 330, 260, 196].forEach((f, i) => _tone(f, 0.22, 'triangle', 0.28, i * 0.14)); break;
    }
}

// ── Peg fly-off animation ──────────────────────────
function animatePegFlyOff(holeIndex, colorIdx) {
    const holeEl = document.querySelector(`[data-hole-idx="${holeIndex}"]`);
    if (!holeEl) return;
    const rect = holeEl.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = `peg-fly peg-c${colorIdx}`;
    // Random upward trajectory
    const spread = (Math.random() - 0.5) * 140;
    const angle = -90 + spread;
    const dist = 220 + Math.random() * 280;
    const fx = Math.cos(angle * Math.PI / 180) * dist;
    const fy = Math.sin(angle * Math.PI / 180) * dist;
    const fr = (Math.random() - 0.5) * 900;
    el.style.cssText = [
        'position:fixed',
        'width:40px', 'height:50px',
        `left:${rect.left + rect.width / 2 - 20}px`,
        `top:${rect.top - 4}px`,
        `--fx:${fx}px`, `--fy:${fy}px`, `--fr:${fr}deg`,
        'z-index:9999'
    ].join(';');
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Setup-phase peg pop-out (shrink in place) ──────
function animateSetupPop(holeIndex) {
    const holeEl = document.querySelector(`[data-hole-idx="${holeIndex}"]`);
    if (!holeEl) return;
    const peg = holeEl.querySelector('.pegsol-peg');
    if (!peg) return;
    peg.style.transition = 'transform .18s ease, opacity .18s ease';
    peg.style.transform = 'scale(0) translateY(-12px)';
    peg.style.opacity = '0';
}

// ── Confetti system ────────────────────────────────
const PEG_COLORS = ['#e05048','#f5a030','#f0cc20','#22c478','#12bce4','#4a90f0','#9668f4','#f44ca0','#f44060','#90d420'];

function launchConfetti(rating) {
    const counts = { 'Genius': 420, 'Smart': 180, 'Average': 70 };
    const count = counts[rating] || 0;
    if (!count) return;
    const canvas = document.getElementById('confettiCanvas');
    canvas.style.display = 'block';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const pieces = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: -10 - Math.random() * canvas.height * 0.45,
        w: 7 + Math.random() * 6, h: 4 + Math.random() * 4,
        color: PEG_COLORS[Math.floor(Math.random() * PEG_COLORS.length)],
        vx: (Math.random() - 0.5) * 5,
        vy: 1.5 + Math.random() * 4,
        rot: Math.random() * 360,
        rv: (Math.random() - 0.5) * 12,
    }));
    // Genius: extra burst from screen centre
    if (rating === 'Genius') {
        for (let i = 0; i < 80; i++) {
            const a = (i / 80) * Math.PI * 2;
            pieces.push({
                x: canvas.width / 2, y: canvas.height / 2,
                w: 8 + Math.random() * 7, h: 4 + Math.random() * 5,
                color: PEG_COLORS[Math.floor(Math.random() * PEG_COLORS.length)],
                vx: Math.cos(a) * (4 + Math.random() * 8),
                vy: Math.sin(a) * (4 + Math.random() * 8) - 4,
                rot: Math.random() * 360, rv: (Math.random() - 0.5) * 15,
            });
        }
    }
    let raf;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = false;
        for (const p of pieces) {
            p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.99; p.rot += p.rv;
            if (p.y < canvas.height + 20) alive = true;
            if (p.y > canvas.height + 20) continue;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, Math.min(1, (canvas.height - p.y) / canvas.height + 0.25));
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        if (alive) { raf = requestAnimationFrame(draw); }
        else { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.display = 'none'; }
    }
    draw();
}

// ── Board entrance animation (pegs drop in row by row) ─
function animateBoardEntrance() {
    const pegs = document.querySelectorAll('#pegsolBoard .pegsol-peg');
    pegs.forEach((peg, i) => {
        peg.classList.add('peg-enter');
        peg.style.animationDelay = `${i * 38}ms`;
    });
}

// ── Game logic helpers ─────────────────────────────
function validDestinations(game, fromIdx) {
    if (!game?.pegs || fromIdx < 0) return [];
    return MOVE_TRIPLES
        .filter(m => m.from === fromIdx && game.pegs[m.from] && game.pegs[m.over] && !game.pegs[m.to])
        .map(m => m.to);
}

// ── Render board ───────────────────────────────────
function renderBoard() {
    if (!myPlayer?.game) return;
    const game = myPlayer.game;
    const board = document.getElementById('pegsolBoard');
    const validTo = new Set(validDestinations(game, selectedFrom));
    board.innerHTML = '';
    if (game.isSetup) board.classList.add('setup');
    else board.classList.remove('setup');

    TRI_ROWS.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'pegsol-row';
        row.forEach(idx => {
            const hole = document.createElement('button');
            hole.className = 'pegsol-hole';
            hole.setAttribute('data-hole-idx', idx);
            if (!game.pegs[idx]) hole.classList.add('empty');
            if (idx === selectedFrom) hole.classList.add('selected');
            if (validTo.has(idx)) hole.classList.add('valid');
            hole.type = 'button';
            hole.setAttribute('aria-label', `Hole ${idx + 1}`);
            hole.onclick = () => onHoleClick(idx);
            if (game.pegs[idx]) {
                const peg = document.createElement('div');
                peg.className = 'pegsol-peg peg-c' + (idx % 15);
                hole.appendChild(peg);
            }
            rowEl.appendChild(hole);
        });
        board.appendChild(rowEl);
    });

    // Entrance animation only on first render (full board in setup phase)
    if (!_boardEntranceAnimated && game.isSetup) {
        _boardEntranceAnimated = true;
        requestAnimationFrame(animateBoardEntrance);
    }
}

// ── Render leaderboard ─────────────────────────────
function renderLeaderboard(room) {
    const lb = document.getElementById('pegsolLeaderboard');
    if (isSinglePlayer || !room || room.players.length <= 1) {
        lb.style.display = 'none';
        return;
    }
    lb.style.display = '';
    fetchAvatars(room.players.map(p => p.name));
    const sorted = [...room.players].sort((a, b) => (b.score - a.score) || (a.pegsLeft - b.pegsLeft));
    lb.innerHTML = '<div class="sol-lb-title">🏁 Peg Race</div>';
    sorted.forEach((p, i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '.';
        const meClass = p.name === myName ? ' me' : '';
        const finished = p.hasFinished ? ` · ${esc(p.rating || 'Try Again')}` : '';
        lb.innerHTML += `<div class="row${meClass}"><span>${medal}</span>${avatarHtml(p.name, 'sm')}<strong>${esc(p.name)}</strong><span style="margin-left:auto">${p.score} pts · ${p.pegsLeft} pegs${finished}</span></div>`;
    });
}

// ── Main render ────────────────────────────────────
function render(room) {
    roomState = room;
    myPlayer = room.players.find(p => p.name === myName);
    if (!myPlayer) return;

    const game = myPlayer.game;
    if (selectedFrom >= 0 && !game.pegs[selectedFrom]) selectedFrom = -1;

    document.getElementById('pegsolScore').textContent = `Score: ${myPlayer.score}`;
    document.getElementById('pegsolPegs').textContent = `Pegs Left: ${myPlayer.pegsLeft}`;
    document.getElementById('pegsolRating').textContent = `Rating: ${myPlayer.rating || '—'}`;
    document.getElementById('pegsolMoves').textContent = `Moves: ${game.moveCount}`;

    const status = room.isOver
        ? 'Game finished'
        : myPlayer.hasFinished
            ? `Finished: ${myPlayer.rating || 'Try Again'}`
            : game.isSetup
                ? '🪵 Click any peg to remove it and start!'
                : 'Select a peg, then jump over another';
    document.getElementById('pegsolStatus').textContent = status;

    renderBoard();
    renderLeaderboard(room);
    if (room.isOver) showResults(room);
}

// ── Click handler ──────────────────────────────────
function onHoleClick(idx) {
    if (!myPlayer?.game || roomState?.isOver || myPlayer.hasFinished) return;
    const game = myPlayer.game;

    // ── Setup phase: remove chosen starting peg ────
    if (game.isSetup) {
        if (!game.pegs[idx]) return;
        playSound('setup');
        animateSetupPop(idx);
        connection.invoke('PegSolitaireSetStartEmpty', roomId, idx)
            .catch(err => console.error('Setup failed:', err));
        return;
    }

    // ── Normal play ────────────────────────────────
    if (selectedFrom < 0) {
        if (game.pegs[idx]) { selectedFrom = idx; playSound('select'); }
        renderBoard();
        return;
    }
    if (idx === selectedFrom) { selectedFrom = -1; renderBoard(); return; }
    if (game.pegs[idx]) { selectedFrom = idx; playSound('select'); renderBoard(); return; }

    const validTo = validDestinations(game, selectedFrom);
    if (validTo.includes(idx)) {
        const move = MOVE_TRIPLES.find(m => m.from === selectedFrom && m.to === idx);
        if (move) { playSound('jump'); animatePegFlyOff(move.over, move.over % 15); }
        const from = selectedFrom;
        selectedFrom = -1;
        connection.invoke('MakePegSolitaireMove', roomId, from, idx)
            .catch(err => console.error('Move failed:', err));
        return;
    }

    playSound('invalid');
    selectedFrom = -1;
    renderBoard();
}

// ── Results overlay ────────────────────────────────
function showResults(room) {
    const me = room.players.find(p => p.name === myName);
    if (!me) return;
    document.getElementById('resultText').textContent = me.rating || 'Try Again';
    document.getElementById('resultStats').innerHTML =
        `<div>Score: <strong>${me.score}</strong> points</div>` +
        `<div>Pegs Left: <strong>${me.pegsLeft}</strong></div>` +
        `<div>Moves: <strong>${me.game?.moveCount ?? 0}</strong></div>`;
    document.getElementById('resultOverlay').style.display = 'flex';
    if (!_gameOverEventFired) {
        _gameOverEventFired = true;
        const soundMap = { 'Genius': 'win-genius', 'Smart': 'win-smart', 'Average': 'win-avg' };
        playSound(soundMap[me.rating] || 'game-over');
        launchConfetti(me.rating);
        document.dispatchEvent(new Event('gameOver'));
    }
}

// ── Init ───────────────────────────────────────────
async function init() {
    const res = await fetch('/api/me');
    const me = await res.json();
    myName = me.name;
    await fetchAvatars([myName]);

    if (isSinglePlayer) document.getElementById('chatWidget').style.display = 'none';

    connection.on('PegSolitaireUpdated', room => render(room));
    connection.on('PlayerLeft', name => {
        document.getElementById('pegsolStatus').textContent = `${name} left the game.`;
    });

    connection.on('PegSolitaireSinglePlayerStarted', newRoomId => {
        roomId = newRoomId;
        sessionStorage.setItem('pegSolitaireRoomId', newRoomId);
    });

    connection.on('PegSolitaireRoomUpdated', () => {
        window.location.href = '/peg-solitaire-room';
    });

    await connection.start();
    await connection.invoke('RejoinPegSolitaireRoom', roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

function backToLobby() {
    connection.invoke('LeavePegSolitaireRoom', roomId).finally(() => { window.location.href = '/lobby'; });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('backBtn').addEventListener('click', backToLobby);
    document.getElementById('backToLobby').addEventListener('click', backToLobby);
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        if (isSinglePlayer) {
            document.getElementById('resultOverlay').style.display = 'none';
            _gameOverEventFired = false;
            roomState = null;
            connection.invoke('StartPegSolitaireSinglePlayer').catch(e => console.error(e));
        } else {
            window.location.href = '/peg-solitaire-room';
        }
    });
});

function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById('chatToggle'), panel = document.getElementById('chatPanel'),
          close = document.getElementById('chatClose'), input = document.getElementById('chatInput'),
          send = document.getElementById('chatSend'), msgs = document.getElementById('chatMessages'),
          badge = document.getElementById('chatBadge');

    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? 'flex' : 'none'; if (chatOpen) { unread = 0; badge.style.display = 'none'; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = 'none'; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke('SendChat', groupId, m); input.value = ''; }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
    conn.on('ChatMessage', (name, message) => {
        const el = document.createElement('div'); el.className = 'chat-msg';
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}

init();
