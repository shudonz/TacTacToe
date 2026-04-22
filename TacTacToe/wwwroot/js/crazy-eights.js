const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
const roomId = sessionStorage.getItem('crazyEightsRoomId');
if (!roomId) {
    window.location.replace('/lobby');
    throw new Error('Missing Crazy Eights room id');
}

const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];
const SUIT_NAMES = ['Spades','Hearts','Diamonds','Clubs'];
const SUIT_CLASS = ['black','red','red','black'];

let myName = sessionStorage.getItem('myName') || '';
let state = null;
let _prevState = null;
let _ac = null;
let _gameOverFired = false;
let _toastTimer = null;

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function rank(card) { return card % 13; }
function suit(card) { return Math.floor(card / 13); }

function cardHtml(cardId, extraClass = '') {
    const r = rank(cardId), s = suit(cardId);
    const rc = SUIT_CLASS[s];
    const centerHtml = buildCardCenter(r, RANKS[r], SUITS[s], s);
    return `<div class="sol-card ${rc} ${extraClass}"><div class="sol-card-tl">${RANKS[r]}<br>${SUITS[s]}</div>${centerHtml}<div class="sol-card-br">${RANKS[r]}<br>${SUITS[s]}</div></div>`;
}

// Face-card emoji indexed by [rankOffset][suitIdx]
// rankOffset: 0=Jack, 1=Queen, 2=King  |  suitIdx: 0=♠ 1=♥ 2=♦ 3=♣
const FACE_EMOJI = [
    ['\uD83C\uDC2B', '\uD83C\uDC3B', '\uD83C\uDC4B', '\uD83C\uDC5B'], // Jack
    ['\uD83C\uDC2D', '\uD83C\uDC3D', '\uD83C\uDC4D', '\uD83C\uDC5D'], // Queen
    ['\uD83C\uDC2E', '\uD83C\uDC3E', '\uD83C\uDC4E', '\uD83C\uDC5E']  // King
];

function buildCardCenter(rankIdx, rankText, suitText, suitIdx = 0) {
    const pipRows = {
        0: [1],
        1: [1, 1],
        2: [1, 1, 1],
        3: [2, 2],
        4: [2, 1, 2],
        5: [2, 2, 2],
        6: [2, 1, 2, 2],
        7: [2, 2, 2, 2],
        8: [2, 2, 1, 2, 2],
        9: [2, 2, 2, 2, 2]
    }[rankIdx];

    if (!pipRows) {
        const faceOffset = rankIdx - 10; // 10=J, 11=Q, 12=K
        const emoji = FACE_EMOJI[faceOffset]?.[suitIdx] ?? rankText;
        return `<div class="sol-card-center sol-card-face-rank"><div class="sol-card-face-emoji">${emoji}</div></div>`;
    }

    const rowsHtml = pipRows.map(count => {
        const row = Array.from({ length: count }, () => `<span class="sol-card-pip">${suitText}</span>`).join('');
        return `<div class="sol-card-pip-row">${row}</div>`;
    }).join('');
    return `<div class="sol-card-center sol-card-pips">${rowsHtml}</div>`;
}

function cardBackHtml() {
    return '<div class="sol-card sol-card-back ce-card-back"></div>';
}

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
function sndPlay() {
    tone(523, 0.07, 0.12);
    tone(784, 0.08, 0.10, 'sine', 0.07);
}
function sndDraw() {
    tone(330, 0.05, 0.09);
    tone(262, 0.07, 0.07, 'sine', 0.05);
}
function sndPass() {
    tone(440, 0.06, 0.07);
    tone(392, 0.07, 0.06, 'sine', 0.06);
}
function sndTurnStart() {
    tone(523, 0.06, 0.08);
    tone(659, 0.06, 0.08, 'sine', 0.07);
    tone(784, 0.10, 0.10, 'sine', 0.14);
}
function sndLastCard() {
    tone(880, 0.08, 0.13);
    tone(1047, 0.10, 0.12, 'sine', 0.09);
    tone(1319, 0.14, 0.11, 'sine', 0.20);
}
function sndHint() { tone(980, 0.06, 0.07); tone(1300, 0.06, 0.05, 'sine', 0.07); }
function sndWin() { [523,659,784,1047].forEach((f,i) => setTimeout(() => tone(f, 0.22, 0.13), i * 100)); }
function sndEight() {
    [523,622,740,988].forEach((f,i) => tone(f, 0.09, 0.10, 'sine', i * 0.08));
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function launchConfetti(count = 90) {
    const colors = ['#12919E','#C4E7E9','#fbbf24','#f472b6','#7c6aff','#36d6c3'];
    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'ce-confetti';
            el.style.left = (Math.random() * 100) + '%';
            el.style.background = colors[i % colors.length];
            el.style.animationDuration = (1.5 + Math.random() * 1.8) + 's';
            document.body.appendChild(el);
            setTimeout(() => el.remove(), 3600);
        }, i * 22);
    }
}

function launchMiniConfetti() {
    const colors = ['#fbbf24','#f472b6','#36d6c3','#7c6aff'];
    for (let i = 0; i < 18; i++) {
        const el = document.createElement('div');
        el.className = 'ce-confetti ce-confetti-mini';
        el.style.left = (30 + Math.random() * 40) + '%';
        el.style.background = colors[i % colors.length];
        el.style.animationDuration = (0.8 + Math.random() * 0.8) + 's';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1800);
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, extra = '') {
    const el = document.getElementById('ceToast');
    el.className = 'ce-toast ce-toast-show' + (extra ? ' ' + extra : '');
    el.textContent = msg;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.className = 'ce-toast'; }, 2200);
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderPlayers() {
    const wrap = document.getElementById('cePlayers');
    wrap.innerHTML = '';
    if (!state) return;
    fetchAvatars(state.players.map(p => p.name));
    state.players.forEach((p, idx) => {
        const el = document.createElement('div');
        el.className = 'player-bar-item' + (idx === state.currentPlayerIndex && !state.isOver ? ' active' : '') + (p.name === myName ? ' is-me' : '');
        el.innerHTML = avatarHtml(p.name, 'sm') +
            '<span class="room-player-name">' + esc(p.name) + (p.isBot ? ' 🤖' : '') + '</span>' +
            '<span class="player-score">' + p.cardCount + ' cards</span>';
        wrap.appendChild(el);
    });
}

function renderStatus() {
    const el = document.getElementById('ceStatus');
    if (!state) { el.textContent = 'Loading...'; return; }
    if (state.isOver) {
        el.textContent = state.winnerName === myName ? 'You win! 🎉' : (state.winnerName ? `${state.winnerName} wins!` : 'Game over');
        return;
    }
    const cur = state.players[state.currentPlayerIndex];
    el.textContent = cur?.name === myName ? 'Your turn' : `${cur?.name || 'Player'}'s turn`;
}

function renderPile() {
    if (!state) return;
    const draw = document.getElementById('ceDrawPile');
    const drawCount = document.getElementById('ceDrawCount');
    const discard = document.getElementById('ceDiscard');
    const activeSuit = document.getElementById('ceActiveSuit');

    draw.innerHTML = state.drawCount > 0 ? cardBackHtml() : '<div class="ce-empty">Empty</div>';
    drawCount.textContent = `${state.drawCount} left`;

    const topChanged = !_prevState || _prevState.topCard !== state.topCard;
    discard.innerHTML = state.topCard >= 0 ? cardHtml(state.topCard, topChanged ? 'ce-discard-card' : '') : '<div class="ce-empty">—</div>';

    const si = state.activeSuit;
    if (si >= 0 && si < 4) {
        activeSuit.className = `ce-active-suit ${SUIT_CLASS[si]}`;
        activeSuit.innerHTML = `<div class="ce-active-suit-sym">${SUITS[si]}</div><div class="ce-active-suit-name">${SUIT_NAMES[si]}</div>`;
    }
}

function renderHand() {
    const handEl = document.getElementById('ceMyHand');
    handEl.innerHTML = '';
    if (!state) return;

    const legal = new Map((state.legalMoves || []).map(m => [m.cardId, m]));
    const myTurn = state.players[state.currentPlayerIndex]?.name === myName && !state.isOver;
    const justMyTurn = myTurn && (!_prevState || _prevState.players[_prevState.currentPlayerIndex]?.name !== myName);

    state.myHand.forEach((cardId, i) => {
        const wrap = document.createElement('button');
        const move = legal.get(cardId);
        const valid = !!move;
        wrap.type = 'button';
        wrap.className = 'ce-card-btn' + (valid && myTurn ? ' ce-valid' : '');
        if (justMyTurn && valid) wrap.style.animationDelay = `${i * 40}ms`;
        wrap.innerHTML = cardHtml(cardId);
        if (myTurn && valid) {
            wrap.onclick = () => playCard(cardId, move.requiresSuitChoice);
        } else {
            wrap.disabled = true;
        }
        handEl.appendChild(wrap);
    });
}

function renderActions() {
    if (!state) return;
    const myTurn = state.players[state.currentPlayerIndex]?.name === myName && !state.isOver;
    const mustDraw = myTurn && state.canDraw && (!state.legalMoves || state.legalMoves.length === 0) && !state.canPass;
    const draw = document.getElementById('ceDrawPile');
    draw.disabled = !(myTurn && state.canDraw);
    draw.classList.toggle('ce-draw-glow', mustDraw);

    const passBtn = document.getElementById('cePassBtn');
    passBtn.style.display = (myTurn && state.canPass) ? '' : 'none';
    document.getElementById('ceHintBtn').disabled = !myTurn;
}

function checkSideEffects() {
    if (!state || !_prevState) return;

    const myTurn = state.players[state.currentPlayerIndex]?.name === myName && !state.isOver;
    const wasMine = _prevState.players[_prevState.currentPlayerIndex]?.name === myName;

    // Turn-start toast & jingle
    if (myTurn && !wasMine && !state.isOver) {
        audioCtx()?.resume();
        sndTurnStart();
        showToast('🎴 Your turn!', 'ce-toast-turn');
    }

    // "Last card!" warning
    state.players.forEach((p, idx) => {
        const prev = _prevState.players[idx];
        if (prev && prev.cardCount > 1 && p.cardCount === 1) {
            setTimeout(() => {
                sndLastCard();
                showToast(p.name === myName ? '🃏 Last card!' : `🃏 ${p.name} has 1 card!`, 'ce-toast-lastcard');
            }, 400);
        }
    });

    // Mini confetti when you play a card
    const myPrev = _prevState.players.find(p => p.name === myName);
    const myCur = state.players.find(p => p.name === myName);
    if (myPrev && myCur && myCur.cardCount < myPrev.cardCount) {
        setTimeout(launchMiniConfetti, 250);
    }

    // Crazy 8 sound
    if (state.topCard !== _prevState.topCard && state.topCard >= 0 && rank(state.topCard) === 7) {
        setTimeout(sndEight, 120);
    }
}

function render() {
    if (!state) return;
    renderPlayers();
    renderStatus();
    renderPile();
    renderHand();
    renderActions();
    checkSideEffects();
    _prevState = state;

    if (state.isOver) {
        document.getElementById('resultText').textContent = state.winnerName === myName ? 'You won Crazy Eights! 🎉' : (state.winnerName ? `${state.winnerName} wins!` : 'Game over');
        document.getElementById('resultOverlay').style.display = 'flex';
        if (!_gameOverFired) {
            _gameOverFired = true;
            if (state.winnerName === myName) { sndWin(); launchConfetti(); }
            document.dispatchEvent(new Event('gameOver'));
        }
    }
}

function showHint(msg) {
    const el = document.getElementById('ceHintBanner');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function chooseSuitAndPlay(cardId) {
    const modal = document.getElementById('ceSuitModal');
    const choices = document.getElementById('ceSuitChoices');
    choices.innerHTML = '';
    SUITS.forEach((sym, idx) => {
        const btn = document.createElement('button');
        btn.className = `btn ce-suit-btn ${SUIT_CLASS[idx]}`;
        btn.textContent = `${sym} ${SUIT_NAMES[idx]}`;
        btn.onclick = () => {
            modal.style.display = 'none';
            sndPlay();
            connection.invoke('PlayCrazyEightsCard', roomId, cardId, idx);
        };
        choices.appendChild(btn);
    });
    modal.style.display = 'flex';
}

function playCard(cardId, requiresSuitChoice) {
    audioCtx()?.resume();
    if (requiresSuitChoice) {
        chooseSuitAndPlay(cardId);
        return;
    }
    sndPlay();
    connection.invoke('PlayCrazyEightsCard', roomId, cardId, null);
}

function backToLobby() {
    connection.invoke('LeaveCrazyEightsGame', roomId).finally(() => {
        window.location.href = '/lobby';
    });
}

async function init() {
    if (!myName) {
        const me = await fetch('/api/me').then(r => r.json());
        myName = me.name;
    }

    connection.on('CrazyEightsUpdated', s => {
        state = s;
        render();
    });

    connection.on('CrazyEightsHint', hint => {
        sndHint();
        if (!hint || !hint.hintAvailable) {
            showHint('No legal move available.');
            return;
        }
        if (hint.shouldDraw) {
            showHint('Hint: Draw one card.');
            return;
        }
        const suitText = hint.suggestedSuit >= 0 ? ` and call ${SUIT_NAMES[hint.suggestedSuit]}` : '';
        showHint(`Hint: Play ${RANKS[rank(hint.cardId)]}${SUITS[suit(hint.cardId)]}${suitText}.`);
    });

    connection.on('PlayerLeft', name => {
        showHint(`${name} left the game.`);
    });

    await connection.start();
    await connection.invoke('RejoinCrazyEightsRoom', roomId);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ceDrawPile').addEventListener('click', () => {
        if (document.getElementById('ceDrawPile').disabled) return;
        audioCtx()?.resume(); sndDraw();
        connection.invoke('DrawCrazyEightsCard', roomId);
    });
    document.getElementById('cePassBtn').addEventListener('click', () => {
        audioCtx()?.resume(); sndPass();
        connection.invoke('DrawCrazyEightsCard', roomId);
    });
    document.getElementById('ceHintBtn').addEventListener('click', () => {
        audioCtx()?.resume();
        connection.invoke('RequestCrazyEightsHint', roomId);
    });
    document.getElementById('ceBackBtn').addEventListener('click', backToLobby);
    document.getElementById('backToLobby').addEventListener('click', backToLobby);
    document.getElementById('hamBackBtn').addEventListener('click', backToLobby);
    document.getElementById('ceSuitCancel').addEventListener('click', () => {
        document.getElementById('ceSuitModal').style.display = 'none';
    });
});

init();
