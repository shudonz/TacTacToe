const SIZE = 10;
const SHIPS = [
    { key: 'carrier', name: 'Carrier', size: 5 },
    { key: 'battleship', name: 'Battleship', size: 4 },
    { key: 'cruiser', name: 'Cruiser', size: 3 },
    { key: 'submarine', name: 'Submarine', size: 3 },
    { key: 'destroyer', name: 'Destroyer', size: 2 }
];

const mode = new URLSearchParams(window.location.search).get('mode') === 'duel' ? 'duel' : 'solo';
const state = {
    mode,
    current: 0,
    gameOver: false,
    players: []
};

const ac = new (window.AudioContext || window.webkitAudioContext)();
function tone(freq, dur = 0.12, vol = 0.18, type = 'sine') {
    if (ac.state === 'suspended') ac.resume();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain); gain.connect(ac.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.stop(ac.currentTime + dur + 0.03);
}
const sfx = {
    miss: () => { tone(280, 0.16, 0.2, 'triangle'); },
    hit: () => { tone(580, 0.08, 0.22); tone(780, 0.11, 0.15); },
    sink: () => { [420, 360, 280, 180].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.23, 'sawtooth'), i * 95)); },
    win: () => { [524, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.24), i * 120)); }
};

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
        g: 0.18 + Math.random() * 0.04,
        s: 3 + Math.random() * 5,
        c: colors[(Math.random() * colors.length) | 0],
        a: 1
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

function mkPlayer(name) {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const shots = new Set();
    const fleet = placeFleet(board);
    return { name, board, shots, fleet };
}

function placeFleet(board) {
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

function canPlace(board, r, c, size, horizontal) {
    for (let i = 0; i < size; i++) {
        const rr = r + (horizontal ? 0 : i);
        const cc = c + (horizontal ? i : 0);
        if (rr >= SIZE || cc >= SIZE || board[rr][cc]) return false;
    }
    return true;
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function coord(r, c) { return `${r},${c}`; }

function startGame() {
    state.current = 0;
    state.gameOver = false;
    const meName = sessionStorage.getItem('userName') || 'Player 1';
    state.players = mode === 'solo'
        ? [mkPlayer(meName), mkPlayer('Computer 🤖')]
        : [mkPlayer('Player 1'), mkPlayer('Player 2')];

    document.getElementById('modeText').textContent = mode === 'solo'
        ? 'Solo mode: sink the computer fleet before it sinks yours.'
        : '2-player mode: pass turns and fire on each other\'s fleets.';

    document.getElementById('p0Title').textContent = state.players[0].name;
    document.getElementById('p1Title').textContent = state.players[1].name;
    document.getElementById('winOverlay').style.display = 'none';
    logMsg('All ships deployed. Fire at will!');
    render();
}

function render() {
    const active = state.current;
    const opponent = active ^ 1;
    const status = state.gameOver
        ? 'Match over.'
        : `${state.players[active].name}'s turn · Target: ${state.players[opponent].name}`;
    document.getElementById('status').textContent = status;

    renderOwnBoard(0, active === 0 || mode === 'solo');
    renderTargetBoard(active, opponent);
    renderFleet('p0Fleet', state.players[0]);
    renderFleet('p1Fleet', state.players[1]);
}

function renderOwnBoard(playerIndex, reveal) {
    const owner = state.players[playerIndex];
    const shooter = state.players[playerIndex ^ 1];
    const el = document.getElementById('p0Own');
    el.innerHTML = '';

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            const id = coord(r, c);
            const shipKey = owner.board[r][c];
            const wasShot = shooter.shots.has(id);
            if (shipKey && reveal) cell.classList.add('ship');
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
    const shooter = state.players[shooterIndex];
    const target = state.players[targetIndex];
    const el = document.getElementById('p1Target');
    el.innerHTML = '';
    const canShoot = !state.gameOver && (mode === 'solo' ? shooterIndex === 0 : true);

    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const id = coord(r, c);
            const cell = document.createElement('button');
            cell.className = 'bb-cell';
            const shot = shooter.shots.has(id);
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
        const hp = `${s.hits}/${s.size}`;
        return `<div class="${cls}"><span>${s.name} (${s.size})</span><strong>${s.sunk ? 'SUNK' : hp}</strong></div>`;
    }).join('');
}

function fire(shooterIndex, targetIndex, r, c) {
    if (state.gameOver) return;
    const shooter = state.players[shooterIndex];
    const target = state.players[targetIndex];
    const id = coord(r, c);
    if (shooter.shots.has(id)) return;
    shooter.shots.add(id);

    const shipKey = target.board[r][c];
    if (shipKey) {
        const ship = target.fleet.find(s => s.key === shipKey);
        ship.hits++;
        sfx.hit();
        logMsg(`�� ${shooter.name} hit ${target.name}'s ${ship.name}!`);

        if (ship.hits >= ship.size && !ship.sunk) {
            ship.sunk = true;
            sfx.sink();
            splashEmoji('🌊', r, c);
            splashEmoji('🚢', r, c);
            logMsg(`🚨 ${ship.name} was sunk! Overboard!`);
        }

        if (target.fleet.every(s => s.sunk)) {
            endGame(shooter.name);
            return;
        }
    } else {
        sfx.miss();
        logMsg(`Splash! ${shooter.name} missed.`);
        state.current = state.current ^ 1;
    }

    render();

    if (!state.gameOver && mode === 'solo' && state.current === 1) {
        setTimeout(botTurn, 680);
    }
}

function botTurn() {
    if (state.gameOver || state.current !== 1) return;
    const bot = state.players[1];
    const target = state.players[0];
    let r, c, id;
    do {
        r = rand(0, SIZE - 1);
        c = rand(0, SIZE - 1);
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
    } else {
        sfx.miss();
        logMsg('Computer missed. Your turn!');
        state.current = 0;
    }

    render();
    if (!state.gameOver && state.current === 1) setTimeout(botTurn, 560);
}

function splashEmoji(icon, r, c) {
    const grid = document.getElementById('p1Target');
    const rect = grid.getBoundingClientRect();
    const cell = rect.width / SIZE;
    const fx = document.createElement('div');
    fx.className = 'bb-splash';
    fx.textContent = icon;
    fx.style.left = `${rect.left + c * cell + cell / 2}px`;
    fx.style.top = `${rect.top + r * cell + cell / 2}px`;
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), 980);
}

function endGame(winnerName) {
    state.gameOver = true;
    sfx.win();
    launchConfetti();
    document.getElementById('winText').textContent = `🏆 ${winnerName} wins Battle Boat!`;
    document.getElementById('winOverlay').style.display = 'flex';
    logMsg(`⚓ ${winnerName} sank the final ship and won the battle!`);
    render();
}

function logMsg(text) {
    document.getElementById('bbLog').textContent = text;
}

function goBack() { window.location.href = '/lobby'; }

(async function initHeader() {
    try {
        const me = await fetch('/api/me').then(r => r.ok ? r.json() : null);
        if (!me) return;
        document.getElementById('navbarUsername').textContent = me.name || '';
        if (me.avatar) {
            document.getElementById('navbarAvatarEmoji').textContent = me.avatar;
            document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
            document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
        }
        sessionStorage.setItem('userName', me.name || 'Player 1');
    } catch { }
})();

document.getElementById('newMatchBtn').addEventListener('click', startGame);
document.getElementById('playAgainBtn').addEventListener('click', startGame);
document.getElementById('backBtn').addEventListener('click', goBack);
document.getElementById('overlayBackBtn').addEventListener('click', goBack);
document.getElementById('hamBackBtn').addEventListener('click', goBack);

startGame();
