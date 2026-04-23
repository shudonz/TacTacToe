// ── Constants ────────────────────────────────────────────────────────────────
const SIZE = 10;
const SHIPS = [
    { key: 'boaty',      name: 'Boaty McBoatface', size: 5 },
    { key: 'partybarge', name: 'Party Barge',       size: 4 },
    { key: 'pontoon',    name: 'Pontoon',            size: 3 },
    { key: 'kayak',      name: 'Kayak',              size: 3 },
    { key: 'ducky',      name: 'Rubber Ducky',       size: 2 }
];

const mode = new URLSearchParams(window.location.search).get('mode') === 'duel' ? 'duel' : 'solo';

// ── Global state ─────────────────────────────────────────────────────────────
const state = {
    phase: 'placement',   // 'placement' | 'battle'
    current: 0,           // whose turn it is (battle phase)
    gameOver: false,
    players: [],          // populated during placement / start
    placingPlayer: 0,     // which player is currently placing ships (placement phase)
    placement: {          // placement-phase bookkeeping
        board: null,      // working board for current player
        fleet: [],        // placed fleet entries so far
        horizontal: true,
        shipIndex: 0,     // index into SHIPS array
        hoverCells: []    // last preview highlight cells
    }
};

// ── Audio ─────────────────────────────────────────────────────────────────────
const ac = new (window.AudioContext || window.webkitAudioContext)();
function tone(freq, dur = 0.12, vol = 0.18, type = 'sine') {
    if (ac.state === 'suspended') ac.resume();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.stop(ac.currentTime + dur + 0.03);
}
const sfx = {
    place: () => { tone(440, 0.08, 0.14); },
    miss:  () => { tone(280, 0.16, 0.20, 'triangle'); },
    hit:   () => { tone(580, 0.08, 0.22); tone(780, 0.11, 0.15); },
    sink:  () => { [420, 360, 280, 180].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.23, 'sawtooth'), i * 95)); },
    win:   () => { [524, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.20, 0.24), i * 120)); }
};

// ── Confetti ──────────────────────────────────────────────────────────────────
function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1300;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const colors = ['#7c6aff', '#ff5c8a', '#36d6c3', '#ffd166', '#47d4ff', '#ff8a47'];
    const parts = Array.from({ length: 220 }, () => ({
        x: innerWidth / 2, y: innerHeight * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 12 - 3,
        g:  0.18 + Math.random() * 0.04,
        s:  3 + Math.random() * 5,
        c:  colors[(Math.random() * colors.length) | 0],
        a:  1
    }));
    let frame = 0;
    (function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of parts) {
            p.vy += p.g; p.x += p.vx; p.y += p.vy; p.a -= 0.004;
            if (p.a <= 0) continue;
            ctx.globalAlpha = p.a;
            ctx.fillStyle = p.c;
            ctx.fillRect(p.x, p.y, p.s, p.s * 0.7);
        }
        frame++;
        if (frame < 280) requestAnimationFrame(draw);
        else canvas.remove();
    })();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function coord(r, c) { return `${r},${c}`; }

function emptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function canPlace(board, r, c, size, horizontal) {
    for (let i = 0; i < size; i++) {
        const rr = r + (horizontal ? 0 : i);
        const cc = c + (horizontal ? i : 0);
        if (rr >= SIZE || cc >= SIZE || board[rr][cc]) return false;
    }
    return true;
}

function randomFleet(board) {
    const fleet = [];
    for (const ship of SHIPS) {
        let placed = false;
        while (!placed) {
            const horizontal = Math.random() > 0.5;
            const r = rand(0, SIZE - 1);
            const c = rand(0, SIZE - 1);
            if (!canPlace(board, r, c, ship.size, horizontal)) continue;
            const cells = [];
            for (let i = 0; i < ship.size; i++) {
                const rr = r + (horizontal ? 0 : i);
                const cc = c + (horizontal ? i : 0);
                board[rr][cc] = ship.key;
                cells.push([rr, cc]);
            }
            fleet.push({ ...ship, cells, hits: 0, sunk: false });
            placed = true;
        }
    }
    return fleet;
}

// ── Placement phase ───────────────────────────────────────────────────────────
function startPlacement(playerIndex) {
    state.phase = 'placement';
    state.placingPlayer = playerIndex;
    const p = state.placement;
    p.board     = emptyBoard();
    p.fleet     = [];
    p.horizontal = true;
    p.shipIndex  = 0;
    p.hoverCells = [];

    const name = playerIndex === 0 ? state.players[0].name : state.players[1].name;
    document.getElementById('placementBar').classList.add('visible');
    document.getElementById('status').textContent = `${name}: click your grid to position each ship.`;
    document.getElementById('orientBtn').textContent = '↔ Horizontal';
    document.getElementById('confirmPlaceBtn').disabled = true;
    document.getElementById('winOverlay').style.display = 'none';

    // Hide target panel during placement
    document.getElementById('p1Target').innerHTML = '';
    document.getElementById('p1Fleet').innerHTML = '';
    document.getElementById('p1Title').textContent = '';

    renderPlacementQueue();
    renderPlacementBoard();
}

function renderPlacementQueue() {
    const p = state.placement;
    const el = document.getElementById('placementShipQueue');
    el.innerHTML = SHIPS.map((s, i) => {
        let cls = 'bb-ship-tag';
        if (i < p.shipIndex) cls += ' placed';
        else if (i === p.shipIndex) cls += ' active';
        return `<span class="${cls}">${s.name} (${s.size})</span>`;
    }).join('');

    // Update placement bar title to show which ship is next
    if (p.shipIndex < SHIPS.length) {
        const next = SHIPS[p.shipIndex];
        const orient = p.horizontal ? 'horizontal' : 'vertical';
        document.getElementById('placementBarTitle').textContent =
            `${state.players[state.placingPlayer].name} — place your ${next.name} (${next.size} cells, ${orient})`;
    } else {
        document.getElementById('placementBarTitle').textContent =
            `${state.players[state.placingPlayer].name} — all ships placed!`;
    }
}

function renderPlacementBoard() {
    const p    = state.placement;
    const el   = document.getElementById('p0Own');
    el.innerHTML = '';

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            cell.disabled = false;          // always interactive during placement
            const key = p.board[r][c];
            if (key) cell.classList.add('ship');

            cell.addEventListener('mouseover', () => onPlacementHover(r, c));
            cell.addEventListener('click',     () => onPlacementClick(r, c));
            el.appendChild(cell);
        }
    }

    // Fleet list sidebar
    document.getElementById('p0Fleet').innerHTML = SHIPS.map((s, i) => {
        if (i >= p.shipIndex) return '';
        return `<div class="bb-fleet-item"><span>${s.name} (${s.size})</span><strong>✓ Placed</strong></div>`;
    }).join('');
    document.getElementById('p0Title').textContent = state.players[state.placingPlayer].name;
}

function previewCellsFor(r, c) {
    const { horizontal, shipIndex } = state.placement;
    if (shipIndex >= SHIPS.length) return [];
    const size = SHIPS[shipIndex].size;
    const cells = [];
    for (let i = 0; i < size; i++) {
        cells.push([r + (horizontal ? 0 : i), c + (horizontal ? i : 0)]);
    }
    return cells;
}

function onPlacementHover(r, c) {
    const p = state.placement;
    if (p.shipIndex >= SHIPS.length) return;

    // Clear old preview
    const el = document.getElementById('p0Own');
    const allCells = el.querySelectorAll('.bb-cell');
    allCells.forEach(c => { c.classList.remove('preview', 'preview-bad'); });

    const preview = previewCellsFor(r, c);
    const valid   = canPlace(p.board, r, c, SHIPS[p.shipIndex].size, p.horizontal);
    preview.forEach(([pr, pc]) => {
        if (pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE) {
            const idx = pr * SIZE + pc;
            allCells[idx].classList.add(valid ? 'preview' : 'preview-bad');
        }
    });
    p.hoverCells = preview;
}

function onPlacementClick(r, c) {
    const p = state.placement;
    if (p.shipIndex >= SHIPS.length) return;

    const ship = SHIPS[p.shipIndex];
    if (!canPlace(p.board, r, c, ship.size, p.horizontal)) return;

    const cells = [];
    for (let i = 0; i < ship.size; i++) {
        const rr = r + (p.horizontal ? 0 : i);
        const cc = c + (p.horizontal ? i : 0);
        p.board[rr][cc] = ship.key;
        cells.push([rr, cc]);
    }
    p.fleet.push({ ...ship, cells, hits: 0, sunk: false });
    p.shipIndex++;
    sfx.place();

    renderPlacementQueue();
    renderPlacementBoard();

    if (p.shipIndex >= SHIPS.length) {
        document.getElementById('confirmPlaceBtn').disabled = false;
        document.getElementById('status').textContent =
            'All ships placed! Confirm your fleet, or Randomize / Reset to redo.';
    } else {
        const next = SHIPS[p.shipIndex];
        document.getElementById('status').textContent =
            `${ship.name} placed ✓  Next: ${next.name} (${next.size} cells)`;
    }
}

function doRandomize() {
    const p = state.placement;
    p.board     = emptyBoard();
    p.fleet     = [];
    p.shipIndex = SHIPS.length;   // mark all as placed
    randomFleet(p.board);
    // Rebuild fleet metadata from board
    p.fleet = SHIPS.map(s => {
        const cells = [];
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (p.board[r][c] === s.key) cells.push([r, c]);
        return { ...s, cells, hits: 0, sunk: false };
    });
    renderPlacementQueue();
    renderPlacementBoard();
    document.getElementById('confirmPlaceBtn').disabled = false;
    document.getElementById('status').textContent = 'Fleet randomized! Confirm or re-randomize.';
}

function doReset() {
    const p = state.placement;
    p.board      = emptyBoard();
    p.fleet      = [];
    p.shipIndex  = 0;
    p.hoverCells = [];
    document.getElementById('confirmPlaceBtn').disabled = true;
    renderPlacementQueue();
    renderPlacementBoard();
    const name = state.players[state.placingPlayer].name;
    document.getElementById('status').textContent = `${name}: click your grid to position each ship.`;
}

function confirmPlacement() {
    const p = state.placement;
    if (p.shipIndex < SHIPS.length) return;

    // Store the placed fleet into the player object
    const player = state.players[state.placingPlayer];
    player.board = p.board;
    player.fleet = p.fleet;

    if (mode === 'duel' && state.placingPlayer === 0) {
        // Show hand-off overlay for Player 2
        document.getElementById('passTitle').textContent = '🔄 Pass to Player 2';
        document.getElementById('passMsg').textContent   =
            'Hand the device to Player 2. Do not let Player 1 see!';
        document.getElementById('passOverlay').style.display = 'flex';
        // When player 2 clicks ready, start their placement
        document.getElementById('passReadyBtn').onclick = () => {
            document.getElementById('passOverlay').style.display = 'none';
            startPlacement(1);
        };
    } else {
        // Solo: computer already has a fleet; or Duel: both placed → start battle
        beginBattle();
    }
}

// ── Battle phase ──────────────────────────────────────────────────────────────
function beginBattle() {
    state.phase   = 'battle';
    state.current = 0;
    state.gameOver = false;
    state.battleStartedAt = Date.now();

    // Clear placement UI
    document.getElementById('placementBar').classList.remove('visible');

    document.getElementById('p0Title').textContent = state.players[0].name;
    document.getElementById('p1Title').textContent = state.players[1].name;

    if (mode === 'duel') {
        // Show hand-off to player 1 for battle start
        document.getElementById('passTitle').textContent = '⚓ Battle begins!';
        document.getElementById('passMsg').textContent =
            `Pass to ${state.players[0].name} — it's your turn to fire first.`;
        document.getElementById('passOverlay').style.display = 'flex';
        document.getElementById('passReadyBtn').onclick = () => {
            document.getElementById('passOverlay').style.display = 'none';
            render();
        };
    } else {
        render();
    }
    logMsg('All ships deployed. Fire at will! 🎯');
}

// ── New match entry point ─────────────────────────────────────────────────────
function startGame() {
    state.phase    = 'placement';
    state.current  = 0;
    state.gameOver = false;
    state.placingPlayer = 0;

    const meName = sessionStorage.getItem('userName') || 'Player 1';

    if (mode === 'solo') {
        // Pre-build both players; computer fleet is random (invisible to human)
        const computerBoard = emptyBoard();
        const computerFleet = randomFleet(computerBoard);
        state.players = [
            { name: meName,        board: emptyBoard(), shots: new Set(), fleet: [] },
            { name: 'Computer 🤖', board: computerBoard, shots: new Set(), fleet: computerFleet }
        ];
        document.getElementById('modeText').textContent =
            'Solo mode: place your fleet, then sink the computer before it sinks you.';
    } else {
        state.players = [
            { name: 'Player 1', board: emptyBoard(), shots: new Set(), fleet: [] },
            { name: 'Player 2', board: emptyBoard(), shots: new Set(), fleet: [] }
        ];
        document.getElementById('modeText').textContent =
            '2-player mode: each captain secretly places their fleet, then battle begins.';
    }

    document.getElementById('winOverlay').style.display  = 'none';
    document.getElementById('passOverlay').style.display = 'none';
    startPlacement(0);
}

// ── Render helpers (battle phase) ─────────────────────────────────────────────
function render() {
    const active   = state.current;
    const opponent = active ^ 1;
    const status   = state.gameOver
        ? 'Match over.'
        : `${state.players[active].name}'s turn · Target: ${state.players[opponent].name}`;
    document.getElementById('status').textContent = status;

    renderOwnBoard();

    // In solo mode the board is always shown from the human's (player 0) point of
    // view – even while the bot is taking its turn.  Switching to the bot's
    // perspective caused the "bouncing / flickering" that was reported.
    if (mode === 'solo') {
        renderTargetBoard(0, 1);
    } else {
        renderTargetBoard(active, opponent);
    }

    renderFleet('p0Fleet', state.players[0]);
    renderFleet('p1Fleet', state.players[1]);
}

function renderOwnBoard() {
    // In solo mode, always show player 0's own board.
    // In duel mode, show the active player's own board.
    const ownerIndex   = mode === 'solo' ? 0 : state.current;
    const shooterIndex = ownerIndex ^ 1;
    const owner   = state.players[ownerIndex];
    const shooter = state.players[shooterIndex];
    const el = document.getElementById('p0Own');
    el.innerHTML = '';
    document.getElementById('p0Title').textContent = owner.name;

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            const id      = coord(r, c);
            const shipKey = owner.board[r][c];
            const wasShot = shooter.shots.has(id);
            if (shipKey) cell.classList.add('ship');
            if (wasShot) {
                if (shipKey) {
                    const ship = owner.fleet.find(s => s.key === shipKey);
                    cell.classList.add(ship?.sunk ? 'sunk' : 'hit');
                    cell.textContent = '✹';
                } else {
                    cell.classList.add('miss');
                    cell.textContent = '•';
                }
            }
            cell.disabled = true;
            el.appendChild(cell);
        }
    }
}

function renderTargetBoard(shooterIndex, targetIndex) {
    const shooter  = state.players[shooterIndex];
    const target   = state.players[targetIndex];
    const el       = document.getElementById('p1Target');
    el.innerHTML   = '';
    document.getElementById('p1Title').textContent = target.name;
    // In solo mode only allow the human (index 0) to fire; while the bot is
    // taking its turn the grid must be locked so that stray clicks don't
    // register as bot shots or cause turn-order corruption.
    const canShoot = !state.gameOver && (mode === 'solo' ? state.current === 0 : true);

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const id   = coord(r, c);
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            const shot    = shooter.shots.has(id);
            const shipKey = target.board[r][c];
            if (shot) {
                if (shipKey) {
                    const ship = target.fleet.find(s => s.key === shipKey);
                    cell.classList.add(ship?.sunk ? 'sunk' : 'hit');
                    cell.textContent = '✹';
                } else {
                    cell.classList.add('miss');
                    cell.textContent = '•';
                }
                cell.classList.add('disabled');
            }
            if (!canShoot || shot) cell.disabled = true;
            else cell.addEventListener('click', () => fire(shooterIndex, targetIndex, r, c));
            el.appendChild(cell);
        }
    }
}

function renderFleet(elId, player) {
    const el = document.getElementById(elId);
    el.innerHTML = player.fleet.map(s => {
        const cls = s.sunk ? 'bb-fleet-item sunk' : 'bb-fleet-item';
        const hp  = `${s.hits}/${s.size}`;
        return `<div class="${cls}"><span>${s.name} (${s.size})</span><strong>${s.sunk ? 'SUNK' : hp}</strong></div>`;
    }).join('');
}

// ── Fire ──────────────────────────────────────────────────────────────────────
function fire(shooterIndex, targetIndex, r, c) {
    if (state.gameOver) return;
    const shooter = state.players[shooterIndex];
    const target  = state.players[targetIndex];
    const id = coord(r, c);
    if (shooter.shots.has(id)) return;
    shooter.shots.add(id);

    const shipKey = target.board[r][c];
    if (shipKey) {
        const ship = target.fleet.find(s => s.key === shipKey);
        ship.hits++;
        sfx.hit();
        logMsg(`💥 ${shooter.name} hit ${target.name}'s ${ship.name}!`);

        if (ship.hits >= ship.size && !ship.sunk) {
            ship.sunk = true;
            sfx.sink();
            splashEmoji('🌊', r, c);
            splashEmoji('🚢', r, c);
            logMsg(`🚨 ${ship.name} sunk! Overboard!`);
        }

        if (target.fleet.every(s => s.sunk)) {
            endGame(shooter.name);
            return;
        }
        // Hit keeps the turn (same player fires again)
    } else {
        sfx.miss();
        logMsg(`Splash! ${shooter.name} missed.`);

        if (mode === 'duel') {
            // Hand device to the other player
            const next = targetIndex; // next player to shoot is the one who was just shot at
            document.getElementById('passTitle').textContent = `🎯 ${state.players[next].name}'s turn`;
            document.getElementById('passMsg').textContent =
                `Hand the device to ${state.players[next].name}.`;
            document.getElementById('passOverlay').style.display = 'flex';
            document.getElementById('passReadyBtn').onclick = () => {
                document.getElementById('passOverlay').style.display = 'none';
                state.current = next;
                render();
            };
            state.current = next;
            render();
            return;
        }

        state.current = state.current ^ 1;
    }

    render();

    if (!state.gameOver && mode === 'solo' && state.current === 1) {
        setTimeout(botTurn, 680);
    }
}

// ── Bot turn ──────────────────────────────────────────────────────────────────
function botTurn() {
    if (state.gameOver || state.current !== 1) return;
    const bot    = state.players[1];
    const target = state.players[0];
    let r, c, id;
    do {
        r  = rand(0, SIZE - 1);
        c  = rand(0, SIZE - 1);
        id = coord(r, c);
    } while (bot.shots.has(id));

    bot.shots.add(id);
    const shipKey = target.board[r][c];
    if (shipKey) {
        const ship = target.fleet.find(s => s.key === shipKey);
        ship.hits++;
        sfx.hit();
        logMsg(`🤖 Computer hit your ${ship.name}!`);
        if (ship.hits >= ship.size && !ship.sunk) {
            ship.sunk = true;
            sfx.sink();
            splashEmoji('🌊', r, c);
            logMsg(`🆘 Your ${ship.name} is sunk!`);
        }
        if (target.fleet.every(s => s.sunk)) {
            endGame('Computer 🤖');
            return;
        }
        // Bot hit: bot fires again
    } else {
        sfx.miss();
        logMsg('Computer missed. Your turn!');
        state.current = 0;
    }

    render();
    if (!state.gameOver && state.current === 1) setTimeout(botTurn, 560);
}

// ── Splash animation ──────────────────────────────────────────────────────────
function splashEmoji(icon, r, c) {
    const grid = document.getElementById('p1Target');
    const rect = grid.getBoundingClientRect();
    const cell = rect.width / SIZE;
    const fx   = document.createElement('div');
    fx.className   = 'bb-splash';
    fx.textContent = icon;
    fx.style.left  = `${rect.left + c * cell + cell / 2}px`;
    fx.style.top   = `${rect.top  + r * cell + cell / 2}px`;
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 980);
}

// ── End game ──────────────────────────────────────────────────────────────────
function endGame(winnerName) {
    state.gameOver = true;
    sfx.win();
    launchConfetti();
    document.getElementById('winText').textContent  = `🏆 ${winnerName} wins Battle Boat!`;
    document.getElementById('winOverlay').style.display = 'flex';
    logMsg(`⚓ ${winnerName} sank the final ship and won the battle!`);
    render();

    // Persist result for the logged-in player
    const meName = sessionStorage.getItem('userName');
    if (meName) {
        const elapsed = state.battleStartedAt ? Math.round((Date.now() - state.battleStartedAt) / 1000) : 0;
        const isWin   = winnerName === meName;
        const result  = isWin ? 'Win' : 'Loss';
        const score   = isWin ? Math.max(1, state.players[0].fleet.filter(s => !s.sunk).length * 10) : 0;
        fetch('/api/me/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameType: 'BattleBoat', result, score, timePlayed: elapsed, details: mode === 'solo' ? 'vs Computer' : 'vs Player' })
        }).catch(() => {});
    }
}

// ── Misc ──────────────────────────────────────────────────────────────────────
function logMsg(text) {
    document.getElementById('bbLog').textContent = text;
}

function goBack() { window.location.href = '/lobby'; }

// ── Header init ───────────────────────────────────────────────────────────────
(async function initHeader() {
    try {
        const me = await fetch('/api/me').then(r => r.ok ? r.json() : null);
        if (!me) return;
        document.getElementById('navbarUsername').textContent = me.name || '';
        if (me.avatar) {
            document.getElementById('navbarAvatarEmoji').textContent   = me.avatar;
            document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
            document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
        }
        sessionStorage.setItem('userName', me.name || 'Player 1');
    } catch { }
})();

// ── Wire up buttons ───────────────────────────────────────────────────────────
document.getElementById('newMatchBtn').addEventListener('click', startGame);
document.getElementById('playAgainBtn').addEventListener('click', startGame);
document.getElementById('backBtn').addEventListener('click', goBack);
document.getElementById('overlayBackBtn').addEventListener('click', goBack);
document.getElementById('hamBackBtn')?.addEventListener('click', goBack);

document.getElementById('orientBtn').addEventListener('click', () => {
    state.placement.horizontal = !state.placement.horizontal;
    document.getElementById('orientBtn').textContent =
        state.placement.horizontal ? '↔ Horizontal' : '↕ Vertical';
    // Clear any preview highlights
    document.querySelectorAll('#p0Own .bb-cell').forEach(c =>
        c.classList.remove('preview', 'preview-bad'));
    // Refresh the title so the orientation label stays in sync
    renderPlacementQueue();
});

document.getElementById('randomBtn').addEventListener('click', doRandomize);
document.getElementById('resetPlaceBtn').addEventListener('click', doReset);
document.getElementById('confirmPlaceBtn').addEventListener('click', confirmPlacement);

// Dismiss hover preview when mouse leaves the grid
document.getElementById('p0Own').addEventListener('mouseleave', () => {
    document.querySelectorAll('#p0Own .bb-cell').forEach(c =>
        c.classList.remove('preview', 'preview-bad'));
});

// ── Kick off ──────────────────────────────────────────────────────────────────
startGame();
