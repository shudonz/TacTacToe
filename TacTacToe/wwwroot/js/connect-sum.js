const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("connectSumRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing ConnectSum room id"); }

let myName = sessionStorage.getItem("myName") || "";
let gameState = null;
let _gameOverEventFired = false;
let _hintCol = -1;
let _dropping = false; // lock while disc drop animation plays

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

/* ============================================================
   Confetti Engine (same as mancala.js pattern)
   ============================================================ */
const _confColors = ['#ff4444','#ff8888','#4488ff','#88bbff','#ffcc00','#ff55aa','#44ffcc','#b388ff','#ff8a47','#69f0ae'];
function _spawnParticles(count, originX, originY, speedScale, canvas, particles) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (2 + Math.random() * 9) * speedScale;
        particles.push({
            x: originX, y: originY,
            vx: Math.cos(angle) * speed * (0.6 + Math.random()),
            vy: Math.sin(angle) * speed * -1.2 - Math.random() * 5 * speedScale,
            size: 4 + Math.random() * 7,
            color: _confColors[Math.floor(Math.random() * _confColors.length)],
            rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 14,
            shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
            opacity: 1, gravity: 0.11 + Math.random() * 0.09, drag: 0.98 + Math.random() * 0.015,
            wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06, fadeStart: 160
        });
    }
}
function _runConfettiCanvas(canvas, particles, maxFrames) {
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight, frame = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;
        for (const p of particles) {
            p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5; p.y += p.vy;
            p.rotation += p.rotSpeed; p.wobble += p.wobbleSpeed;
            if (frame > p.fadeStart) p.opacity -= 0.016;
            if (p.opacity <= 0) continue;
            alive = true;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity); ctx.fillStyle = p.color;
            if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
            else if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            else ctx.fillRect(-p.size / 2, -1, p.size, 2.5);
            ctx.restore();
        }
        frame++; if (alive && frame < maxFrames) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}
function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight, particles = [];
    _spawnParticles(250, w / 2 + (Math.random() - 0.5) * w * 0.3, h * 0.45, 1.1, canvas, particles);
    setTimeout(() => _spawnParticles(120, w * 0.12, h * 0.3, 0.9, canvas, particles), 200);
    setTimeout(() => _spawnParticles(120, w * 0.88, h * 0.3, 0.9, canvas, particles), 350);
    setTimeout(() => _spawnParticles(100, w * 0.5, h * 0.15, 1.3, canvas, particles), 550);
    setTimeout(() => _spawnParticles(80, w * 0.3, h * 0.2, 1.0, canvas, particles), 700);
    setTimeout(() => _spawnParticles(80, w * 0.7, h * 0.2, 1.0, canvas, particles), 850);
    _runConfettiCanvas(canvas, particles, 420);
}

/* ============================================================
   Sound Engine
   ============================================================ */
const _ac = new (window.AudioContext || window.webkitAudioContext)();
function _resumeAudio() { if (_ac.state === 'suspended') _ac.resume(); }
function _tone(freq, type, start, dur, vol) {
    const osc = _ac.createOscillator(), gain = _ac.createGain();
    osc.connect(gain); gain.connect(_ac.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start); osc.stop(start + dur + 0.05);
}
function soundDrop() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(280, 'triangle', t, 0.05, 0.18);
    _tone(200, 'triangle', t + 0.03, 0.07, 0.14);
    _tone(140, 'sine', t + 0.06, 0.12, 0.10);
}
function soundWin() {
    _resumeAudio(); const t = _ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => _tone(f, 'sine', t + i * 0.09, 0.18, 0.22));
    _tone(1319, 'sine', t + 0.38, 0.4, 0.28);
}
function soundDraw() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(440, 'triangle', t, 0.12, 0.15);
    _tone(350, 'triangle', t + 0.1, 0.12, 0.12);
    _tone(280, 'triangle', t + 0.2, 0.18, 0.10);
}
function soundInvalid() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(180, 'sawtooth', t, 0.08, 0.12);
}
function soundHint() {
    _resumeAudio(); const t = _ac.currentTime;
    _tone(880, 'sine', t, 0.08, 0.14);
    _tone(1100, 'sine', t + 0.07, 0.09, 0.12);
}

/* ============================================================
   Board rendering
   ============================================================ */
function buildBoard(rows, cols) {
    const board = document.getElementById('csBoard');
    const arrows = document.getElementById('csColArrows');
    board.innerHTML = '';
    arrows.innerHTML = '';
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

    // Build arrow buttons
    for (let c = 0; c < cols; c++) {
        const btn = document.createElement('button');
        btn.className = 'cs-col-arrow';
        btn.dataset.col = c;
        btn.textContent = '▼';
        btn.setAttribute('aria-label', `Drop disc in column ${c + 1}`);
        btn.addEventListener('click', () => handleColClick(c));
        arrows.appendChild(btn);
    }

    // Build cells (top-left = row 0, col 0)
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'cs-cell';
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.addEventListener('click', () => handleColClick(c));
            // Hover column tint
            cell.addEventListener('mouseenter', () => highlightCol(c, true));
            cell.addEventListener('mouseleave', () => highlightCol(c, false));
            const disc = document.createElement('div');
            disc.className = 'cs-disc';
            cell.appendChild(disc);
            board.appendChild(cell);
        }
    }
}

function highlightCol(col, on) {
    if (!gameState || gameState.isOver) return;
    document.querySelectorAll('.cs-cell').forEach(cell => {
        if (parseInt(cell.dataset.col) === col) {
            cell.classList.toggle('cs-col-hover', on);
        }
    });
}

function getCellEl(row, col) {
    return document.querySelector(`.cs-cell[data-row="${row}"][data-col="${col}"]`);
}

function getDiscEl(row, col) {
    const cell = getCellEl(row, col);
    return cell ? cell.querySelector('.cs-disc') : null;
}

/* ============================================================
   Game state rendering
   ============================================================ */
function renderState(state) {
    const prevState = gameState;
    gameState = state;

    const rows = state.rows, cols = state.cols;

    // Build board if first time or size changed
    const boardEl = document.getElementById('csBoard');
    if (boardEl.children.length !== rows * cols) {
        buildBoard(rows, cols);
        document.getElementById('connectSumBadge').textContent = `Connect ${state.connectN}`;
        document.getElementById('connectNRule').innerHTML = `First to connect <strong>${state.connectN}</strong> in a row (horizontal, vertical, or diagonal) wins.`;
    }

    // Find any newly placed disc (diff with previous)
    let newRow = -1, newCol = -1, newPlayer = 0;
    if (prevState && prevState.board) {
        outer: for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (state.board[r][c] !== 0 && prevState.board[r][c] === 0) {
                    newRow = r; newCol = c; newPlayer = state.board[r][c];
                    break outer;
                }
            }
        }
    }

    // Render all disc positions (non-animated)
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const disc = getDiscEl(r, c);
            if (!disc) continue;
            const val = state.board[r][c];
            if (val === 0) {
                disc.className = 'cs-disc';
                disc.style.opacity = '0';
                disc.style.transform = '';
                disc.style.animation = '';
            } else if (!(r === newRow && c === newCol)) {
                disc.className = `cs-disc p${val}`;
                disc.style.opacity = '1';
                disc.style.transform = 'translateY(0)';
                disc.style.animation = 'none';
            }
        }
    }

    // Animate newly placed disc
    if (newRow >= 0) {
        soundDrop();
        animateDisc(newRow, newCol, newPlayer, rows);
    }

    // Win line glow
    if (state.winLine) {
        for (let i = 0; i < state.winLine.length; i += 2) {
            const cell = getCellEl(state.winLine[i], state.winLine[i + 1]);
            if (cell) cell.classList.add('win-cell');
        }
    }

    // Player chips
    renderPlayers(state);

    // Status text
    const statusEl = document.getElementById('statusText');
    if (state.isOver) {
        if (state.isDraw) {
            statusEl.textContent = "It's a Draw!";
        } else {
            statusEl.textContent = `🏆 ${state.winnerName} wins!`;
        }
        // Disable all input
        document.querySelectorAll('.cs-cell, .cs-col-arrow').forEach(el => {
            el.classList.add('no-hover');
            el.style.pointerEvents = 'none';
        });
    } else {
        const curr = state.players[state.currentPlayerIndex];
        const isMyTurn = curr.name === myName && !curr.isBot;
        statusEl.textContent = isMyTurn ? "🎯 Your turn!" : `⏳ ${curr.name}'s turn…`;
    }

    // Hint arrow
    if (_hintCol >= 0) {
        const arrowEl = document.querySelector(`.cs-col-arrow[data-col="${_hintCol}"]`);
        if (arrowEl) arrowEl.classList.add('hint-col');
    }

    // Game over
    if (state.isOver && !_gameOverEventFired) {
        _gameOverEventFired = true;
        const isWin = state.winnerName === myName;
        const isDraw = state.isDraw;
        if (isWin) {
            soundWin();
            setTimeout(() => launchConfetti(), 350);
        } else if (isDraw) {
            soundDraw();
        }
        setTimeout(() => showResult(state), isWin ? 2200 : 900);
        document.dispatchEvent(new Event('gameOver'));
    }
}

function animateDisc(row, col, player, rows) {
    const disc = getDiscEl(row, col);
    if (!disc) return;
    // Calculate approximate drop distance (rows above)
    const dur = Math.min(0.55, 0.18 + row * 0.06);
    disc.style.setProperty('--drop-start', `-${(row + 2) * 110}%`);
    disc.style.setProperty('--drop-dur', dur + 's');
    disc.className = `cs-disc p${player} placed`;
    disc.addEventListener('animationend', () => {
        disc.style.opacity = '1';
        disc.style.transform = 'translateY(0)';
        disc.style.animation = 'none';
        disc.className = `cs-disc p${player}`;
        getCellEl(row, col)?.setAttribute('data-filled', '1');
        _dropping = false;
    }, { once: true });
    _dropping = true;
}

function renderPlayers(state) {
    const container = document.getElementById('csPlayers');
    container.innerHTML = '';
    state.players.forEach((p, i) => {
        const chip = document.createElement('div');
        chip.className = 'cs-player-chip' + (i === state.currentPlayerIndex && !state.isOver ? ' active' : '');
        if (i === 0) chip.style.setProperty('--cs-active-color', '#ff4444');
        else chip.style.setProperty('--cs-active-color', '#4488ff');
        chip.innerHTML =
            `<div class="cs-disc-icon cs-disc-p${i + 1}"></div>` +
            `<span class="cs-player-name">${esc(p.name)}${p.isBot ? ' 🤖' : ''}</span>` +
            `<span class="cs-player-score">${p.wins || 0}</span>`;
        container.appendChild(chip);
    });
}

function showResult(state) {
    const overlay = document.getElementById('resultOverlay');
    const text = document.getElementById('resultText');
    const scores = document.getElementById('resultScores');
    if (state.isDraw) {
        text.textContent = "🤝 It's a Draw!";
    } else if (state.winnerName === myName) {
        text.textContent = "🏆 You Win!";
    } else {
        text.textContent = `${esc(state.winnerName)} Wins!`;
    }
    const p1 = state.players[0], p2 = state.players[1];
    scores.innerHTML = p2 ? `<span style="color:#ff8888">${esc(p1.name)}</span> vs <span style="color:#88bbff">${esc(p2.name)}</span>` : '';
    overlay.style.display = 'flex';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ============================================================
   User interaction
   ============================================================ */
function handleColClick(col) {
    _resumeAudio();
    if (!gameState || gameState.isOver || _dropping) return;
    const curr = gameState.players[gameState.currentPlayerIndex];
    if (curr.name !== myName || curr.isBot) return;
    // Check column has space
    if (gameState.board[0][col] !== 0) { soundInvalid(); return; }
    // Clear hint
    _hintCol = -1;
    document.querySelectorAll('.cs-col-arrow').forEach(a => a.classList.remove('hint-col'));
    connection.invoke('ConnectSumDropDisc', roomId, col);
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
    if (!myName) {
        const res = await fetch('/api/me');
        const me = await res.json();
        myName = me.name;
        setNavbar(me);
    } else {
        fetch('/api/me').then(r => r.json()).then(me => setNavbar(me));
    }

    connection.on('ConnectSumUpdated', state => renderState(state));
    connection.on('PlayerLeft', name => {
        document.getElementById('statusText').textContent = `${name} left the game.`;
    });

    connection.on('ConnectSumHint', col => {
        _hintCol = col;
        soundHint();
        document.querySelectorAll('.cs-col-arrow').forEach(a => a.classList.remove('hint-col'));
        if (col >= 0) {
            const arrowEl = document.querySelector(`.cs-col-arrow[data-col="${col}"]`);
            if (arrowEl) arrowEl.classList.add('hint-col');
        }
    });

    await connection.start();
    await connection.invoke('RejoinConnectSumRoom', roomId);

    document.getElementById('hintBtn').addEventListener('click', () => {
        if (!gameState || gameState.isOver) return;
        connection.invoke('RequestConnectSumHint', roomId);
    });

    document.getElementById('backBtn2').addEventListener('click', () => backToLobby());
    document.getElementById('backToLobby').addEventListener('click', () => backToLobby());
    document.getElementById('backBtn').addEventListener('click', () => backToLobby());

    if (!isSinglePlayer) initChat(connection, roomId);
}

function backToLobby() {
    connection.invoke('LeaveConnectSumRoom', roomId).finally(() => { window.location.href = '/lobby'; });
}

function setNavbar(me) {
    document.getElementById('navbarUsername').textContent = me.name;
    if (me.avatar) {
        document.getElementById('navbarAvatarEmoji').textContent = me.avatar;
        document.getElementById('navbarAvatarEmoji').style.display = 'inline-flex';
        document.getElementById('navbarAvatarImg').style.display = 'none';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    } else if (me.picture) {
        document.getElementById('navbarAvatarImg').src = me.picture;
        document.getElementById('navbarAvatarImg').style.display = 'inline-block';
        document.getElementById('navbarAvatarEmoji').style.display = 'none';
        document.getElementById('navbarAvatarPlaceholder').style.display = 'none';
    }
}

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
