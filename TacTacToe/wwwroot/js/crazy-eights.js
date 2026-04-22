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
let _ac = null;
let _gameOverFired = false;

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function rank(card) {
    return card % 13;
}

function suit(card) {
    return Math.floor(card / 13);
}

function cardHtml(cardId, extraClass = '') {
    const r = rank(cardId), s = suit(cardId);
    const rc = SUIT_CLASS[s];
    return `<div class="sol-card ${rc} ${extraClass}"><div class="sol-card-tl">${RANKS[r]}<br>${SUITS[s]}</div><div class="sol-card-center">${SUITS[s]}</div><div class="sol-card-br">${RANKS[r]}<br>${SUITS[s]}</div></div>`;
}

function cardBackHtml() {
    return '<div class="sol-card sol-card-back ce-card-back"></div>';
}

function audioCtx(){ if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} } return _ac; }
function tone(freq, dur = 0.1, vol = 0.08) {
    const ac = audioCtx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.connect(g); g.connect(ac.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
}
function sndPlay(){ tone(740, 0.08, 0.1); tone(520, 0.09, 0.07); }
function sndDraw(){ tone(300, 0.06, 0.08); }
function sndHint(){ tone(980, 0.06, 0.07); tone(1300, 0.06, 0.05); }
function sndWin(){ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,0.22,0.13), i*100)); }

function launchConfetti() {
    const colors = ['#12919E','#C4E7E9','#fbbf24','#f472b6','#7c6aff','#36d6c3'];
    for (let i = 0; i < 90; i++) {
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

    draw.innerHTML = state.drawCount > 0 ? cardBackHtml() : '<div class="ce-empty">Empty</div>';
    drawCount.textContent = `${state.drawCount} left`;
    discard.innerHTML = state.topCard >= 0 ? cardHtml(state.topCard, 'ce-discard-card') : '<div class="ce-empty">—</div>';
    document.getElementById('ceSuitText').textContent = `Active suit: ${SUIT_NAMES[state.activeSuit]} ${SUITS[state.activeSuit]}`;
}

function renderHand() {
    const handEl = document.getElementById('ceMyHand');
    handEl.innerHTML = '';
    if (!state) return;

    const legal = new Map((state.legalMoves || []).map(m => [m.cardId, m]));
    const myTurn = state.players[state.currentPlayerIndex]?.name === myName && !state.isOver;

    state.myHand.forEach(cardId => {
        const wrap = document.createElement('button');
        const move = legal.get(cardId);
        const valid = !!move;
        wrap.type = 'button';
        wrap.className = 'ce-card-btn' + (valid ? ' ce-valid' : '');
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
    document.getElementById('ceDrawBtn').disabled = !(myTurn && state.canDraw);
    document.getElementById('cePassBtn').disabled = !(myTurn && state.canPass);
    document.getElementById('ceHintBtn').disabled = !myTurn;
    document.getElementById('ceDrawPile').disabled = !(myTurn && state.canDraw);
}

function render() {
    if (!state) return;
    renderPlayers();
    renderStatus();
    renderPile();
    renderHand();
    renderActions();

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
        btn.className = 'btn ce-suit-btn';
        btn.textContent = `${SUIT_NAMES[idx]} ${sym}`;
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
    document.getElementById('ceDrawBtn').addEventListener('click', () => {
        audioCtx()?.resume(); sndDraw();
        connection.invoke('DrawCrazyEightsCard', roomId);
    });
    document.getElementById('ceDrawPile').addEventListener('click', () => {
        if (document.getElementById('ceDrawPile').disabled) return;
        audioCtx()?.resume(); sndDraw();
        connection.invoke('DrawCrazyEightsCard', roomId);
    });
    document.getElementById('cePassBtn').addEventListener('click', () => {
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
