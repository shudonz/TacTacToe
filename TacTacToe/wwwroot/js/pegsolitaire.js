const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
const roomId = sessionStorage.getItem('pegSolitaireRoomId');
const isSinglePlayer = sessionStorage.getItem('isSinglePlayer') === '1';
if (!roomId) {
    window.location.replace('/lobby');
    throw new Error('Missing Peg Solitaire room id');
}

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

let myName = '';
let roomState = null;
let myPlayer = null;
let selectedFrom = -1;
let _gameOverEventFired = false;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function validDestinations(game, fromIdx) {
    if (!game?.pegs || fromIdx < 0) return [];
    return MOVE_TRIPLES
        .filter(m => m.from === fromIdx && game.pegs[m.from] && game.pegs[m.over] && !game.pegs[m.to])
        .map(m => m.to);
}

function renderBoard() {
    if (!myPlayer?.game) return;
    const game = myPlayer.game;
    const board = document.getElementById('pegsolBoard');
    const validTo = new Set(validDestinations(game, selectedFrom));
    board.innerHTML = '';

    TRI_ROWS.forEach(row => {
        const rowEl = document.createElement('div');
        rowEl.className = 'pegsol-row';
        row.forEach(idx => {
            const hole = document.createElement('button');
            hole.className = 'pegsol-hole';
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
}

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

function render(room) {
    roomState = room;
    myPlayer = room.players.find(p => p.name === myName);
    if (!myPlayer) return;

    const game = myPlayer.game;
    if (selectedFrom >= 0 && !game.pegs[selectedFrom]) selectedFrom = -1;

    document.getElementById('pegsolScore').textContent = `Score: ${myPlayer.score}`;
    document.getElementById('pegsolPegs').textContent = `Pegs Left: ${myPlayer.pegsLeft}`;
    document.getElementById('pegsolRating').textContent = `Rating: ${myPlayer.rating || 'Try Again'}`;
    document.getElementById('pegsolMoves').textContent = `Moves: ${game.moveCount}`;

    const status = room.isOver
        ? 'Game finished'
        : myPlayer.hasFinished
            ? `Finished: ${myPlayer.rating || 'Try Again'}`
            : 'Select a peg, then a valid empty hole';
    document.getElementById('pegsolStatus').textContent = status;

    renderBoard();
    renderLeaderboard(room);

    if (room.isOver) showResults(room);
}

function onHoleClick(idx) {
    if (!myPlayer?.game || roomState?.isOver || myPlayer.hasFinished) return;
    const game = myPlayer.game;

    if (selectedFrom < 0) {
        if (game.pegs[idx]) selectedFrom = idx;
        renderBoard();
        return;
    }

    if (idx === selectedFrom) {
        selectedFrom = -1;
        renderBoard();
        return;
    }

    if (game.pegs[idx]) {
        selectedFrom = idx;
        renderBoard();
        return;
    }

    const validTo = validDestinations(game, selectedFrom);
    if (validTo.includes(idx)) {
        const from = selectedFrom;
        selectedFrom = -1;
        connection.invoke('MakePegSolitaireMove', roomId, from, idx).catch(err => console.error('Move failed:', err));
        return;
    }

    selectedFrom = -1;
    renderBoard();
}

function showResults(room) {
    const me = room.players.find(p => p.name === myName);
    if (!me) return;

    document.getElementById('resultText').textContent = me.rating || 'Try Again';
    document.getElementById('resultStats').innerHTML =
        `<div>Score: <strong>${me.score}</strong> points</div>` +
        `<div>Pegs Left: <strong>${me.pegsLeft}</strong></div>` +
        `<div>Moves: <strong>${me.game?.moveCount ?? 0}</strong></div>`;

    document.getElementById('resultOverlay').style.display = 'flex';
    if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event('gameOver')); }
}

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
