/* ============================================================
   Confetti Engine
   ============================================================ */
const confettiColors = [
    '#7c6aff', '#9b7aff', '#ff5c8a', '#ff85a8',
    '#36d6c3', '#ffcb47', '#ff8a47', '#47d4ff',
    '#b388ff', '#ff80ab', '#69f0ae', '#ffd740'
];

function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.id = 'confetti-canvas';
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const particles = [];

    function spawn(count, ox, oy, speedScale, fadeStart) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (3 + Math.random() * 10) * speedScale;
            particles.push({
                x: ox, y: oy,
                vx: Math.cos(angle) * speed * (0.6 + Math.random()),
                vy: Math.sin(angle) * speed * -1.2 - Math.random() * 6,
                size: 4 + Math.random() * 6,
                color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
                rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 14,
                shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
                opacity: 1, gravity: 0.12 + Math.random() * 0.08, drag: 0.98 + Math.random() * 0.015,
                wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06, fadeStart
            });
        }
    }

    // Wave 1 — centre explosion
    spawn(220, w / 2 + (Math.random() - 0.5) * w * 0.25, h * 0.45, 1.1, 180);
    // Wave 2 — left + right cannons
    setTimeout(() => { spawn(100, w * 0.1, h * 0.5, 1.0, 160); spawn(100, w * 0.9, h * 0.5, 1.0, 160); }, 280);
    // Wave 3 — top shower
    setTimeout(() => { for (let i = 0; i < 70; i++) spawn(1, Math.random() * w, -10, 0.55, 130); }, 520);
    // Wave 4 — final flourish from bottom corners
    setTimeout(() => { spawn(60, w * 0.05, h, 1.3, 150); spawn(60, w * 0.95, h, 1.3, 150); }, 750);

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;
        for (const p of particles) {
            p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5; p.y += p.vy;
            p.rotation += p.rotSpeed; p.wobble += p.wobbleSpeed;
            if (frame > (p.fadeStart ?? 180)) p.opacity -= 0.014;
            if (p.opacity <= 0) continue;
            alive = true;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity); ctx.fillStyle = p.color;
            if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
            else if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            else ctx.fillRect(-p.size / 2, -1, p.size, 2.5);
            ctx.restore();
        }
        frame++;
        if (alive && frame < 400) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);

    window.addEventListener('resize', () => {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }, { once: true });
}

/* ============================================================
   Sound Engine (Web Audio API — no external files required)
   ============================================================ */
const _ac = new (window.AudioContext || window.webkitAudioContext)();
function _resumeAudio() { if (_ac.state === 'suspended') _ac.resume(); }

function _tone(freq, type, start, dur, vol) {
    const osc = _ac.createOscillator();
    const gain = _ac.createGain();
    osc.connect(gain); gain.connect(_ac.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start); osc.stop(start + dur + 0.05);
}

function playPlaceSound() {
    _resumeAudio();
    _tone(520, 'sine', _ac.currentTime, 0.09, 0.28);
    _tone(780, 'sine', _ac.currentTime + 0.04, 0.07, 0.15);
}
function playWinSound() {
    _resumeAudio();
    const t = _ac.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => _tone(f, 'sine', t + i * 0.13, 0.32, 0.35));
}
function playLoseSound() {
    _resumeAudio();
    const t = _ac.currentTime;
    [400, 320, 260].forEach((f, i) => _tone(f, 'sine', t + i * 0.16, 0.38, 0.28));
}
function playDrawSound() {
    _resumeAudio();
    _tone(330, 'triangle', _ac.currentTime, 0.45, 0.22);
    _tone(330, 'triangle', _ac.currentTime + 0.5, 0.35, 0.12);
}
function playChatSendSound() {
    _resumeAudio();
    _tone(880, 'sine', _ac.currentTime, 0.08, 0.14);
    _tone(1100, 'sine', _ac.currentTime + 0.06, 0.07, 0.1);
}
function playChatReceiveSound() {
    _resumeAudio();
    const t = _ac.currentTime;
    _tone(740, 'sine', t, 0.1, 0.18);
    _tone(988, 'sine', t + 0.09, 0.1, 0.18);
}

/* ============================================================
   Game Logic
   ============================================================ */
const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const gameId = sessionStorage.getItem("gameId");
let myMark = sessionStorage.getItem("myMark");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!gameId || !myMark) {
    window.location.replace("/lobby");
    throw new Error("Missing Tic Tac Toe game session data");
}

document.getElementById("xName").textContent = sessionStorage.getItem("xName");
document.getElementById("oName").textContent = sessionStorage.getItem("oName") + (isSinglePlayer ? " 🤖" : "");

if (isSinglePlayer) {
    document.getElementById("chatWidget").style.display = "none";
}

const cells = document.querySelectorAll(".cell");

let _prevBoard = Array(9).fill(null);
let _gameOver = false;

connection.on("GameUpdated", game => {
    // Server reset the game (SP replay) — dismiss the overlay before processing
    if (_gameOver && !game.isOver) {
        _gameOver = false;
        document.getElementById("resultOverlay").style.display = "none";
        document.getElementById("rematchArea").style.display = "none";
        _prevBoard = Array(9).fill(null);
    }

    // Detect newly placed piece → play place sound
    let newPiecePlaced = false;
    game.board.forEach((val, i) => {
        if (val && !_prevBoard[i]) newPiecePlaced = true;
        cells[i].textContent = val || "";
        cells[i].className = "cell" + (val ? " taken " + val.toLowerCase() : "");
    });
    _prevBoard = [...game.board];
    if (newPiecePlaced && !game.isOver) playPlaceSound();

    document.getElementById("playerX").classList.toggle("active", game.currentTurn === "X" && !game.isOver);
    document.getElementById("playerO").classList.toggle("active", game.currentTurn === "O" && !game.isOver);

    if (!game.isOver) {
        const isMyTurn = game.currentTurn === myMark;
        document.getElementById("turnIndicator").textContent = isMyTurn ? "Your turn!" : (isSinglePlayer ? "Thinking..." : "Opponent's turn...");
    } else {
        if (!_gameOver) {
            _gameOver = true;
            document.getElementById("turnIndicator").textContent = "";
            let msg;
            if (!game.winner) { msg = "It's a draw!"; playDrawSound(); }
            else if (game.winner === myMark) { msg = "You win! 🎉"; launchConfetti(); playWinSound(); }
            else { msg = "You lose 😢"; playLoseSound(); }
            document.getElementById("resultText").textContent = msg;
            document.getElementById("resultOverlay").style.display = "flex";
            document.getElementById("rematchArea").style.display = "block";
            document.getElementById("playAgainBtn").disabled = false;
            document.getElementById("rematchStatus").textContent = "";
        }
    }
});

cells.forEach(cell => {
    cell.addEventListener("click", () => {
        const i = parseInt(cell.dataset.i);
        if (!cell.classList.contains("taken")) {
            connection.invoke("MakeMove", gameId, i);
        }
    });
});

// Opponent clicked "Play Again" first — prompt this player
connection.on("RematchRequested", requesterName => {
    document.getElementById("rematchStatus").textContent = requesterName + " wants to play again!";
});

// Both clicked — reset the board in place (marks are swapped by the server)
connection.on("RematchStarted", (newMark, newXName, newOName) => {
    myMark = newMark;
    document.getElementById("xName").textContent = newXName;
    document.getElementById("oName").textContent = newOName;
    document.getElementById("resultOverlay").style.display = "none";
    document.getElementById("rematchArea").style.display = "none";
    document.getElementById("rematchStatus").textContent = "";
    document.getElementById("turnIndicator").textContent = myMark === "X" ? "Your turn!" : "Opponent's turn...";
    document.getElementById("playerX").classList.toggle("active", true);
    document.getElementById("playerO").classList.remove("active");
    _gameOver = false;
    _prevBoard = Array(9).fill(null);
    cells.forEach(c => { c.textContent = ""; c.className = "cell"; });
});

// Opponent left — disable Play Again, show message
connection.on("OpponentLeft", () => {
    document.getElementById("rematchStatus").textContent = "Opponent left the game.";
    const btn = document.getElementById("playAgainBtn");
    if (btn) btn.style.display = "none";
    // If mid-game, show the overlay so the player isn't just staring at a frozen board
    if (!_gameOver) {
        _gameOver = true;
        document.getElementById("turnIndicator").textContent = "";
        document.getElementById("resultText").textContent = "Opponent left.";
        document.getElementById("resultOverlay").style.display = "flex";
        document.getElementById("rematchArea").style.display = "block";
        document.getElementById("playAgainBtn").style.display = "none";
        playLoseSound();
    }
});

document.getElementById("playAgainBtn").addEventListener("click", () => {
    if (isSinglePlayer) {
        connection.invoke("ReplaySinglePlayerTTT", gameId);
    } else {
        document.getElementById("playAgainBtn").disabled = true;
        document.getElementById("rematchStatus").textContent = "Waiting for opponent…";
        connection.invoke("RequestRematch", gameId);
    }
});

function goBack() {
    connection.invoke("LeaveGame", gameId).then(() => { window.location.href = "/lobby"; });
}

document.getElementById("backBtn").onclick = goBack;
document.getElementById("backToLobby").onclick = goBack;

connection.start().then(() => {
    return connection.invoke("JoinGame", gameId, myMark);
}).then(() => {
    document.getElementById("turnIndicator").textContent = myMark === "X" ? "Your turn!" : (isSinglePlayer ? "Thinking..." : "Opponent's turn...");
    document.getElementById("playerX").classList.toggle("active", true);
    if (!isSinglePlayer) initChat(connection, gameId, false);
});

function initChat(conn, groupId) {
    let chatOpen = false;
    let unread = 0;
    const toggle = document.getElementById('chatToggle');
    const panel = document.getElementById('chatPanel');
    const close = document.getElementById('chatClose');
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const msgs = document.getElementById('chatMessages');
    const badge = document.getElementById('chatBadge');

    function escChat(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? 'flex' : 'none'; if (chatOpen) { unread = 0; badge.style.display = 'none'; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = 'none'; };

    function doSend() {
        const msg = input.value.trim();
        if (!msg) return;
        conn.invoke('SendChat', groupId, msg);
        input.value = '';
        playChatSendSound();
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    conn.on('ChatMessage', (name, message, time) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = '<span class="chat-name">' + escChat(name) + '</span> <span class="chat-text">' + escChat(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; playChatReceiveSound(); }
    });
}
