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
                rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 12,
                shape: Math.random() < 0.4 ? 'circle' : Math.random() < 0.7 ? 'rect' : 'strip',
                opacity: 1, gravity: 0.12 + Math.random() * 0.08, drag: 0.98 + Math.random() * 0.015,
                wobble: Math.random() * Math.PI * 2, wobbleSpeed: 0.03 + Math.random() * 0.06,
                fadeStart
            });
        }
    }

    // Wave 1 — centre burst
    spawn(200, w / 2 + (Math.random() - 0.5) * w * 0.3, h * 0.45, 1.0, 180);
    // Wave 2 — left and right sides
    setTimeout(() => { spawn(90, w * 0.12, h * 0.4, 0.9, 160); spawn(90, w * 0.88, h * 0.4, 0.9, 160); }, 300);
    // Wave 3 — rain from top
    setTimeout(() => { for (let i = 0; i < 60; i++) spawn(1, Math.random() * w, -10, 0.5, 120); }, 550);

    let frame = 0;
    function draw() {
        ctx.clearRect(0, 0, w, h);
        let alive = false;
        for (const p of particles) {
            p.vy += p.gravity; p.vx *= p.drag; p.vy *= p.drag;
            p.x += p.vx + Math.sin(p.wobble) * 1.5; p.y += p.vy;
            p.rotation += p.rotSpeed; p.wobble += p.wobbleSpeed;
            if (frame > (p.fadeStart || 180)) p.opacity -= 0.015;
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
        if (alive && frame < 360) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
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
function _noise(start, dur, vol) {
    const buf = _ac.createBuffer(1, Math.ceil(_ac.sampleRate * dur), _ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1);
    const src = _ac.createBufferSource();
    const gain = _ac.createGain();
    const filter = _ac.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 1200; filter.Q.value = 0.8;
    src.buffer = buf; src.connect(filter); filter.connect(gain); gain.connect(_ac.destination);
    gain.gain.setValueAtTime(vol, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.start(start); src.stop(start + dur + 0.05);
}

function playDiceRollSound() {
    _resumeAudio();
    const t = _ac.currentTime;
    // Extended rattle: 14 noise bursts spread over ~1s
    for (let i = 0; i < 14; i++) {
        const spacing = i < 5 ? 0.05 : i < 10 ? 0.07 : 0.11;
        const vol = i < 8 ? 0.22 + Math.random() * 0.14 : 0.12 + Math.random() * 0.08;
        _noise(t + i * spacing, 0.07 + Math.random() * 0.04, vol);
    }
    // Impact thud at the end
    _tone(120, 'sine', t + 1.1, 0.12, 0.35);
    _tone(90,  'sine', t + 1.18, 0.1, 0.25);
}
function playHoldSound() {
    _resumeAudio();
    _tone(660, 'square', _ac.currentTime, 0.07, 0.18);
    _tone(880, 'square', _ac.currentTime + 0.05, 0.06, 0.12);
}
function playUnholdSound() {
    _resumeAudio();
    _tone(440, 'square', _ac.currentTime, 0.07, 0.15);
}
function playScoreSound(points, isYahtzee) {
    _resumeAudio();
    const t = _ac.currentTime;
    if (isYahtzee) {
        // Special multi-burst fanfare for Yahtzee!
        [523, 659, 784, 1047, 1319].forEach((f, i) => _tone(f, 'sine', t + i * 0.09, 0.35, 0.38));
        setTimeout(() => {
            _resumeAudio();
            const t2 = _ac.currentTime;
            [784, 1047, 1319, 1568].forEach((f, i) => _tone(f, 'triangle', t2 + i * 0.08, 0.3, 0.3));
        }, 600);
    } else if (points >= 40) {
        [523, 659, 784, 1047].forEach((f, i) => _tone(f, 'sine', t + i * 0.1, 0.28, 0.32));
    } else if (points >= 20) {
        [440, 554, 659].forEach((f, i) => _tone(f, 'sine', t + i * 0.1, 0.22, 0.28));
    } else if (points > 0) {
        [440, 550].forEach((f, i) => _tone(f, 'sine', t + i * 0.1, 0.18, 0.25));
    } else {
        _tone(240, 'sine', t, 0.32, 0.2);
        _tone(200, 'sine', t + 0.18, 0.28, 0.15);
    }
}
function playTurnSound() {
    _resumeAudio();
    _tone(660, 'sine', _ac.currentTime, 0.12, 0.2);
    _tone(880, 'sine', _ac.currentTime + 0.1, 0.12, 0.2);
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
   Realistic SVG dice faces — white background, black dots
   Dot positions follow the standard Western die layout.
   viewBox is 100×100; dots are 9px radius circles.
   ============================================================ */
const DOT_POSITIONS = {
    1: [[50,50]],
    2: [[25,25],[75,75]],
    3: [[25,25],[50,50],[75,75]],
    4: [[25,25],[75,25],[25,75],[75,75]],
    5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
    6: [[25,22],[75,22],[25,50],[75,50],[25,78],[75,78]]
};

function dieSVG(value, held) {
    if (!value || value < 1 || value > 6) {
        // Blank / unrolled placeholder
        return '<div class="die-face die-face-blank">?</div>';
    }
    const dots = DOT_POSITIONS[value];
    const dotColor   = held ? '#0F2533' : '#1a1a1a';
    const fillColor  = held ? '#d4f5f7' : '#ffffff';
    const strokeColor = held ? '#12919E' : '#cccccc';
    const strokeW     = held ? '3' : '2';

    const dotsSVG = dots.map(([cx, cy]) =>
        `<circle cx="${cx}" cy="${cy}" r="9" fill="${dotColor}"/>`
    ).join('');

    return `<div class="die-face">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="3" width="94" height="94" rx="16" ry="16"
                  fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeW}"/>
            ${dotsSVG}
        </svg>
    </div>`;
}

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
let gameId = sessionStorage.getItem("gameId");
const myName = sessionStorage.getItem("myName");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!gameId || !myName) {
    window.location.replace("/lobby");
    throw new Error("Missing Yahtzee game session data");
}

if (isSinglePlayer) {
    document.getElementById("chatWidget").style.display = "none";
}
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
        d.innerHTML = dieSVG(0, false);
        d.addEventListener("click", () => {
            if (currentRoom && currentRoom.held && currentRoom.held[i]) playUnholdSound();
            else playHoldSound();
            connection.invoke("YahtzeeToggleHold", gameId, i);
        });
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

            const preview = calcScore(cat, currentRoom.dice, currentRoom.settings);
            const isYahtzee = cat === 'yahtzee' && preview === (currentRoom.settings?.yahtzeeScore ?? 50);
            playScoreSound(preview, isYahtzee);
            // Immediate confetti for Yahtzee! — don't wait for server round-trip
            if (isYahtzee) launchConfetti();
            connection.invoke("YahtzeeScore", gameId, cat);
        });
    });
}

function renderPlayerBar(room) {
    const bar = document.getElementById("playerBar");
    bar.innerHTML = "";
    fetchAvatars(room.players.map(p => p.name)); // async — re-render handled by next update
    room.players.forEach((p, i) => {
        const el = document.createElement("div");
        const disconnected = !p.connected;
        el.className = "player-bar-item" + (i === room.currentPlayerIndex && !room.isOver ? " active" : "") + (disconnected ? " player-disconnected" : "");
        if (p.name === myName) el.classList.add("is-me");
        el.style.borderColor = playerColors[i];
        const displayName = (isSinglePlayer && p.name !== myName) ? p.name + " 🤖" : p.name;
        el.innerHTML = avatarHtml(p.name, 'sm') +
            '<span class="player-bar-name" style="color:' + playerColors[i] + '">' + escapeHtml(displayName) + (disconnected ? ' <span class="disconnected-tag">left</span>' : '') + '</span>' +
            '<span class="player-bar-score">' + totalScore(p.scores, room.settings) + '</span>';
        bar.appendChild(el);
    });
}

let scorecardBuilt = false;
let _prevTurnIdx = -1;
let _gameOverSoundPlayed = false;
let _gameOverEventFired = false;
let _prevDice = [];
let _diceAnimating = false;
let _prevRollsLeft = -1;
// Tracks in-flight per-die animation timers so they can be cancelled on the next update
let _diceAnimTimers = []; // Array of { tid, ivid } — one entry per queued animation
let _upperBonusEarned = false; // fire confetti only once when bonus is first earned

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

    // Play your-turn ping when the turn switches to you
    const turnJustChanged = room.currentPlayerIndex !== _prevTurnIdx && _prevTurnIdx !== -1;
    if (!room.isOver && isMyTurn && turnJustChanged) {
        playTurnSound();
    }
    _prevTurnIdx = room.currentPlayerIndex;

    // Cancel any in-flight animations from a previous update (e.g. bot's turn) before
    // rendering new state, so stale intervals cannot overwrite the current dice display.
    _diceAnimTimers.forEach(t => {
        if (t.tid  != null) clearTimeout(t.tid);
        if (t.ivid != null) clearInterval(t.ivid);
    });


    // A roll just happened if rollsLeft decreased within the same turn, or if the turn
    // just changed and a roll has already been made (rollsLeft < rollsPerTurn).
    // Using this instead of value-change detection ensures dice that roll the same
    // number as before still play their animation.
    const rollJustHappened = room.rollsLeft < _prevRollsLeft ||
        (turnJustChanged && room.rollsLeft < (room.settings?.rollsPerTurn ?? 3));
    _prevRollsLeft = room.rollsLeft;

    // Dice
    const diceEls = document.querySelectorAll(".die");
    room.dice.forEach((val, i) => {
        if (i >= diceEls.length) return;
        const el = diceEls[i];
        el.classList.remove("die-rolling", "die-land");
        el.classList.toggle("held", room.held[i]);

        // Animate if: a roll just happened AND this die was not held AND it has a value.
        // Falls back to value-change check for the very first roll (no prevRollsLeft yet).
        const prevVal = _prevDice[i] ?? 0;
        const shouldAnimate = val > 0 && !room.held[i] &&
            (rollJustHappened || val !== prevVal || !el.dataset.shown);

        if (shouldAnimate) {
            // Stagger each die slightly for a cascading feel
            const delay = i * 70;
            const cycleCount = 9 + Math.floor(Math.random() * 5);
            const cycleMs = 80;
            let tick = 0;

            el.style.setProperty("--land-spin", (Math.random() < 0.5 ? 1 : -1) * (10 + Math.floor(Math.random() * 15)) + "deg");

            // Show a placeholder while waiting for the stagger delay
            el.innerHTML = dieSVG(val, room.held[i]);

            const timers = { tid: null, ivid: null };
            _diceAnimTimers.push(timers);

            timers.tid = setTimeout(() => {
                timers.tid = null;
                el.classList.add("die-rolling");
                timers.ivid = setInterval(() => {
                    tick++;
                    if (tick < cycleCount) {
                        el.innerHTML = dieSVG(Math.ceil(Math.random() * 6), false);
                    } else {
                        clearInterval(timers.ivid);
                        timers.ivid = null;
                        el.classList.remove("die-rolling");
                        el.innerHTML = dieSVG(val, room.held[i]);
                        void el.offsetWidth; // force reflow
                        el.classList.add("die-land");
                        setTimeout(() => el.classList.remove("die-land"), 500);
                    }
                }, cycleMs);
            }, delay);
        } else {
            // Held die, no change, or value reset to 0 — render immediately
            el.innerHTML = dieSVG(val, room.held[i]);
        }

        el.dataset.shown = val > 0 ? "1" : "";
    });
    _prevDice = [...room.dice];

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
            const hasBonus = upper >= threshold;
            bonusEl.textContent = hasBonus ? (room.settings?.upperBonusPoints ?? 35) : upper + "/" + threshold;
            // Pop confetti the first time MY upper bonus is earned
            if (hasBonus && !_upperBonusEarned && p.name === myName) {
                _upperBonusEarned = true;
                launchConfetti();
                showToast("🎉 Upper bonus earned!");
            }
        }
        if (totalEl) totalEl.textContent = totalScore(p.scores, room.settings);
    });

    // Game over
    if (room.isOver) {
        document.getElementById("turnIndicator").textContent = "";
        let msg;
        if (room.winnerName === myName) { msg = "You win! 🎉"; launchConfetti(); if (!_gameOverSoundPlayed) { playWinSound(); _gameOverSoundPlayed = true; } }
        else { msg = (room.winnerName || "Nobody") + " wins!"; if (!_gameOverSoundPlayed) { playLoseSound(); _gameOverSoundPlayed = true; } }
        document.getElementById("resultText").textContent = msg;
        // Final scoreboard
        const fs = document.getElementById("finalScores");
        const medals = ['🥇','🥈','🥉'];
        fs.innerHTML = room.players
            .map(p => ({ name: p.name, score: totalScore(p.scores, room.settings) }))
            .sort((a, b) => b.score - a.score)
            .map((p, i) => '<div class="final-score-row">' + (medals[i] || (i+1)+'.') + ' ' + avatarHtml(p.name, 'xs') + escapeHtml(p.name) + ' — <strong>' + p.score + '</strong></div>')
            .join('');
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event('gameOver')); }
    }
});

connection.on("PlayerLeft", name => {
    showToast("⚠️ " + escapeHtml(name) + " left the game");
});

connection.on("YahtzeeSinglePlayerStarted", newGameId => {
    gameId = newGameId;
    sessionStorage.setItem("gameId", newGameId);
});

connection.on("YahtzeeRoomUpdated", () => {
    window.location.href = "/yahtzee-room";
});

// Roll button
document.getElementById("rollBtn").addEventListener("click", () => {
    playDiceRollSound();
    connection.invoke("YahtzeeRoll", gameId);
});

// Navigation
function goBack() {
    connection.invoke("LeaveYahtzee", gameId).then(() => { window.location.href = "/lobby"; });
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("backBtn").onclick = goBack;
    document.getElementById("backToLobby").onclick = goBack;
    document.getElementById("playAgainBtn").onclick = () => {
        if (isSinglePlayer) {
            const difficulty = currentRoom?.players?.find(p => p.isBot)?.aiDifficulty || "regular";
            document.getElementById("resultOverlay").style.display = "none";
            _gameOverEventFired = false;
            _gameOverSoundPlayed = false;
            scorecardBuilt = false;
            currentRoom = null;
            connection.invoke("StartYahtzeeSinglePlayer", difficulty).catch(e => console.error(e));
        } else {
            window.location.href = "/yahtzee-room";
        }
    };
});

// Connect
document.getElementById("turnIndicator").textContent = "Loading game...";
connection.start().then(async () => {
    if (!isSinglePlayer) initChat(connection, gameId, false);
    // Pre-fetch own avatar; rest fetched when room state arrives
    await fetchAvatars([myName]);
    return connection.invoke("RejoinYahtzeeRoom", gameId);
});

function showToast(msg) {
    const t = document.createElement("div");
    t.className = "game-toast";
    t.innerHTML = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("game-toast-show"));
    setTimeout(() => {
        t.classList.remove("game-toast-show");
        t.addEventListener("transitionend", () => t.remove(), { once: true });
    }, 4000);
}

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
        playChatSendSound();
    }
    send.onclick = doSend;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

    conn.on('ChatMessage', (name, message, time) => {
        const el = document.createElement('div');
        el.className = 'chat-msg';
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + escapeHtml(name) + '</span> <span class="chat-text">' + escapeHtml(message) + '</span>';
        msgs.appendChild(el);
        msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = 'inline-flex'; playChatReceiveSound(); }
    });
}
