const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
const roomId = sessionStorage.getItem('bonesRoomId');
if (!roomId) {
    window.location.replace('/lobby');
    throw new Error('Missing Bones room id');
}

let myName = sessionStorage.getItem('myName') || '';
let state = null;
let _ac = null;
let _selectedTileId = null;
let _gameOverFired = false;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─── Audio ────────────────────────────────────────────────────────────────────
function audioCtx() {
    if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
    return _ac;
}
function tone(freq, dur = 0.1, vol = 0.08, type = 'sine', delay = 0) {
    const ac = audioCtx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
    o.connect(g); g.connect(ac.destination);
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
}
function sndPlace()  { tone(440, 0.07, 0.12); tone(660, 0.09, 0.10, 'sine', 0.07); }
function sndDraw()   { tone(330, 0.06, 0.09); tone(262, 0.08, 0.07, 'sine', 0.06); }
function sndTurn()   { tone(523, 0.06, 0.08); tone(659, 0.06, 0.08, 'sine', 0.07); tone(784, 0.10, 0.10, 'sine', 0.14); }
function sndWin()    { [523,659,784,1047].forEach((f,i) => setTimeout(() => tone(f, 0.22, 0.13), i * 100)); }
function sndLose()   { [400,350,300].forEach((f,i) => setTimeout(() => tone(f, 0.18, 0.10), i * 120)); }
function sndRound()  { tone(784, 0.12, 0.12); tone(988, 0.15, 0.12, 'sine', 0.12); }
function sndBlocked(){ tone(200, 0.18, 0.10, 'square'); }
function sndHint()   { tone(980, 0.06, 0.07); tone(1300, 0.06, 0.05, 'sine', 0.07); }
function sndPass()   { tone(350, 0.07, 0.08); tone(280, 0.08, 0.07, 'sine', 0.07); }

// ─── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti(count = 90) {
    const colors = ['#12919E','#C4E7E9','#fbbf24','#f472b6','#7c6aff','#36d6c3'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'bones-confetti';
            el.style.left = (Math.random() * 100) + '%';
            el.style.background = colors[i % colors.length];
            el.style.animationDuration = (1.5 + Math.random() * 1.8) + 's';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3600);
        }, i * 22);
    }
}

// ─── Pip rendering ────────────────────────────────────────────────────────────
// Returns HTML for a single pip-face (0–6) using a 3×3 grid layout
const PIP_LAYOUTS = {
    0: [0,0,0, 0,0,0, 0,0,0],
    1: [0,0,0, 0,1,0, 0,0,0],
    2: [1,0,0, 0,0,0, 0,0,1],
    3: [1,0,0, 0,1,0, 0,0,1],
    4: [1,0,1, 0,0,0, 1,0,1],
    5: [1,0,1, 0,1,0, 1,0,1],
    6: [1,0,1, 1,0,1, 1,0,1],
};
function pipFaceHtml(n) {
    const layout = PIP_LAYOUTS[n] || PIP_LAYOUTS[0];
    return '<div class="pip-grid">' + layout.map(v => `<div class="pip${v ? '' : ' empty'}"></div>`).join('') + '</div>';
}

function tileLabel(l, h) { return `[${l}|${h}]`; }

// Portrait domino HTML (for hand)
function handDominoHtml(tileId, low, high, canPlace, selected) {
    const cls = ['hand-domino'];
    if (canPlace !== 'none') cls.push('playable'); else cls.push('not-playable');
    if (selected) cls.push('selected');
    const pipTotal = low + high;
    return `<div class="${cls.join(' ')}" data-tile="${tileId}" title="${tileLabel(low,high)} (${pipTotal} pips)" aria-label="Domino ${low}|${high}">
        <div class="domino-half">${pipFaceHtml(low)}</div>
        <div class="domino-half">${pipFaceHtml(high)}</div>
    </div>`;
}

// Landscape domino HTML (for chain — compact)
function chainDominoHtml(shownLeft, shownRight) {
    return `<div class="chain-domino">
        <div class="domino-half">${pipFaceHtml(shownLeft)}</div>
        <div class="domino-half">${pipFaceHtml(shownRight)}</div>
    </div>`;
}

// ─── State rendering ─────────────────────────────────────────────────────────
function render(s) {
    // Status line
    const statusEl = document.getElementById('bonesStatus');
    if (s.isOver) {
        statusEl.textContent = s.winnerName === myName ? '🏆 You win!' : `🏆 ${s.winnerName} wins!`;
        statusEl.className = 'turn-indicator ' + (s.winnerName === myName ? 'my-turn' : '');
    } else if (s.roundOver) {
        statusEl.textContent = s.gameBlocked ? '🔒 Game blocked!' : `🦴 Round ${s.roundNumber} over — ${s.roundWinnerName} wins!`;
        statusEl.className = 'turn-indicator';
    } else if (s.myTurn) {
        statusEl.textContent = '⚡ Your turn!';
        statusEl.className = 'turn-indicator my-turn';
    } else {
        const cur = s.players[s.currentPlayerIndex];
        statusEl.textContent = cur ? `⏳ ${cur.name}'s turn` : '';
        statusEl.className = 'turn-indicator';
    }

    // Info bar
    const infoBar = document.getElementById('bonesInfoBar');
    infoBar.innerHTML =
        `<span class="bones-info-item">🦴 <strong>${s.boneyardCount}</strong> boneyard</span>` +
        `<span class="bones-info-item">🎯 Target: <strong>${s.settings.targetScore}</strong></span>` +
        `<span class="bones-info-item">Round <strong>${s.roundNumber}</strong></span>`;

    // Player bar
    const playerBar = document.getElementById('bonesPlayerBar');
    playerBar.innerHTML = s.players.map((p, i) => {
        const cls = ['bones-player-chip'];
        if (i === s.currentPlayerIndex && !s.roundOver && !s.isOver) cls.push('is-current');
        if (p.name === myName) cls.push('is-me');
        return `<div class="${cls.join(' ')}">
            <span>${esc(p.name)}${p.isBot ? ' 🤖' : ''}${p.name === myName ? ' (You)' : ''}</span>
            <span class="bpc-score">${p.totalScore}pts</span>
            <span class="bpc-tiles">🀱${p.tileCount}</span>
        </div>`;
    }).join('');

    // Chain
    renderChain(s);

    // Hand
    renderHand(s);

    // Action buttons
    const drawBtn = document.getElementById('bonesDrawBtn');
    const passBtn = document.getElementById('bonesPassBtn');
    const nextRoundBtn = document.getElementById('bonesNextRoundBtn');
    drawBtn.style.display = s.canDraw ? '' : 'none';
    passBtn.style.display = s.canPass ? '' : 'none';
    nextRoundBtn.style.display = (s.roundOver && !s.isOver && (s.isHost || s.isSinglePlayer)) ? '' : 'none';
}

function renderChain(s) {
    const chain = document.getElementById('bonesChain');
    if (!s.chain || s.chain.length === 0) {
        chain.innerHTML = '<span class="chain-empty">Waiting for first tile&hellip;</span>';
        return;
    }
    let html = '';
    if (s.leftOpenEnd >= 0) {
        html += `<div class="chain-end-marker">${s.leftOpenEnd}</div>`;
    }
    // Show up to 15 chain entries to keep it manageable
    const maxVisible = 15;
    const startIdx = Math.max(0, s.chain.length - maxVisible);
    if (startIdx > 0) html += `<span style="color:var(--text-dim);font-size:0.8rem;">…+${startIdx}</span>`;
    for (let i = startIdx; i < s.chain.length; i++) {
        const e = s.chain[i];
        html += chainDominoHtml(e.shownLeft, e.shownRight);
    }
    if (s.rightOpenEnd >= 0) {
        html += `<div class="chain-end-marker">${s.rightOpenEnd}</div>`;
    }
    chain.innerHTML = html;
    // Scroll to end
    const wrap = document.getElementById('bonesBoardWrap');
    wrap.scrollLeft = wrap.scrollWidth;
}

function renderHand(s) {
    const handEl = document.getElementById('bonesHand');
    if (!s.myHand || s.myHand.length === 0) {
        handEl.innerHTML = '<span style="color:var(--text-dim);font-style:italic;font-size:0.85rem;">Empty hand</span>';
        return;
    }
    // Sort: playable first, then by pip count descending
    const tiles = [...s.myHand].sort((a, b) => {
        const ap = a.canPlace !== 'none' ? 0 : 1;
        const bp = b.canPlace !== 'none' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (b.low + b.high) - (a.low + a.high);
    });

    handEl.innerHTML = tiles.map(t =>
        handDominoHtml(t.tileId, t.low, t.high, t.canPlace, t.tileId === _selectedTileId)
    ).join('');

    handEl.querySelectorAll('.hand-domino.playable').forEach(el => {
        el.addEventListener('click', () => {
            if (!s.myTurn) return;
            const tileId = parseInt(el.dataset.tile, 10);
            const tile = s.myHand.find(t => t.tileId === tileId);
            if (!tile || tile.canPlace === 'none') return;
            handleTileClick(tileId, tile.canPlace);
        });
    });
}

function handleTileClick(tileId, canPlace) {
    hideSideBanner();
    hideHintBanner();
    if (canPlace === 'both') {
        // Need to ask which side
        _selectedTileId = tileId;
        render(state); // re-render to show selection highlight
        showSideBanner(tileId);
    } else {
        _selectedTileId = null;
        sndPlace();
        connection.invoke('BonesPlaceTile', roomId, tileId, canPlace);
    }
}

function showSideBanner(tileId) {
    const tile = state.myHand.find(t => t.tileId === tileId);
    if (!tile) return;
    document.getElementById('sideTileLabel').textContent = tileLabel(tile.low, tile.high);
    const banner = document.getElementById('bonesSideBanner');
    banner.style.display = 'flex';
}

function hideSideBanner() {
    document.getElementById('bonesSideBanner').style.display = 'none';
    _selectedTileId = null;
}

function hideHintBanner() {
    document.getElementById('bonesHintBanner').style.display = 'none';
}

function showHintBanner(msg) {
    const el = document.getElementById('bonesHintBanner');
    el.textContent = '💡 ' + msg;
    el.style.display = '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ─── Round overlay ────────────────────────────────────────────────────────────
function showRoundOverlay(s) {
    document.getElementById('roundTitle').textContent = s.gameBlocked ? '🔒 Blocked!' : '🦴 Round Over!';
    document.getElementById('roundInfo').textContent = s.gameBlocked
        ? 'No one could play — lowest pips wins.'
        : `${s.roundWinnerName} played all their tiles!`;

    const scoresEl = document.getElementById('roundScores');
    const sorted = [...s.players].sort((a, b) => b.totalScore - a.totalScore);
    scoresEl.innerHTML = sorted.map(p =>
        `<div class="round-score-row${p.name === s.roundWinnerName ? ' is-winner' : ''}">
            <span>${esc(p.name)}${p.isBot ? ' 🤖' : ''}${p.name === myName ? ' (You)' : ''}</span>
            <span>${p.totalScore} pts</span>
        </div>`
    ).join('');

    const isHostOrSP = s.isHost || s.isSinglePlayer;
    document.getElementById('roundNextBtn').style.display = isHostOrSP ? '' : 'none';
    document.getElementById('roundNextBtn').onclick = () => {
        document.getElementById('roundOverlay').style.display = 'none';
        connection.invoke('BonesNextRound', roomId);
    };
    document.getElementById('roundOverlay').style.display = 'flex';
}

function showGameOver(s) {
    document.getElementById('resultOverlay').style.display = 'flex';
    const isWinner = s.winnerName === myName;
    document.getElementById('resultText').textContent = isWinner ? '🏆 You Win!' : `🎯 ${s.winnerName} Wins!`;
    document.getElementById('resultSub').textContent = isWinner
        ? 'Congratulations! You reached the target score first.'
        : 'Better luck next round!';
    if (isWinner) launchConfetti();
}

// ─── SignalR handlers ─────────────────────────────────────────────────────────
let _prevRoundOver = false;
let _prevIsOver = false;
let _prevMyTurn = false;

connection.on('BonesUpdated', s => {
    const prev = state;
    state = s;

    hideSideBanner();
    hideHintBanner();

    render(s);

    // Sound effects
    if (!prev) { /* first render */ }
    else if (s.myTurn && !_prevMyTurn) sndTurn();
    else if (!s.myTurn && _prevMyTurn) { /* turn moved away */ }

    // Round over
    if (s.roundOver && !_prevRoundOver) {
        if (s.gameBlocked) sndBlocked(); else sndRound();
        setTimeout(() => showRoundOverlay(s), 600);
    }

    // Game over
    if (s.isOver && !_prevIsOver) {
        if (!_gameOverFired) {
            _gameOverFired = true;
            if (s.winnerName === myName) sndWin(); else sndLose();
            setTimeout(() => showGameOver(s), 800);
        }
    }

    _prevRoundOver = s.roundOver;
    _prevIsOver = s.isOver;
    _prevMyTurn = !!s.myTurn;
});

connection.on('BonesHint', hint => {
    sndHint();
    if (hint.hintAvailable) {
        showHintBanner(hint.description);
        if (hint.tileId >= 0) {
            // Highlight the suggested tile
            document.querySelectorAll('.hand-domino').forEach(el => {
                if (parseInt(el.dataset.tile, 10) === hint.tileId)
                    el.style.boxShadow = '0 0 0 3px #fbbf24, 0 0 18px rgba(251,191,36,0.5)';
            });
        }
    } else {
        showHintBanner(hint.description);
    }
});

connection.on('PlayerLeft', name => {
    showHintBanner(`${name} left the game.`);
});

// ─── Button handlers ──────────────────────────────────────────────────────────
document.getElementById('sideLeftBtn').addEventListener('click', () => {
    if (_selectedTileId == null) return;
    const tileId = _selectedTileId;
    hideSideBanner();
    sndPlace();
    connection.invoke('BonesPlaceTile', roomId, tileId, 'left');
});

document.getElementById('sideRightBtn').addEventListener('click', () => {
    if (_selectedTileId == null) return;
    const tileId = _selectedTileId;
    hideSideBanner();
    sndPlace();
    connection.invoke('BonesPlaceTile', roomId, tileId, 'right');
});

document.getElementById('sideCancelBtn').addEventListener('click', () => {
    hideSideBanner();
    render(state);
});

document.getElementById('bonesDrawBtn').addEventListener('click', () => {
    sndDraw();
    connection.invoke('BonesDrawTile', roomId);
});

document.getElementById('bonesPassBtn').addEventListener('click', () => {
    sndPass();
    connection.invoke('BonesPas', roomId);
});

document.getElementById('bonesHintBtn').addEventListener('click', () => {
    connection.invoke('RequestBonesHint', roomId);
});

document.getElementById('bonesNextRoundBtn').addEventListener('click', () => {
    document.getElementById('roundOverlay').style.display = 'none';
    connection.invoke('BonesNextRound', roomId);
});

document.getElementById('bonesBackBtn').addEventListener('click', () => {
    connection.invoke('LeaveBonesGame', roomId).then(() => { window.location.href = '/lobby'; });
});

document.getElementById('backToLobby').addEventListener('click', () => {
    connection.invoke('LeaveBonesGame', roomId).then(() => { window.location.href = '/lobby'; });
});

if (document.getElementById('backBtn2'))
    document.getElementById('backBtn2').addEventListener('click', () => {
        connection.invoke('LeaveBonesGame', roomId).then(() => { window.location.href = '/lobby'; });
    });

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    const me = await fetch('/api/me').then(r => r.json());
    myName = me.name;
    sessionStorage.setItem('myName', myName);

    // Update navbar
    document.getElementById('navbarUsername').textContent = myName;
    if (me.avatar) {
        document.getElementById('navbarAvatarEmoji').textContent = me.avatar;
        document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    }

    await connection.start();
    await connection.invoke('RejoinBonesRoom', roomId);
}

init();
