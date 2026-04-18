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
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 200; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 4 + Math.random() * 10;
        particles.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.45,
            vx: Math.cos(angle) * speed * (0.6 + Math.random()), vy: Math.sin(angle) * speed * -1.2 - Math.random() * 6,
            size: 4 + Math.random() * 6, color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 12,
            shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
            opacity: 1, gravity: 0.12 + Math.random() * 0.08, drag: 0.98 + Math.random() * 0.015,
            wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06 });
    }
    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;
        for (const p of particles) {
            p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5; p.y += p.vy;
            p.rotation += p.rotSpeed; p.wobble += p.wobbleSpeed;
            if (frame > 180) p.opacity -= 0.015;
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
        if (alive && frame < 300) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}

/* ============================================================
   Dice face unicode
   ============================================================ */
const dieFaces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/* ============================================================
   Client-side score calculator (mirrors server logic)
   ============================================================ */
function calcScore(category, dice, settings) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) counts[d]++;
    const sum = dice.reduce((a, b) => a + b, 0);
    const hasStraight = (len) => {
        const u = [...new Set(dice)].sort((a, b) => a - b);
        let run = 1, max = 1;
        for (let i = 1; i < u.length; i++) {
            if (u[i] === u[i - 1] + 1) { run++; max = Math.max(max, run); }
            else run = 1;
        }
        return max >= len;
    };
    switch (category) {
        case 'ones':   return dice.filter(d => d === 1).length * 1;
        case 'twos':   return dice.filter(d => d === 2).length * 2;
        case 'threes': return dice.filter(d => d === 3).length * 3;
        case 'fours':  return dice.filter(d => d === 4).length * 4;
        case 'fives':  return dice.filter(d => d === 5).length * 5;
        case 'sixes':  return dice.filter(d => d === 6).length * 6;
        case 'threeOfAKind': return counts.some(c => c >= 3) ? sum : 0;
        case 'fourOfAKind':  return counts.some(c => c >= 4) ? sum : 0;
        case 'fullHouse':    return counts.includes(3) && counts.includes(2) ? (settings?.fullHouseScore ?? 25) : 0;
        case 'smallStraight': return hasStraight(4) ? (settings?.smallStraightScore ?? 30) : 0;
        case 'largeStraight': return hasStraight(5) ? (settings?.largeStraightScore ?? 40) : 0;
        case 'yahtzee':       return counts.some(c => c === 5) ? (settings?.yahtzeeScore ?? 50) : 0;
        case 'chance':        return sum;
        default: return 0;
    }
}

/* ============================================================
   Categories
   ============================================================ */
const upperCats = ['ones','twos','threes','fours','fives','sixes'];
const lowerCats = ['threeOfAKind','fourOfAKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
const catNames = {
    ones:'Ones', twos:'Twos', threes:'Threes', fours:'Fours', fives:'Fives', sixes:'Sixes',
    threeOfAKind:'3 of a Kind', fourOfAKind:'4 of a Kind', fullHouse:'Full House',
    smallStraight:'Sm Straight', largeStraight:'Lg Straight', yahtzee:'Yahtzee', chance:'Chance'
};
const catDescs = {
    threeOfAKind:'3 matching — sum all', fourOfAKind:'4 matching — sum all',
    fullHouse:'3+2 combo', smallStraight:'4 in a row', largeStraight:'5 in a row',
    yahtzee:'All 5 same', chance:'Sum of all'
};

/* ============================================================
   Yahtzee N-Player Game
   ============================================================ */
const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const gameId = sessionStorage.getItem("gameId");
const myName = sessionStorage.getItem("myName");
let currentRoom = null;

const playerColors = [
    'var(--accent)', 'var(--accent2)', 'var(--accent3)', '#ffcb47', '#ff8a47',
    '#47d4ff', '#b388ff', '#ff80ab', '#69f0ae', '#ffd740',
    '#7c6aff', '#ff5c8a', '#36d6c3', '#ffcb47', '#ff8a47',
    '#47d4ff', '#b388ff', '#ff80ab', '#69f0ae', '#ffd740'
];

function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function totalScore(scores, settings) {
    let t = 0;
    for (const k in scores) if (scores[k] !== null && scores[k] !== undefined) t += scores[k];
    const u = upperCats.reduce((s, c) => s + (scores[c] ?? 0), 0);
    if (u >= (settings?.upperBonusThreshold ?? 63)) t += (settings?.upperBonusPoints ?? 35);
    return t;
}

function buildDice(numDice) {
    const row = document.getElementById("diceRow");
    row.innerHTML = "";
    for (let i = 0; i < numDice; i++) {
        const d = document.createElement("div");
        d.className = "die";
        d.dataset.i = i;
        d.innerHTML = '<span class="die-face">?</span>';
        d.addEventListener("click", () => connection.invoke("YahtzeeToggleHold", gameId, i));
        row.appendChild(d);
    }
}

function buildScorecard(players, settings) {
    const sc = document.getElementById("scorecard");
    const n = players.length;
    const colW = n <= 4 ? '72px' : n <= 8 ? '56px' : '44px';
    const cols = '1fr ' + Array(n).fill(colW).join(' ');

    let html = '<div class="scorecard-header" style="grid-template-columns:' + cols + '">';
    html += '<span class="sc-cat-label">Category</span>';
    players.forEach((p, i) => {
        html += '<span class="sc-player-label" style="color:' + playerColors[i] + '">' + escapeHtml(p.name) + '</span>';
    });
    html += '</div>';

    function catRow(cat, section) {
        const desc = catDescs[cat] ? '<span class="sc-desc">' + catDescs[cat] + '</span>' : '';
        let row = '<div class="sc-row" data-cat="' + cat + '" style="grid-template-columns:' + cols + '">';
        row += '<span class="sc-cat">' + catNames[cat] + desc + '</span>';
        players.forEach((p, i) => {
            row += '<span class="sc-val" data-pi="' + i + '">—</span>';
        });
        row += '</div>';
        return row;
    }

    html += '<div class="scorecard-section-title">Upper Section</div>';
    upperCats.forEach(c => html += catRow(c));

    // Bonus row
    html += '<div class="sc-row sc-bonus" style="grid-template-columns:' + cols + '"><span class="sc-cat">Bonus (≥' + (settings?.upperBonusThreshold ?? 63) + ')</span>';
    players.forEach((p, i) => html += '<span class="sc-val" data-bonus="' + i + '">0</span>');
    html += '</div>';

    html += '<div class="scorecard-section-title">Lower Section</div>';
    lowerCats.forEach(c => html += catRow(c));

    // Total row
    html += '<div class="sc-row sc-total" style="grid-template-columns:' + cols + '"><span class="sc-cat">TOTAL</span>';
    players.forEach((p, i) => html += '<span class="sc-val" data-total="' + i + '">0</span>');
    html += '</div>';

    sc.innerHTML = html;

    // Attach click handlers to category rows
    sc.querySelectorAll('.sc-row[data-cat]').forEach(row => {
        row.addEventListener('click', () => {
            if (!currentRoom || currentRoom.isOver) return;
            const myIdx = currentRoom.players.findIndex(p => p.name === myName);
            if (currentRoom.currentPlayerIndex !== myIdx) return;
            const rollsPerTurn = currentRoom.settings?.rollsPerTurn ?? 3;
            if (currentRoom.rollsLeft === rollsPerTurn) return;
            const cat = row.dataset.cat;
            const scores = currentRoom.players[myIdx].scores;
            if (scores[cat] !== null && scores[cat] !== undefined) return;

            connection.invoke("YahtzeeScore", gameId, cat);
        });
    });
}

function renderPlayerBar(room) {
    const bar = document.getElementById("playerBar");
    bar.innerHTML = "";
    room.players.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "player-bar-item" + (i === room.currentPlayerIndex && !room.isOver ? " active" : "");
        if (p.name === myName) el.classList.add("is-me");
        el.style.borderColor = playerColors[i];
        el.innerHTML = '<span class="player-bar-name" style="color:' + playerColors[i] + '">' + escapeHtml(p.name) + '</span>' +
            '<span class="player-bar-score">' + totalScore(p.scores, room.settings) + '</span>';
        bar.appendChild(el);
    });
}

let scorecardBuilt = false;

connection.on("YahtzeeUpdated", room => {
    currentRoom = room;
    const myIdx = room.players.findIndex(p => p.name === myName);
    const isMyTurn = room.currentPlayerIndex === myIdx;
    const rollsPerTurn = room.settings?.rollsPerTurn ?? 3;
    const numDice = room.settings?.numberOfDice ?? 5;

    if (!scorecardBuilt) {
        buildDice(numDice);
        buildScorecard(room.players, room.settings);
        scorecardBuilt = true;
    }

    renderPlayerBar(room);

    // Dice
    const diceEls = document.querySelectorAll(".die");
    room.dice.forEach((val, i) => {
        if (i >= diceEls.length) return;
        const el = diceEls[i];
        const face = el.querySelector(".die-face");
        face.textContent = val === 0 ? "?" : (dieFaces[val] || val);
        el.classList.toggle("held", room.held[i]);
        if (val > 0 && !el.dataset.shown) {
            el.classList.add("die-roll");
            setTimeout(() => el.classList.remove("die-roll"), 400);
        }
        el.dataset.shown = val > 0 ? "1" : "";
    });

    // Rolls
    document.getElementById("rollsLeft").textContent = "(" + room.rollsLeft + ")";
    const rollBtn = document.getElementById("rollBtn");
    rollBtn.disabled = !isMyTurn || room.rollsLeft <= 0 || room.isOver;

    // Turn indicator
    if (!room.isOver) {
        const curName = room.players[room.currentPlayerIndex]?.name || "?";
        document.getElementById("turnIndicator").textContent = isMyTurn ? "Your turn!" : curName + "'s turn...";
    }

    // Scorecard values
    const hasDice = room.dice.some(d => d > 0);
    const canScore = isMyTurn && room.rollsLeft < rollsPerTurn && !room.isOver && hasDice;

    document.querySelectorAll('.sc-row[data-cat]').forEach(row => {
        const cat = row.dataset.cat;
        room.players.forEach((p, i) => {
            const cell = row.querySelector('[data-pi="' + i + '"]');
            if (!cell) return;
            const val = p.scores[cat];
            cell.textContent = val !== null && val !== undefined ? val : "—";
            cell.classList.remove("sc-scoreable", "sc-invalid");
            row.classList.remove("sc-row-invalid");

            if (canScore && i === myIdx && (val === null || val === undefined)) {
                const preview = calcScore(cat, room.dice, room.settings);
                cell.classList.add("sc-scoreable");
                cell.innerHTML = '<span class="sc-preview">' + (preview > 0 ? '+' + preview : '0') + '</span>';
            }
        });
    });

    // Bonus + totals
    room.players.forEach((p, i) => {
        const bonusEl = document.querySelector('[data-bonus="' + i + '"]');
        const totalEl = document.querySelector('[data-total="' + i + '"]');
        if (bonusEl) {
            const upper = upperCats.reduce((s, c) => s + (p.scores[c] ?? 0), 0);
            const threshold = room.settings?.upperBonusThreshold ?? 63;
            bonusEl.textContent = upper >= threshold ? (room.settings?.upperBonusPoints ?? 35) : upper + "/" + threshold;
        }
        if (totalEl) totalEl.textContent = totalScore(p.scores, room.settings);
    });

    // Game over
    if (room.isOver) {
        document.getElementById("turnIndicator").textContent = "";
        let msg;
        if (room.winnerName === myName) { msg = "You win! 🎉"; launchConfetti(); }
        else msg = (room.winnerName || "Nobody") + " wins!";
        document.getElementById("resultText").textContent = msg;
        // Final scoreboard
        const fs = document.getElementById("finalScores");
        fs.innerHTML = room.players
            .map(p => ({ name: p.name, score: totalScore(p.scores, room.settings) }))
            .sort((a, b) => b.score - a.score)
            .map((p, i) => '<div class="final-score-row">' + (i + 1) + '. ' + escapeHtml(p.name) + ' — <strong>' + p.score + '</strong></div>')
            .join('');
        document.getElementById("resultOverlay").style.display = "flex";
    }
});

// Roll button
document.getElementById("rollBtn").addEventListener("click", () => {
    connection.invoke("YahtzeeRoll", gameId);
});

// Navigation
function goBack() {
    connection.invoke("LeaveYahtzee", gameId).then(() => { window.location.href = "/lobby"; });
}
document.getElementById("backBtn").onclick = goBack;
document.getElementById("backToLobby").onclick = goBack;

// Connect
connection.start().then(() => {
    return connection.invoke("RejoinYahtzeeRoom", gameId);
}).then(() => {
    document.getElementById("turnIndicator").textContent = "Loading game...";
    initChat(connection, gameId, false);
});

function initChat(conn, groupId, isLobby) {
    let chatOpen = false;
    let unread = 0;
    const toggle = document.getElementById('chatToggle');
    const panel = document.getElementById('chatPanel');
    const close = document.getElementById('chatClose');
    const input = document.getElementById('chatInput');
    const send = document.getElementById('chatSend');
    const msgs = document.getElementById('chatMessages');
    const badge = document.getElementById('chatBadge');

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
        el.innerHTML = '<span class="chat-name">' + escapeHtml(name) + '</span> <span class="chat-text">' + escapeHtml(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; }
    });
}
