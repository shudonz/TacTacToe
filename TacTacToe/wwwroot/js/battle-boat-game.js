// Battle Boat - Multiplayer Game
// This version uses SignalR for online multiplayer matches

const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("battleBoatRoomId");
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Battle Boat room id");
}

// Constants
const SIZE = 10;
const SHIPS = [
    { key: 'boaty',      name: 'Boaty McBoatface', size: 5 },
    { key: 'partybarge', name: 'Party Barge',       size: 4 },
    { key: 'pontoon',    name: 'Pontoon',            size: 3 },
    { key: 'kayak',      name: 'Kayak',              size: 3 },
    { key: 'ducky',      name: 'Rubber Ducky',       size: 2 }
];

// Audio
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

// State
let myName = "";
let gameState = null;
let placementBoard = [];
let placementFleet = [];
let placementHorizontal = true;
let placementShipIndex = 0;

// Helpers
function coord(r, c) { return `${r},${c}`; }
function emptyBoard() { return Array.from({ length: SIZE }, () => Array(SIZE).fill(null)); }
function canPlace(board, r, c, size, horizontal) {
    for (let i = 0; i < size; i++) {
        const rr = r + (horizontal ? 0 : i);
        const cc = c + (horizontal ? i : 0);
        if (rr >= SIZE || cc >= SIZE || board[rr][cc]) return false;
    }
    return true;
}

// Confetti
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

// Placement phase
function startPlacement() {
    placementBoard = emptyBoard();
    placementFleet = [];
    placementHorizontal = true;
    placementShipIndex = 0;
    document.getElementById('placementBar').classList.add('visible');
    document.getElementById('status').textContent = 'Place your fleet on your grid';
    document.getElementById('orientBtn').textContent = '↔ Horizontal';
    document.getElementById('confirmPlaceBtn').disabled = true;
    renderPlacementQueue();
    renderPlacementBoard();
}

function renderPlacementQueue() {
    const el = document.getElementById('placementShipQueue');
    el.innerHTML = SHIPS.map((s, i) => {
        let cls = 'bb-ship-tag';
        if (i < placementShipIndex) cls += ' placed';
        else if (i === placementShipIndex) cls += ' active';
        return `<span class="${cls}">${s.name} (${s.size})</span>`;
    }).join('');
    const ship = SHIPS[placementShipIndex];
    const orient = placementHorizontal ? 'horizontal' : 'vertical';
    document.getElementById('placementBarTitle').textContent =
        placementShipIndex < SHIPS.length
        ? `Place your ${ship.name} (${ship.size} cells, ${orient})`
        : 'All ships placed!';
}

function renderPlacementBoard() {
    const el = document.getElementById('p0Own');
    el.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            if (placementBoard[r][c]) cell.classList.add('ship');
            cell.addEventListener('mouseover', () => onPlacementHover(r, c));
            cell.addEventListener('click', () => onPlacementClick(r, c));
            el.appendChild(cell);
        }
    }
    document.getElementById('p0Fleet').innerHTML = SHIPS.map((s, i) => {
        if (i >= placementShipIndex) return '';
        return `<div class="bb-fleet-item"><span>${s.name} (${s.size})</span><strong>✓ Placed</strong></div>`;
    }).join('');
}

function onPlacementHover(r, c) {
    if (placementShipIndex >= SHIPS.length) return;
    const el = document.getElementById('p0Own');
    const allCells = el.querySelectorAll('.bb-cell');
    allCells.forEach(c => { c.classList.remove('preview', 'preview-bad'); });
    const ship = SHIPS[placementShipIndex];
    const valid = canPlace(placementBoard, r, c, ship.size, placementHorizontal);
    for (let i = 0; i < ship.size; i++) {
        const pr = r + (placementHorizontal ? 0 : i);
        const pc = c + (placementHorizontal ? i : 0);
        if (pr >= 0 && pr < SIZE && pc >= 0 && pc < SIZE) {
            const idx = pr * SIZE + pc;
            allCells[idx].classList.add(valid ? 'preview' : 'preview-bad');
        }
    }
}

function onPlacementClick(r, c) {
    if (placementShipIndex >= SHIPS.length) return;
    const ship = SHIPS[placementShipIndex];
    if (!canPlace(placementBoard, r, c, ship.size, placementHorizontal)) return;
    const cells = [];
    for (let i = 0; i < ship.size; i++) {
        const rr = r + (placementHorizontal ? 0 : i);
        const cc = c + (placementHorizontal ? i : 0);
        placementBoard[rr][cc] = ship.key;
        cells.push([rr, cc]);
    }
    placementFleet.push({ ...ship, cells, hits: 0, sunk: false });
    placementShipIndex++;
    sfx.place();
    renderPlacementQueue();
    renderPlacementBoard();
    if (placementShipIndex >= SHIPS.length) {
        document.getElementById('confirmPlaceBtn').disabled = false;
    }
}

function doRandomize() {
    placementBoard = emptyBoard();
    placementFleet = [];
    placementShipIndex = 0;
    for (const ship of SHIPS) {
        let placed = false;
        while (!placed) {
            const horizontal = Math.random() > 0.5;
            const r = Math.floor(Math.random() * SIZE);
            const c = Math.floor(Math.random() * SIZE);
            if (!canPlace(placementBoard, r, c, ship.size, horizontal)) continue;
            const cells = [];
            for (let i = 0; i < ship.size; i++) {
                const rr = r + (horizontal ? 0 : i);
                const cc = c + (horizontal ? i : 0);
                placementBoard[rr][cc] = ship.key;
                cells.push([rr, cc]);
            }
            placementFleet.push({ ...ship, cells, hits: 0, sunk: false });
            placed = true;
        }
    }
    placementShipIndex = SHIPS.length;
    renderPlacementQueue();
    renderPlacementBoard();
    document.getElementById('confirmPlaceBtn').disabled = false;
}

function doReset() {
    placementBoard = emptyBoard();
    placementFleet = [];
    placementShipIndex = 0;
    renderPlacementQueue();
    renderPlacementBoard();
    document.getElementById('confirmPlaceBtn').disabled = true;
}

function confirmPlacement() {
    document.getElementById('placementBar').classList.remove('visible');
    document.getElementById('waitingOverlay').style.display = 'flex';
    connection.invoke('SubmitBattleBoatFleet', roomId, placementFleet);
}

// Battle phase
function renderBattle(state) {
    gameState = state;
    document.getElementById('waitingOverlay').style.display = 'none';
    document.getElementById('status').textContent =
        state.isMyTurn ? `Your turn - Fire at ${state.opponent.name}` : `${state.opponent.name}'s turn`;

    renderOwnBoard(state.me);
    renderTargetBoard(state.opponent, state.isMyTurn);
    renderFleet('p0Fleet', state.me.fleet);
    renderFleet('p1Fleet', state.opponent.fleet);
    document.getElementById('p0Title').textContent = state.me.name;
    document.getElementById('p1Title').textContent = state.opponent.name;
}

function renderOwnBoard(me) {
    const el = document.getElementById('p0Own');
    el.innerHTML = '';
    const opponentShots    = me.opponentShots    || [];
    const opponentHitShots = me.opponentHitShots || [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            cell.disabled = true;
            const id = coord(r, c);
            const wasShot = opponentShots.includes(id);
            const shipKey = me.fleet.find(s => s.cells.some(([sr, sc]) => sr === r && sc === c))?.key;
            if (shipKey) cell.classList.add('ship');
            if (wasShot) {
                const wasHit = opponentHitShots.includes(id);
                if (wasHit) {
                    const ship = me.fleet.find(s => s.key === shipKey);
                    cell.classList.add(ship?.sunk ? 'sunk' : 'hit');
                    cell.textContent = '✹';
                } else {
                    cell.classList.add('miss');
                    cell.textContent = '•';
                }
            }
            el.appendChild(cell);
        }
    }
}

function renderTargetBoard(opponent, canShoot) {
    const el = document.getElementById('p1Target');
    el.innerHTML = '';
    const myShots    = opponent.myShots    || [];
    const myHitShots = opponent.myHitShots || [];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            const id = coord(r, c);
            const shot = myShots.includes(id);
            if (shot) {
                const wasHit = myHitShots.includes(id);
                if (wasHit) {
                    // Check sunk ships (server sends cells only for sunk ships)
                    const sunkShip = opponent.fleet.find(s => s.sunk && s.cells.some(([sr, sc]) => sr === r && sc === c));
                    cell.classList.add(sunkShip ? 'sunk' : 'hit');
                    cell.textContent = '✹';
                } else {
                    cell.classList.add('miss');
                    cell.textContent = '•';
                }
                cell.classList.add('disabled');
            }
            if (!canShoot || shot || gameState.isOver) {
                cell.disabled = true;
            } else {
                cell.addEventListener('click', () => fire(r, c));
            }
            el.appendChild(cell);
        }
    }
}

function renderFleet(elId, fleet) {
    const el = document.getElementById(elId);
    el.innerHTML = fleet.map(s => {
        const cls = s.sunk ? 'bb-fleet-item sunk' : 'bb-fleet-item';
        const hp  = `${s.hits}/${s.size}`;
        return `<div class="${cls}"><span>${s.name} (${s.size})</span><strong>${s.sunk ? 'SUNK' : hp}</strong></div>`;
    }).join('');
}

function fire(r, c) {
    connection.invoke('BattleBoatFire', roomId, r, c);
}

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

function logMsg(text) {
    document.getElementById('bbLog').textContent = text;
}

// SignalR handlers
connection.on('BattleBoatFleetSubmitted', (playerName) => {
    logMsg(`${playerName} has placed their fleet`);
});

connection.on('BattleBoatBattleBegins', () => {
    logMsg('All fleets deployed. Fire at will! 🎯');
});

connection.on('BattleBoatGameState', (state) => {
    renderBattle(state);
});

connection.on('BattleBoatShotFired', (shooterName, row, col, hit, sunkShip) => {
    if (hit) {
        sfx.hit();
        if (sunkShip) {
            sfx.sink();
            splashEmoji('🌊', row, col);
            splashEmoji('🚢', row, col);
            logMsg(`💥 ${shooterName} sank the ${sunkShip}!`);
        } else {
            logMsg(`💥 ${shooterName} hit!`);
        }
    } else {
        sfx.miss();
        logMsg(`Splash! ${shooterName} missed.`);
    }
});

connection.on('BattleBoatGameOver', (winnerName) => {
    sfx.win();
    launchConfetti();
    document.getElementById('winText').textContent = `🏆 ${winnerName} wins Battle Boat!`;
    document.getElementById('winOverlay').style.display = 'flex';
    logMsg(`⚓ ${winnerName} won the battle!`);
});

// Init
async function init() {
    const res = await fetch('/api/me');
    const me = await res.json();
    myName = me.name;

    document.getElementById('navbarUsername').textContent = me.name || '';
    if (me.avatar) {
        document.getElementById('navbarAvatarEmoji').textContent = me.avatar;
        document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    }

    document.getElementById('orientBtn').addEventListener('click', () => {
        placementHorizontal = !placementHorizontal;
        document.getElementById('orientBtn').textContent = placementHorizontal ? '↔ Horizontal' : '↕ Vertical';
        renderPlacementQueue();
    });
    document.getElementById('randomBtn').addEventListener('click', doRandomize);
    document.getElementById('resetPlaceBtn').addEventListener('click', doReset);
    document.getElementById('confirmPlaceBtn').addEventListener('click', confirmPlacement);
    document.getElementById('backBtn').addEventListener('click', () => { window.location.href = '/lobby'; });
    document.getElementById('overlayBackBtn').addEventListener('click', () => { window.location.href = '/lobby'; });
    document.getElementById('hamBackBtn')?.addEventListener('click', () => { window.location.href = '/lobby'; });

    await connection.start();
    await connection.invoke('RejoinBattleBoatRoom', roomId);
    startPlacement();
    initChat(connection, roomId);
}

init();
