// =============================================================
// Chinese Checkers — Audio · Hop animation · Laser hints · FX
// =============================================================

const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("chineseCheckersRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing Chinese Checkers room id"); }

let myName        = sessionStorage.getItem("myName") || "";
let state         = null;
let selectedPiece = null;
let _gameOverFired = false;
let _hintTimer    = null;
let _prevMyTurn   = false;
let _firstState   = true;
let _hopLock      = false;   // prevent concurrent hop animations

// Mirror CSS: clamp(10px, 1.8vw, 20px)
const NODE_SIZE_MIN = 10, NODE_SIZE_VW = 0.018, NODE_SIZE_MAX = 20;

const COLORS = ["#ef4444","#22c55e","#3b82f6","#f59e0b","#a855f7","#14b8a6","#f97316"];

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// ── Piece-position tracking (for hop detection) ──────────────────
const _prevPieces = new Map();
function _updatePrevPieces(pieces) {
    _prevPieces.clear();
    (pieces || []).forEach(p => _prevPieces.set(p.id, p.nodeId));
}
function _detectMoved(pieces) {
    const moved = [];
    (pieces || []).forEach(p => {
        const prev = _prevPieces.get(p.id);
        if (prev && prev !== p.nodeId)
            moved.push({ pieceId: p.id, fromNodeId: prev, toNodeId: p.nodeId, ownerIndex: p.ownerIndex });
    });
    return moved;
}

// ── Web Audio (zero external files) ─────────────────────────────
let _actx = null;
function _ac() {
    if (!_actx) { try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
    return _actx;
}
function _tone(freq, vol, type, dur, t0 = 0) {
    const ctx = _ac(); if (!ctx) return;
    const osc = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0;
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + dur + 0.01);
}
function _ramp(f0, f1, vol, type, dur, t0 = 0) {
    const ctx = _ac(); if (!ctx) return;
    const osc = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0;
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + dur + 0.01);
}
function sndSelect()   { _ramp(800,1400,0.11,'sine',0.07); _tone(1600,0.04,'sine',0.05,0.04); }
function sndStep()     { _ramp(380,240,0.14,'triangle',0.11); _tone(150,0.12,'sine',0.08,0.06); }
function sndJump()     { _ramp(280,720,0.12,'sine',0.18); _ramp(720,860,0.05,'sine',0.07,0.16); _tone(170,0.17,'triangle',0.13,0.22); }
function sndWin()      { [523.25,659.25,783.99,1046.5].forEach((f,i) => { _tone(f,0.17,'sine',0.45,i*0.12); _tone(f*2,0.06,'sine',0.25,i*0.12+0.06); }); }
function sndLose()     { _ramp(440,220,0.14,'sawtooth',0.4); _tone(165,0.1,'sine',0.35,0.22); }
function sndHint()     { _ramp(900,1900,0.08,'sine',0.09); _ramp(1900,1400,0.05,'sine',0.07,0.11); }
function sndYourTurn() { _tone(660,0.10,'sine',0.13); _tone(880,0.08,'sine',0.10,0.11); }

// ── Marble hop animation ─────────────────────────────────────────
function _animateHop(move, color, onDone) {
    try {
        const board = document.getElementById('ccBoard');
        if (!board || !state) { onDone(); return; }
        const br = board.getBoundingClientRect();
        const fn = state.nodes.find(n => n.id === move.fromNodeId);
        const tn = state.nodes.find(n => n.id === move.toNodeId);
        if (!fn || !tn) { onDone(); return; }

        const fx = br.width  * fn.x / 100, fy = br.height * fn.y / 100;
        const tx = br.width  * tn.x / 100, ty = br.height * tn.y / 100;

        // Mirror CSS: clamp(NODE_SIZE_MIN, NODE_SIZE_VW·vw, NODE_SIZE_MAX)
        const np     = Math.min(Math.max(window.innerWidth * NODE_SIZE_VW, NODE_SIZE_MIN), NODE_SIZE_MAX);
        const dist   = Math.hypot(tx - fx, ty - fy);
        const isJump = dist > np * 2.8;
        const arcH   = Math.min(br.height * 0.18, 55) * (isJump ? 1.4 : 0.75);
        const midX   = (fx + tx) / 2;
        const midY   = Math.min(fy, ty) - arcH;

        const el = document.createElement('div');
        el.className = 'cc-marble-flying';
        el.style.cssText = `width:${np}px;height:${np}px;transform:translate(${fx - np/2}px,${fy - np/2}px)`;
        el.style.setProperty('--mc', color);
        board.appendChild(el);

        if (isJump) sndJump(); else sndStep();

        const su = isJump ? 1.55 : 1.2, dur = isJump ? 380 : 230;
        const anim = el.animate([
            { transform: `translate(${fx-np/2}px,${fy-np/2}px) scale(1)`,        filter: 'brightness(1) drop-shadow(0 0 0 transparent)' },
            { transform: `translate(${midX-np/2}px,${midY-np/2}px) scale(${su})`, filter: `brightness(1.45) drop-shadow(0 0 ${np*0.7}px ${color})` },
            { transform: `translate(${tx-np/2}px,${ty-np/2}px) scale(1)`,        filter: 'brightness(1) drop-shadow(0 0 0 transparent)' },
        ], { duration: dur, easing: 'cubic-bezier(0.4,0,0.2,1)', fill: 'forwards' });
        anim.onfinish = anim.oncancel = () => { el.remove(); onDone(); };
    } catch(e) { onDone(); }
}

// Animate each segment in a multi-hop path sequentially.
// path is an array of nodeIds [start, hop1, hop2, ..., end].
async function _animateHops(path, color) {
    if (!path || path.length < 2) return;
    for (let i = 0; i < path.length - 1; i++) {
        await new Promise(resolve => _animateHop({ fromNodeId: path[i], toNodeId: path[i + 1] }, color, resolve));
    }
}

// ── Hint laser SVG overlay ───────────────────────────────────────
function _clearLaser() { document.querySelector('.cc-hint-svg')?.remove(); }

function _drawLaser(fromId, toId) {
    _clearLaser();
    const board = document.getElementById('ccBoard'); if (!board) return;
    const fromEl = board.querySelector(`[data-node-id="${fromId}"]`);
    const toEl   = board.querySelector(`[data-node-id="${toId}"]`);
    if (!fromEl || !toEl) return;

    const br = board.getBoundingClientRect();
    const fc = fromEl.getBoundingClientRect(), tc = toEl.getBoundingClientRect();
    const fx = fc.left + fc.width/2  - br.left, fy = fc.top + fc.height/2 - br.top;
    const tx = tc.left + tc.width/2  - br.left, ty = tc.top + tc.height/2 - br.top;
    const r  = fc.width / 2 + 3;

    const ns  = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.classList.add('cc-hint-svg');
    svg.setAttribute('width',   br.width);
    svg.setAttribute('height',  br.height);
    svg.setAttribute('viewBox', `0 0 ${br.width} ${br.height}`);
    svg.innerHTML = `
      <defs>
        <filter id="ccGlw" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <line class="cc-laser-glow" x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}"/>
      <line class="cc-laser-line" x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}"/>
      <circle class="cc-laser-origin"   cx="${fx}" cy="${fy}" r="${r}"/>
      <circle class="cc-laser-origin cc-laser-origin-2" cx="${fx}" cy="${fy}" r="${r+5}"/>
      <circle class="cc-laser-target"   cx="${tx}" cy="${ty}" r="${r}"/>
      <circle class="cc-laser-target cc-laser-target-2" cx="${tx}" cy="${ty}" r="${r+5}"/>`;
    board.appendChild(svg);
    setTimeout(_clearLaser, 9000);
}

// ── Win confetti ─────────────────────────────────────────────────
function _confetti() {
    const cols = ['#ef4444','#22c55e','#3b82f6','#f59e0b','#a855f7','#14b8a6','#f97316','#ec4899'];
    for (let i = 0; i < 90; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            const sz = 4 + Math.random() * 8;
            el.className = 'cc-confetti';
            el.style.cssText = `left:${5+Math.random()*90}%;background:${cols[i%cols.length]};` +
                `width:${sz}px;height:${sz}px;border-radius:${Math.random()>.5?'50%':'2px'};` +
                `animation:${1.4+Math.random()*1.4}s linear forwards ccConfettiFall`;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 4000);
        }, i * 20);
    }
}

// ── "Your turn" status flash ─────────────────────────────────────
function _flashYourTurn() {
    const el = document.getElementById('ccStatus'); if (!el) return;
    el.classList.remove('cc-your-turn-anim');
    void el.offsetWidth; // forces reflow so the browser resets the animation state
    el.classList.add('cc-your-turn-anim');
    sndYourTurn();
}

// ── Players bar ──────────────────────────────────────────────────
function _renderPlayers() {
    if (!state) return;
    const el = document.getElementById("ccPlayers"); el.innerHTML = "";
    fetchAvatars(state.players.map(p => p.name));
    state.players.forEach((p, i) => {
        const div = document.createElement("div");
        div.className = "player-bar-item" +
            (i === state.currentPlayerIndex && !state.isOver ? " active" : "") +
            (p.name === myName ? " is-me" : "");
        const rank = p.finishRank > 0 ? ` <span class="cc-rank">#${p.finishRank}</span>` : "";
        div.innerHTML = avatarHtml(p.name, 'sm') +
            '<span class="room-player-name">' + esc(p.name) + '</span>' +
            '<span class="player-score">' + p.score + rank + '</span>';
        el.appendChild(div);
    });
}

function _renderStatus(myTurn) {
    if (!state) return;
    const cur = state.players[state.currentPlayerIndex];
    document.getElementById("ccStatus").textContent = state.isOver
        ? (state.winnerName === myName ? "You win! 🎉" : (state.winnerName ? state.winnerName + " wins!" : "Game over"))
        : (myTurn ? "Your turn — select a marble" : (cur ? `${cur.name}'s turn` : "Waiting..."));
}

// ── Full state render ────────────────────────────────────────────
function renderState() {
    if (!state) return;
    const cur = state.players[state.currentPlayerIndex];
    const myTurn = !!cur && cur.name === myName;
    _renderPlayers();
    _renderStatus(myTurn);
    renderBoard(myTurn);
    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName === myName
            ? "You won Chinese Checkers! 🎉" : (state.winnerName ? `${state.winnerName} wins!` : "Game over");
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverFired) { _gameOverFired = true; document.dispatchEvent(new Event("gameOver")); }
    }
}

// ── Board render ─────────────────────────────────────────────────
function renderBoard(myTurn) {
    const board = document.getElementById("ccBoard");
    const laser = board.querySelector('.cc-hint-svg'); // preserve laser overlay
    board.innerHTML = "";
    if (laser) board.appendChild(laser);
    if (!state) return;

    const byNode  = new Map(); (state.pieces || []).forEach(p => byNode.set(p.nodeId, p));
    const byPiece = new Map();
    (state.legalMoves || []).forEach(m => {
        if (!byPiece.has(m.pieceId)) byPiece.set(m.pieceId, []);
        byPiece.get(m.pieceId).push(m);
    });

    state.nodes.forEach(node => {
        const btn = document.createElement("button");
        btn.className = "cc-node";
        btn.style.left = node.x + "%"; btn.style.top = node.y + "%";
        btn.dataset.nodeId = node.id;

        const piece = byNode.get(node.id);
        if (piece) {
            const owner = state.players[piece.ownerIndex];
            const color = COLORS[(owner?.colorIndex ?? piece.ownerIndex) % COLORS.length];
            const dot = document.createElement("span");
            dot.className = "cc-piece" + (selectedPiece === piece.id ? " selected" : "");
            dot.style.setProperty('--mc', color);
            dot.title = owner?.name || "Player";
            btn.appendChild(dot);
            if (myTurn && owner && owner.name === myName) {
                btn.classList.add("cc-node-clickable");
                btn.onclick = () => { sndSelect(); _clearLaser(); selectedPiece = piece.id; renderBoard(myTurn); };
            }
        }

        if (selectedPiece && !piece) {
            const mv = (byPiece.get(selectedPiece) || []).find(m => m.toNodeId === node.id);
            if (mv) {
                btn.classList.add("cc-legal-move");
                btn.title = mv.isJump ? "Jump" : "Step";
                if (myTurn) {
                    btn.onclick = () => {
                        _clearLaser();
                        connection.invoke("ChineseCheckersMove", roomId, selectedPiece, node.id);
                        selectedPiece = null;
                    };
                }
            }
        }
        board.appendChild(btn);
    });
}

// ── Hint text typewriter ─────────────────────────────────────────
function showTypedHint(text) {
    const el = document.getElementById("ccHintBanner");
    if (_hintTimer) clearInterval(_hintTimer);
    el.style.display = "block"; el.textContent = "";
    let i = 0;
    _hintTimer = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) { clearInterval(_hintTimer); _hintTimer = null; }
    }, 18);
}

// ── Navigation ────────────────────────────────────────────────────
function backToLobby() {
    connection.invoke("LeaveChineseCheckersGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
    try {
        if (!myName) { const me = await fetch("/api/me").then(r => r.json()); myName = me.name; }

        // Unlock Web Audio on first user gesture (browser autoplay policy)
        document.addEventListener('click', () => _ac()?.resume(), { once: true });

        connection.on("ChineseCheckersUpdated", async s => {
            const moved = state ? _detectMoved(s.pieces) : [];
            _updatePrevPieces(s.pieces);
            state = s;

            const cur    = s.players[s.currentPlayerIndex];
            const myTurn = !!cur && cur.name === myName;
            if (myTurn && !_prevMyTurn && !s.isOver && !_firstState) _flashYourTurn();
            _prevMyTurn = myTurn;
            _firstState = false;
            _clearLaser();

            if (moved.length > 0 && s.nodes && !s.isOver && !_hopLock) {
                _hopLock = true;
                const m     = moved[0];
                const owner = s.players[m.ownerIndex];
                const color = COLORS[(owner?.colorIndex ?? m.ownerIndex) % COLORS.length];

                // Use the server-provided hop path for accurate multi-bounce animation.
                // Fall back to straight start→end if no path available.
                const path = (s.lastMove && s.lastMove.path && s.lastMove.path.length >= 2)
                    ? s.lastMove.path
                    : [m.fromNodeId, m.toNodeId];

                // Render new state, then temporarily hide the destination marble
                // so the flying marble appears to land there
                _renderPlayers(); _renderStatus(false);
                renderBoard(false);
                const destPiece = document.querySelector(`[data-node-id="${path[path.length-1]}"] .cc-piece`);
                if (destPiece) destPiece.style.visibility = 'hidden';

                await _animateHops(path, color);

                if (destPiece) destPiece.style.visibility = '';
                const curNow = state.players[state.currentPlayerIndex];
                renderBoard(!!curNow && curNow.name === myName);
                _hopLock = false;
            } else {
                renderState();
            }

            if (s.isOver && !_gameOverFired) {
                _gameOverFired = true;
                if (s.winnerName === myName) { sndWin(); setTimeout(_confetti, 300); }
                else sndLose();
                document.getElementById("resultText").textContent = s.winnerName === myName
                    ? "You won Chinese Checkers! 🎉" : (s.winnerName ? `${s.winnerName} wins!` : "Game over");
                setTimeout(() => {
                    document.getElementById("resultOverlay").style.display = "flex";
                }, s.winnerName === myName ? 700 : 100);
                document.dispatchEvent(new Event("gameOver"));
            }
        });

        connection.on("ChineseCheckersHint", hint => {
            if (!hint || !hint.hintAvailable) { showTypedHint("No legal moves available."); return; }
            selectedPiece = hint.pieceId;
            const cur = state?.players[state?.currentPlayerIndex];
            renderBoard(!!cur && cur.name === myName);
            showTypedHint(hint.description || "Try advancing one of your marbles toward its goal.");
            if (state && hint.pieceId && hint.toNodeId) {
                const piece = state.pieces.find(p => p.id === hint.pieceId);
                if (piece) setTimeout(() => _drawLaser(piece.nodeId, hint.toNodeId), 50);
            }
        });

        connection.on("PlayerLeft", name => {
            document.getElementById("ccStatus").textContent = name + " left the game.";
        });

        await connection.start();
        await connection.invoke("RejoinChineseCheckersRoom", roomId);
    } catch(err) {
        console.error("Chinese Checkers init failed:", err);
        document.getElementById("ccStatus").textContent = "Failed to load game. Please refresh the page.";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("ccHintBtn").addEventListener("click", () => {
        connection.invoke("RequestChineseCheckersHint", roomId);
    });
    document.getElementById("ccRulesBtn").addEventListener("click", () => {
        document.getElementById("ccRulesModal").style.display = "flex";
    });
    document.getElementById("ccRulesClose").addEventListener("click", () => {
        document.getElementById("ccRulesModal").style.display = "none";
    });
    document.getElementById("ccRulesModal").addEventListener("click", e => {
        if (e.target === e.currentTarget) e.currentTarget.style.display = "none";
    });
    document.getElementById("ccBackBtn").addEventListener("click", backToLobby);
    document.getElementById("backToLobby").addEventListener("click", backToLobby);
    document.getElementById("hamBackBtn").addEventListener("click", backToLobby);
});

init();
