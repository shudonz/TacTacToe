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

    const PARTICLE_COUNT = 200;
    const particles = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 10;
        particles.push({
            x: w / 2 + (Math.random() - 0.5) * w * 0.3,
            y: h * 0.45,
            vx: Math.cos(angle) * speed * (0.6 + Math.random()),
            vy: Math.sin(angle) * speed * -1.2 - Math.random() * 6,
            size: 4 + Math.random() * 6,
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            rotation: Math.random() * 360,
            rotSpeed: (Math.random() - 0.5) * 12,
            shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
            opacity: 1,
            gravity: 0.12 + Math.random() * 0.08,
            drag: 0.98 + Math.random() * 0.015,
            wobble: Math.random() * Math.PI * 2,
            wobbleSpeed: 0.03 + Math.random() * 0.06
        });
    }

    let frame = 0;
    const MAX_FRAMES = 300;

    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;

        for (const p of particles) {
            p.vy += p.gravity;
            p.vx *= p.drag;
            p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5;
            p.y += p.vy;
            p.rotation += p.rotSpeed;
            p.wobble += p.wobbleSpeed;

            if (frame > MAX_FRAMES * 0.6) {
                p.opacity -= 0.015;
            }
            if (p.opacity <= 0) continue;
            alive = true;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.globalAlpha = Math.max(0, p.opacity);
            ctx.fillStyle = p.color;

            if (p.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.shape === 'rect') {
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            } else {
                ctx.fillRect(-p.size / 2, -1, p.size, 2.5);
            }
            ctx.restore();
        }

        frame++;
        if (alive && frame < MAX_FRAMES) {
            requestAnimationFrame(draw);
        } else {
            canvas.remove();
        }
    }

    requestAnimationFrame(draw);

    // Second burst slightly delayed for layered effect
    setTimeout(() => {
        for (let i = 0; i < 80; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 8;
            particles.push({
                x: w * (0.2 + Math.random() * 0.6),
                y: h * 0.3,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed * -1.5 - 3,
                size: 3 + Math.random() * 5,
                color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 15,
                shape: Math.random() < 0.5 ? 'circle' : 'strip',
                opacity: 1,
                gravity: 0.14,
                drag: 0.985,
                wobble: Math.random() * Math.PI * 2,
                wobbleSpeed: 0.04 + Math.random() * 0.05
            });
        }
    }, 350);

    window.addEventListener('resize', () => {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
    }, { once: true });
}

/* ============================================================
   Game Logic
   ============================================================ */
const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const gameId = sessionStorage.getItem("gameId");
const myMark = sessionStorage.getItem("myMark");

document.getElementById("xName").textContent = sessionStorage.getItem("xName");
document.getElementById("oName").textContent = sessionStorage.getItem("oName");

const cells = document.querySelectorAll(".cell");

connection.on("GameUpdated", game => {
    game.board.forEach((val, i) => {
        cells[i].textContent = val || "";
        cells[i].className = "cell" + (val ? " taken " + val.toLowerCase() : "");
    });

    document.getElementById("playerX").classList.toggle("active", game.currentTurn === "X" && !game.isOver);
    document.getElementById("playerO").classList.toggle("active", game.currentTurn === "O" && !game.isOver);

    if (!game.isOver) {
        const isMyTurn = game.currentTurn === myMark;
        document.getElementById("turnIndicator").textContent = isMyTurn ? "Your turn!" : "Opponent's turn...";
    } else {
        document.getElementById("turnIndicator").textContent = "";
        let msg;
        if (!game.winner) msg = "It's a draw!";
        else if (game.winner === myMark) { msg = "You win! 🎉"; launchConfetti(); }
        else msg = "You lose 😢";
        document.getElementById("resultText").textContent = msg;
        document.getElementById("resultOverlay").style.display = "flex";
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

function goBack() {
    connection.invoke("LeaveGame", gameId).then(() => { window.location.href = "/lobby"; });
}

document.getElementById("backBtn").onclick = goBack;
document.getElementById("backToLobby").onclick = goBack;

connection.start().then(() => {
    return connection.invoke("JoinGame", gameId, myMark);
}).then(() => {
    document.getElementById("turnIndicator").textContent = myMark === "X" ? "Your turn!" : "Opponent's turn...";
    document.getElementById("playerX").classList.toggle("active", true);
    initChat(connection, gameId, false);
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
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    conn.on('ChatMessage', (name, message, time) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = '<span class="chat-name">' + escChat(name) + '</span> <span class="chat-text">' + escChat(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}
