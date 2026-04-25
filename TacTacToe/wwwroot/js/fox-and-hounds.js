// ════════════════════════════════════════════════════════════════
// Fox and Hounds — client-side logic
// ════════════════════════════════════════════════════════════════

const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
let roomId = sessionStorage.getItem('foxAndHoundsRoomId');
const isSinglePlayer = sessionStorage.getItem('isSinglePlayer') === '1';
if (!roomId) { window.location.replace('/lobby'); throw new Error('Missing Fox and Hounds room id'); }

let myName = sessionStorage.getItem('myName') || '';
let state   = null;
let selectedPiece = null;   // { type: 'fox'|'hound', houndIndex: -1|0-3 }
let _gameOverFired = false;
let _prevState = null;
let _animLock  = false;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Audio ─────────────────────────────────────────────────────────────────────
let _actx = null;
function _ac() {
    if (!_actx) { try { _actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {} }
    return _actx;
}
function _tone(f, v, t, d, t0=0) {
    const ctx=_ac(); if(!ctx)return;
    const osc=ctx.createOscillator(), g=ctx.createGain(), ts=ctx.currentTime+t0;
    osc.type=t; osc.frequency.setValueAtTime(f,ts);
    g.gain.setValueAtTime(0.001,ts); g.gain.linearRampToValueAtTime(v,ts+0.006); g.gain.exponentialRampToValueAtTime(0.001,ts+d);
    osc.connect(g); g.connect(ctx.destination); osc.start(ts); osc.stop(ts+d+0.01);
}
function _ramp(f0,f1,v,t,d,t0=0) {
    const ctx=_ac(); if(!ctx)return;
    const osc=ctx.createOscillator(), g=ctx.createGain(), ts=ctx.currentTime+t0;
    osc.type=t; osc.frequency.setValueAtTime(f0,ts); osc.frequency.exponentialRampToValueAtTime(f1,ts+d);
    g.gain.setValueAtTime(v,ts); g.gain.exponentialRampToValueAtTime(0.001,ts+d);
    osc.connect(g); g.connect(ctx.destination); osc.start(ts); osc.stop(ts+d+0.01);
}
function sndSelect()   { _ramp(800,1400,0.10,'sine',0.07); }
function sndMove()     { _ramp(340,220,0.13,'triangle',0.12); _tone(150,0.10,'sine',0.08,0.07); }
function sndYourTurn() { _tone(660,0.09,'sine',0.13); _tone(880,0.07,'sine',0.10,0.11); }
function sndWin()      { [523.25,659.25,783.99,1046.5].forEach((f,i)=>{ _tone(f,0.16,'sine',0.45,i*0.12); }); }
function sndLose()     { _ramp(440,220,0.13,'sawtooth',0.4); _tone(165,0.09,'sine',0.35,0.22); }
function sndHint()     { _ramp(900,1900,0.07,'sine',0.09); }
function sndIllegal()  { _ramp(280,220,0.10,'sawtooth',0.12); }

// ── Piece move animation ─────────────────────────────────────────────────────
function _animateMove(fromRow, fromCol, toRow, toCol, isFox, onDone) {
    if (_animLock) { onDone(); return; }
    _animLock = true;
    try {
        const board = document.getElementById('fahBoard');
        if (!board) { _animLock = false; onDone(); return; }
        const br = board.getBoundingClientRect();
        const cellW = br.width  / 8;
        const cellH = br.height / 8;
        const fx = br.left + fromCol * cellW + cellW * 0.14;
        const fy = br.top  + fromRow * cellH + cellH * 0.14;
        const tx = br.left + toCol   * cellW + cellW * 0.14;
        const ty = br.top  + toRow   * cellH + cellH * 0.14;
        const sz = cellW * 0.72;

        const el = document.createElement('div');
        el.className = 'piece-flying';
        el.textContent = isFox ? '🦊' : '🐕';
        el.style.cssText = `left:${fx}px;top:${fy}px;width:${sz}px;height:${sz}px;font-size:${sz*0.62}px;`;
        document.body.appendChild(el);

        const dur = 320;
        const start = performance.now();
        function frame(now) {
            const p = Math.min((now - start) / dur, 1);
            const e = p < 0.5 ? 2*p*p : -1+(4-2*p)*p;  // ease-in-out
            el.style.left = (fx + (tx-fx)*e) + 'px';
            el.style.top  = (fy + (ty-fy)*e - Math.sin(Math.PI*p)*cellH*0.5) + 'px';
            if (p < 1) requestAnimationFrame(frame);
            else { el.remove(); _animLock = false; onDone(); }
        }
        requestAnimationFrame(frame);
    } catch(err) { _animLock = false; onDone(); }
}

// ── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti() {
    const colors = ['#ef4444','#22c55e','#3b82f6','#f59e0b','#a855f7','#f97316'];
    for (let i = 0; i < 90; i++) {
        const el = document.createElement('div');
        el.className = 'fah-confetti';
        el.style.cssText =
            `left:${Math.random()*100}vw;top:-12px;` +
            `background:${colors[Math.floor(Math.random()*colors.length)]};` +
            `animation-duration:${1.4+Math.random()*1.4}s;animation-delay:${Math.random()*0.6}s;`;
        document.body.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────
function myRole() {
    if (!state) return null;
    const me = state.players.find(p => p.name === myName);
    return me ? me.role : null;
}

function isMyTurn() {
    if (!state || state.isOver) return false;
    return state.currentRole === myRole();
}

// ── Board renderer ────────────────────────────────────────────────────────────
function renderBoard() {
    if (!state) return;
    const board = document.getElementById('fahBoard');

    // Compute legal-move targets for currently selected piece
    const legalTargets = new Set();
    if (selectedPiece && isMyTurn()) {
        (state.legalMoves || []).forEach(m => {
            if (selectedPiece.type === 'fox' && m.role === 'Fox') {
                legalTargets.add(`${m.toRow},${m.toCol}`);
            } else if (selectedPiece.type === 'hound' && m.role === 'Hounds' && m.houndIndex === selectedPiece.houndIndex) {
                legalTargets.add(`${m.toRow},${m.toCol}`);
            }
        });
    }

    const lastFrom = state.lastMove ? `${state.lastMove.fromRow},${state.lastMove.fromCol}` : null;
    const lastTo   = state.lastMove ? `${state.lastMove.toRow},${state.lastMove.toCol}`   : null;

    // Build a fresh board or update existing cells
    if (board.children.length !== 64) {
        board.innerHTML = '';
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
                cell.id = `cell-${r}-${c}`;
                cell.className = 'fah-cell ' + ((r+c)%2===0 ? 'dark' : 'light');
                board.appendChild(cell);
            }
        }
    }

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const cell = document.getElementById(`cell-${r}-${c}`);
            const key = `${r},${c}`;
            cell.className = 'fah-cell ' + ((r+c)%2===0 ? 'dark' : 'light');

            // Last-move highlight
            if (key === lastFrom) cell.classList.add('last-from');
            if (key === lastTo)   cell.classList.add('last-to');

            // Legal-move target
            if (legalTargets.has(key)) cell.classList.add('legal-target');

            // Clear inner
            cell.innerHTML = '';

            const isFoxCell    = (r === state.foxRow && c === state.foxCol);
            const hound        = (state.hounds || []).find(h => h.row === r && h.col === c);

            if (isFoxCell) {
                const piece = document.createElement('div');
                piece.className = 'piece-fox';
                piece.textContent = '🦊';
                const canSelectFox = isMyTurn() && myRole() === 'Fox' && !state.isOver;
                if (canSelectFox) piece.classList.add('selectable');
                if (selectedPiece?.type === 'fox') {
                    piece.classList.remove('selectable');
                    piece.classList.add('selected');
                    cell.classList.add('selected-piece');
                }
                piece.addEventListener('click', e => { e.stopPropagation(); selectFox(); });
                cell.appendChild(piece);
            } else if (hound) {
                const piece = document.createElement('div');
                piece.className = 'piece-hound';
                piece.textContent = '🐕';
                const canSelectHound = isMyTurn() && myRole() === 'Hounds' && !state.isOver;
                const houndMoves = (state.legalMoves || []).filter(m => m.houndIndex === hound.index);
                if (canSelectHound && houndMoves.length > 0) piece.classList.add('selectable');
                if (selectedPiece?.type === 'hound' && selectedPiece.houndIndex === hound.index) {
                    piece.classList.remove('selectable');
                    piece.classList.add('selected');
                    cell.classList.add('selected-piece');
                }
                piece.addEventListener('click', e => { e.stopPropagation(); selectHound(hound.index, r, c); });
                cell.appendChild(piece);
            }

            // Cell click — place move
            if (legalTargets.has(key)) {
                cell.addEventListener('click', () => commitMove(r, c));
            }
        }
    }
}

function selectFox() {
    if (!isMyTurn() || myRole() !== 'Fox' || state.isOver) return;
    const newSel = selectedPiece?.type === 'fox' ? null : { type: 'fox', houndIndex: -1 };
    selectedPiece = newSel;
    if (newSel) sndSelect();
    renderBoard();
}

function selectHound(houndIndex, row, col) {
    if (!isMyTurn() || myRole() !== 'Hounds' || state.isOver) return;
    const houndMoves = (state.legalMoves || []).filter(m => m.houndIndex === houndIndex);
    if (houndMoves.length === 0) { sndIllegal(); return; }
    const newSel = (selectedPiece?.type === 'hound' && selectedPiece.houndIndex === houndIndex)
        ? null
        : { type: 'hound', houndIndex, row, col };
    selectedPiece = newSel;
    if (newSel) sndSelect();
    renderBoard();
}

function commitMove(toRow, toCol) {
    if (!selectedPiece || !isMyTurn() || state.isOver) return;
    let fromRow, fromCol, houndIndex = -1;
    if (selectedPiece.type === 'fox') {
        fromRow = state.foxRow; fromCol = state.foxCol;
    } else {
        fromRow = selectedPiece.row; fromCol = selectedPiece.col;
        houndIndex = selectedPiece.houndIndex;
    }
    selectedPiece = null;
    connection.invoke('FoxAndHoundsMove', roomId, fromRow, fromCol, toRow, toCol, houndIndex)
        .catch(e => console.error('Move error:', e));
}

// ── Status bar & player chips ─────────────────────────────────────────────────
function renderStatus() {
    if (!state) return;
    const el = document.getElementById('fahStatus');
    if (state.isOver) {
        if (state.winnerRole === myRole()) {
            el.textContent = '🏆 You win!';
            el.className = 'turn-indicator turn-win';
        } else {
            el.textContent = '😢 You lose!';
            el.className = 'turn-indicator turn-lose';
        }
    } else if (isMyTurn()) {
        el.textContent = `Your turn (${myRole()})`;
        el.className = 'turn-indicator your-turn';
    } else {
        const cur = state.players[state.currentPlayerIndex];
        el.textContent = `${cur?.name ?? '?'}\'s turn (${state.currentRole})`;
        el.className = 'turn-indicator';
    }
}

function renderPlayerBar() {
    if (!state) return;
    const bar = document.getElementById('fahPlayerBar');
    bar.innerHTML = '';
    state.players.forEach((p, i) => {
        const chip = document.createElement('div');
        chip.className = 'fah-player-chip' +
            (i === state.currentPlayerIndex && !state.isOver ? ' active' : '') +
            (p.name === myName ? ' is-me' : '');
        const icon = p.role === 'Fox' ? '🦊' : '🐕';
        const roleLabel = p.role === 'Fox' ? 'Fox' : 'Hounds (×4)';
        chip.innerHTML =
            `<span class="chip-icon">${icon}</span>` +
            `<span>${esc(p.name)}${p.isBot ? ' <small style="opacity:.65">BOT</small>' : ''}</span>` +
            `<span class="chip-role">${roleLabel}</span>`;
        bar.appendChild(chip);
    });
}

// ── Main update handler ───────────────────────────────────────────────────────
function onStateUpdate(newState) {
    const prevState = state;
    state = newState;

    // Detect if there was a move to animate
    let animPromise = null;
    if (prevState && newState.lastMove && !_animLock) {
        const lm = newState.lastMove;
        const isFox = lm.role === 'Fox';
        animPromise = new Promise(resolve => _animateMove(lm.fromRow, lm.fromCol, lm.toRow, lm.toCol, isFox, resolve));
        sndMove();
    }

    const doRender = () => {
        // Reset selection if it's no longer my turn or game is over
        if (!isMyTurn() || state.isOver) selectedPiece = null;
        renderBoard();
        renderStatus();
        renderPlayerBar();
        hideHint();

        // Your-turn notification
        if (prevState && !prevState.isOver && !state.isOver && isMyTurn() && prevState.currentPlayerIndex !== state.currentPlayerIndex) {
            sndYourTurn();
        }

        if (state.isOver && !_gameOverFired) {
            _gameOverFired = true;
            handleGameOver();
        }
    };

    if (animPromise) animPromise.then(doRender);
    else doRender();
}

function handleGameOver() {
    const won = state.winnerRole === myRole();
    setTimeout(() => {
        if (won) { sndWin(); launchConfetti(); }
        else sndLose();

        const overlay = document.getElementById('resultOverlay');
        const txt     = document.getElementById('resultText');
        const sub     = document.getElementById('resultSub');

        const foxPlayer    = state.players.find(p => p.role === 'Fox');
        const houndsPlayer = state.players.find(p => p.role === 'Hounds');

        if (won) {
            txt.textContent = '🏆 You Win!';
        } else {
            txt.textContent = '😢 You Lose!';
        }
        sub.textContent = `${state.winnerName ?? state.winnerRole} (${state.winnerRole}) wins! Fox: ${foxPlayer?.name ?? '?'} · Hounds: ${houndsPlayer?.name ?? '?'}`;

        overlay.style.display = 'flex';
        document.dispatchEvent(new Event('gameOver'));
    }, 900);
}

// ── Hint ──────────────────────────────────────────────────────────────────────
let _hintTimer = null;

function hideHint() {
    const el = document.getElementById('fahHintBanner');
    el.style.display = 'none';
    el.textContent = '';
    clearTimeout(_hintTimer);
}

connection.on('FoxAndHoundsHint', hint => {
    const el = document.getElementById('fahHintBanner');
    if (!hint.hintAvailable) {
        el.textContent = '💡 ' + hint.description;
        el.style.display = '';
        sndHint();
        clearTimeout(_hintTimer);
        _hintTimer = setTimeout(hideHint, 5000);
        return;
    }
    el.textContent = '💡 ' + hint.description;
    el.style.display = '';
    sndHint();

    // Highlight the suggested piece and target
    if (hint.move) {
        const m = hint.move;
        if (m.role === 'Fox') {
            selectedPiece = { type: 'fox', houndIndex: -1 };
        } else {
            const h = (state?.hounds || []).find(hh => hh.index === m.houndIndex);
            if (h) selectedPiece = { type: 'hound', houndIndex: m.houndIndex, row: h.row, col: h.col };
        }
        renderBoard();
    }

    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => {
        hideHint();
        selectedPiece = null;
        if (state) renderBoard();
    }, 5000);
});

// ── SignalR & init ────────────────────────────────────────────────────────────
connection.on('FoxAndHoundsUpdated', onStateUpdate);

connection.on('PlayerLeft', name => {
    document.getElementById('fahStatus').textContent = `${esc(name)} left the game`;
});

async function init() {
    const me = await fetch('/api/me').then(r => r.json());
    myName = me.name;

    // Navbar avatar
    document.getElementById('navbarUsername').textContent = me.name;
    if (me.avatar) {
        document.getElementById('navbarAvatarEmoji').textContent = me.avatar;
        document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
        document.getElementById('navbarAvatarImg').style.display = 'none';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    } else if (me.name) {
        document.getElementById('navbarAvatarImg').src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(me.name) + '&background=12919E&color=fff';
        document.getElementById('navbarAvatarImg').style.display = 'inline-block';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    }

    await connection.start();
    await connection.invoke('RejoinFoxAndHoundsRoom', roomId);

    document.getElementById('fahHintBtn').addEventListener('click', () => {
        connection.invoke('RequestFoxAndHoundsHint', roomId);
    });

    document.getElementById('fahRulesBtn').addEventListener('click', () => {
        document.getElementById('fahRulesModal').style.display = 'flex';
    });
    document.getElementById('fahRulesClose').addEventListener('click', () => {
        document.getElementById('fahRulesModal').style.display = 'none';
    });
    document.getElementById('fahRulesModal').addEventListener('click', e => {
        if (e.target === e.currentTarget)
            document.getElementById('fahRulesModal').style.display = 'none';
    });

    const backFn = () => {
        connection.invoke('LeaveFoxAndHoundsGame', roomId).catch(() => {}).finally(() => { window.location.href = '/lobby'; });
    };
    document.getElementById('fahBackBtn').addEventListener('click', backFn);
    document.getElementById('hamBackBtn').addEventListener('click', backFn);

    document.getElementById('backToLobby').addEventListener('click', backFn);
    document.getElementById('playAgainBtn').addEventListener('click', () => {
        if (isSinglePlayer) {
            document.getElementById('resultOverlay').style.display = 'none';
            _gameOverFired = false;
            connection.invoke('StartFoxAndHoundsSinglePlayer', 'medium').catch(e => console.error(e));
        } else {
            window.location.href = '/fox-and-hounds-room';
        }
    });
}

connection.on('FoxAndHoundsSinglePlayerStarted', newRoomId => {
    roomId = newRoomId;
    sessionStorage.setItem('foxAndHoundsRoomId', newRoomId);
});

connection.on('FoxAndHoundsRoomUpdated', () => {
    if (state?.isOver) window.location.href = '/fox-and-hounds-room';
});

init();
