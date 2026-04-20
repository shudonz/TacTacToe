/* ============================================================
   Slots — Vegas-style game client (3x3 multiline)
   ============================================================ */
const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("slotsRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Slots game room id");
}

const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "🔔", "⭐", "💎", "7️⃣"];
const LINE_NAMES = ["Top", "Middle", "Bottom", "Diagonal ↘", "Diagonal ↗"];
const PAYLINES = [
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    [[0, 0], [1, 1], [2, 2]],
    [[2, 0], [1, 1], [0, 2]],
];
const BET_PER_LINE_OPTIONS = [2, 5, 10, 25, 50];
const PAYLINE_OPTIONS = [1, 3, 5];
const BET_PER_LINE_OPTIONS_DESC = [...BET_PER_LINE_OPTIONS].sort((a, b) => b - a);
const PAYLINE_OPTIONS_DESC = [...PAYLINE_OPTIONS].sort((a, b) => b - a);

let myName = "";
let selectedBetPerLine = 5;
let selectedPaylines = 3;
let spinning = false;
let _lastBalance = null;
let _prevPhase = null;
let _prevSpun = false;
let _reelsAnimating = false;

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function totalBet() { return selectedBetPerLine * selectedPaylines; }
function hasValidReels(reels) { return Array.isArray(reels) && reels[0] && reels[0][0] >= 0; }
function reelEl(r, c) { return document.getElementById(`r${r}${c}`); }

/* ============================================================
   Sound Engine (Web Audio API — lazy init, fail-safe)
   ============================================================ */
let _ac = null;
function _resumeAudio() {
    try {
        if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
        if (_ac.state === "suspended") _ac.resume();
    } catch(e) {}
}
function _tone(freq, type, start, dur, vol = 0.18) {
    if (!_ac) return;
    try {
        const osc = _ac.createOscillator(), gain = _ac.createGain();
        osc.connect(gain); gain.connect(_ac.destination);
        osc.type = type; osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.start(start); osc.stop(start + dur + 0.05);
    } catch(e) {}
}
function _noise(start, dur, vol = 0.12, freq = 800) {
    if (!_ac) return;
    try {
        const buf = _ac.createBuffer(1, Math.ceil(_ac.sampleRate * dur), _ac.sampleRate);
        const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = _ac.createBufferSource(), gain = _ac.createGain(), filt = _ac.createBiquadFilter();
        filt.type = "bandpass"; filt.frequency.value = freq; filt.Q.value = 1.2;
        src.buffer = buf; src.connect(filt); filt.connect(gain); gain.connect(_ac.destination);
        gain.gain.setValueAtTime(vol, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        src.start(start); src.stop(start + dur + 0.05);
    } catch(e) {}
}
function soundLeverPull() { if (_ac) { const t = _ac.currentTime; _noise(t, 0.06, 0.25, 300); _tone(120, "sine", t, 0.12, 0.22); } }
function soundReelTick() { if (_ac) { const t = _ac.currentTime; _noise(t, 0.025, 0.09, 2200); _tone(1800, "square", t, 0.018, 0.04); } }
function soundReelStop(i) { if (_ac) { const t = _ac.currentTime; _tone(180 + i * 40, "sawtooth", t, 0.06, 0.2); _noise(t, 0.05, 0.15, 600); } }
function soundCoin() { if (_ac) { const t = _ac.currentTime; _tone(1400, "sine", t, 0.05, 0.12); _tone(1900, "sine", t + 0.04, 0.06, 0.09); } }
function soundSmallWin() { if (_ac) { const t = _ac.currentTime; [523, 659, 784, 1047].forEach((f, i) => _tone(f, "square", t + i * 0.1, 0.18, 0.14)); } }
function soundBigWin() {
    if (!_ac) return;
    const t = _ac.currentTime;
    [523, 659, 784, 1047, 784, 1047, 1319, 1047].forEach((f, i) => { _tone(f, "square", t + i * 0.11, 0.2, 0.14); _tone(f * 0.5, "sine", t + i * 0.11, 0.2, 0.08); });
    setTimeout(soundSmallWin, 900);
}
function soundBust() { if (_ac) { const t = _ac.currentTime; _tone(220, "sawtooth", t, 0.18, 0.2); _tone(180, "sawtooth", t + 0.1, 0.18, 0.2); _tone(140, "sawtooth", t + 0.2, 0.25, 0.2); } }
function soundClick() { if (_ac) _noise(_ac.currentTime, 0.03, 0.08, 1800); }

/* ============================================================
   Lights / VFX
   ============================================================ */
function initVegasLights() {
    const strip = document.getElementById("vegasLights");
    if (!strip) return;
    for (let i = 0; i < 28; i++) {
        const b = document.createElement("span");
        b.className = "vegas-bulb";
        b.style.animationDelay = (i * 0.05).toFixed(3) + "s";
        strip.appendChild(b);
    }
}
function flashVegasLights(color) {
    document.querySelectorAll(".vegas-bulb").forEach((b, i) => {
        setTimeout(() => {
            if (color) b.style.background = color;
            b.classList.add("vegas-bulb-flash");
            setTimeout(() => b.classList.remove("vegas-bulb-flash"), 400);
        }, i * 30);
    });
}
function launchCoinRain(big) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const coins = Array.from({ length: big ? 120 : 40 }, () => ({
        x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.4,
        r: big ? 10 + Math.random() * 10 : 6 + Math.random() * 6,
        vy: 3 + Math.random() * 5, vx: (Math.random() - 0.5) * 3,
        rot: Math.random() * Math.PI * 2, rotS: (Math.random() - 0.5) * 0.25,
        color: ["#fbbf24", "#f59e0b", "#fcd34d"][Math.floor(Math.random() * 3)], opacity: 1,
    }));
    let fr = 0;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height); let alive = false;
        for (const c of coins) {
            c.y += c.vy; c.x += c.vx; c.rot += c.rotS;
            if (fr > 90) c.opacity = Math.max(0, c.opacity - 0.015);
            if (c.y < canvas.height + 30 && c.opacity > 0) alive = true;
            ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.globalAlpha = c.opacity;
            ctx.beginPath(); ctx.ellipse(0, 0, c.r * (0.3 + Math.abs(Math.cos(c.rot)) * 0.7), c.r, 0, 0, Math.PI * 2);
            ctx.fillStyle = c.color; ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
        }
        fr++; if (alive && fr < 180) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}
const _confColors = ["#7c6aff", "#9b7aff", "#ff5c8a", "#fbbf24", "#36d6c3", "#ff8a47", "#47d4ff", "#fcd34d"];
function launchConfetti() {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight;
    const pts = Array.from({ length: 200 }, () => {
        const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 10;
        return { x: w/2, y: h*0.45, vx: Math.cos(a)*s, vy: Math.sin(a)*s*-1.2 - Math.random()*5,
            sz: 5 + Math.random()*6, color: _confColors[Math.floor(Math.random()*_confColors.length)],
            rot: Math.random()*360, rotS: (Math.random()-0.5)*14, op: 1, grav: 0.12+Math.random()*0.08 };
    });
    let fr = 0;
    function draw() {
        ctx.clearRect(0,0,w,h); let alive=false;
        for (const p of pts) {
            p.vy+=p.grav; p.vx*=0.985; p.vy*=0.985; p.x+=p.vx; p.y+=p.vy; p.rot+=p.rotS;
            if (fr>150) p.op=Math.max(0,p.op-0.018);
            if (p.op<=0) continue; alive=true;
            ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
            ctx.globalAlpha=p.op; ctx.fillStyle=p.color; ctx.fillRect(-p.sz/2,-p.sz/2,p.sz,p.sz*0.55); ctx.restore();
        }
        fr++; if (alive&&fr<280) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}

let _tickInterval = null;
function startReelTicks() { stopReelTicks(); _tickInterval = setInterval(() => soundReelTick(), 60); }
function stopReelTicks() { if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; } }

/* ============================================================
   Reel animation + paylines
   ============================================================ */

// One distinct, vivid color per payline (Top, Middle, Bottom, Diag↘, Diag↗)
const PAYLINE_COLORS = ["#4ade80", "#fbbf24", "#38bdf8", "#f472b6", "#fb923c"];

let _paylineAnimFrame = null;

function clearPaylineCanvas() {
    if (_paylineAnimFrame) { cancelAnimationFrame(_paylineAnimFrame); _paylineAnimFrame = null; }
    const canvas = document.getElementById("paylineCanvas");
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function drawPaylineOverlay(winningLines) {
    clearPaylineCanvas();
    if (!winningLines || !winningLines.length) return;

    const canvas = document.getElementById("paylineCanvas");
    const windowEl = canvas.parentElement;

    // Size canvas in physical pixels for crisp drawing
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = windowEl.offsetWidth  * dpr;
    canvas.height = windowEl.offsetHeight * dpr;
    canvas.style.width  = windowEl.offsetWidth  + "px";
    canvas.style.height = windowEl.offsetHeight + "px";

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Compute logical cell centers relative to the window container
    const parentRect = windowEl.getBoundingClientRect();
    const centers = [];
    for (let r = 0; r < 3; r++) {
        centers[r] = [];
        for (let c = 0; c < 3; c++) {
            const cell = reelEl(r, c);
            if (!cell) continue;
            const cr = cell.getBoundingClientRect();
            centers[r][c] = {
                x: cr.left - parentRect.left + cr.width  / 2,
                y: cr.top  - parentRect.top  + cr.height / 2,
            };
        }
    }

    const startTime = performance.now();

    function frame(now) {
        const elapsed = now - startTime;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const t = elapsed / 1000;
        // Fast pulse: 2 Hz sine, clamped to a nice range
        const alpha = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 2));

        winningLines.forEach(lineIdx => {
            const payline = PAYLINES[lineIdx];
            if (!payline) return;
            const color = PAYLINE_COLORS[lineIdx % PAYLINE_COLORS.length];

            // Gather points
            const pts = payline.map(([r, c]) => centers[r]?.[c]).filter(Boolean);
            if (pts.length < 2) return;

            // Extend the line slightly beyond the outer cells so it visually
            // "crosses" the edge cells rather than stopping at their centers.
            const dx = pts[pts.length - 1].x - pts[0].x;
            const dy = pts[pts.length - 1].y - pts[0].y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ext = 24; // pixels to extend past each end
            const startPt = { x: pts[0].x - (dx / len) * ext,  y: pts[0].y - (dy / len) * ext  };
            const endPt   = { x: pts[pts.length - 1].x + (dx / len) * ext, y: pts[pts.length - 1].y + (dy / len) * ext };

            ctx.save();
            ctx.globalAlpha = alpha;

            // Outer glow pass
            ctx.strokeStyle = color;
            ctx.lineWidth   = 12;
            ctx.lineCap     = "round";
            ctx.shadowColor = color;
            ctx.shadowBlur  = 22;
            ctx.beginPath();
            ctx.moveTo(startPt.x, startPt.y);
            pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
            ctx.lineTo(endPt.x, endPt.y);
            ctx.stroke();

            // Bright inner line
            ctx.globalAlpha = alpha * 0.95;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth   = 3;
            ctx.shadowBlur  = 6;
            ctx.beginPath();
            ctx.moveTo(startPt.x, startPt.y);
            pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
            ctx.lineTo(endPt.x, endPt.y);
            ctx.stroke();

            ctx.restore();
        });

        _paylineAnimFrame = requestAnimationFrame(frame);
    }

    _paylineAnimFrame = requestAnimationFrame(frame);
}

function clearPaylineHighlights() {
    document.querySelectorAll(".slots-reel.line-win, .slots-payline-badge.win").forEach(el => el.classList.remove("line-win", "win"));
    clearPaylineCanvas();
}
function renderPaylineLegend(activeLines, winning = []) {
    const legend = document.getElementById("paylineLegend");
    legend.innerHTML = "";
    for (let i = 0; i < LINE_NAMES.length; i++) {
        const b = document.createElement("span");
        b.className = "slots-payline-badge" + (i < activeLines ? " active" : "");
        b.textContent = `${i + 1}. ${LINE_NAMES[i]}`;
        if (winning.includes(i)) b.classList.add("win");
        b.dataset.line = String(i);
        legend.appendChild(b);
    }
}
function highlightWinningPaylines(winning = []) {
    clearPaylineHighlights();
    winning.forEach(lineIdx => {
        const line = PAYLINES[lineIdx];
        if (!line) return;
        line.forEach(([r, c]) => reelEl(r, c)?.classList.add("line-win"));
        document.querySelector(`.slots-payline-badge[data-line='${lineIdx}']`)?.classList.add("win");
    });
    drawPaylineOverlay(winning);
}
function animateReels(reels, onDone) {
    stopReelTicks();
    startReelTicks();
    _reelsAnimating = true;
    let finished = 0;
    const total = 9;
    for (let c = 0; c < 3; c++) {
        for (let r = 0; r < 3; r++) {
            const el = reelEl(r, c);
            if (!el) continue;
            el.classList.add("slots-reel-spinning");
            setTimeout(() => {
                soundReelStop(c);
                el.classList.remove("slots-reel-spinning");
                el.classList.add("slots-reel-landing");
                el.textContent = SYMBOLS[reels[r][c]];
                setTimeout(() => {
                    el.classList.remove("slots-reel-landing");
                    el.classList.add("slots-reel-bounce");
                    setTimeout(() => {
                        el.classList.remove("slots-reel-bounce");
                        finished++;
                        if (finished >= total) { stopReelTicks(); _reelsAnimating = false; onDone?.(); }
                    }, 180);
                }, 70);
            }, 420 + c * 220 + r * 55);
        }
    }
}

function triggerWinEffect(totalMultiplier, winAmount) {
    if (winAmount <= 0 || totalMultiplier <= 0) return;
    if (totalMultiplier >= 70) {
        soundBigWin(); launchConfetti(); launchCoinRain(true); flashVegasLights("#fbbf24");
        const cab = document.getElementById("slotsCabinet"); cab.classList.add("slots-jackpot-shake");
        setTimeout(() => cab.classList.remove("slots-jackpot-shake"), 700);
        const win = document.getElementById("winLabel"); win.classList.add("slots-win-jackpot");
        setTimeout(() => win.classList.remove("slots-win-jackpot"), 2500);
    } else if (totalMultiplier >= 25) {
        soundBigWin(); launchCoinRain(true); flashVegasLights();
        const win = document.getElementById("winLabel"); win.classList.add("slots-win-big");
        setTimeout(() => win.classList.remove("slots-win-big"), 1800);
    } else if (totalMultiplier >= 8) {
        soundSmallWin(); launchCoinRain(false);
        const win = document.getElementById("winLabel"); win.classList.add("slots-win-small");
        setTimeout(() => win.classList.remove("slots-win-small"), 1800);
    } else {
        soundCoin();
    }
    tickBalance(winAmount);
}
function tickBalance(win) {
    if (win <= 0 || _lastBalance == null) return;
    const el = document.getElementById("myBalance");
    const base = _lastBalance - win;
    let curr = 0;
    const steps = Math.min(win, 35), inc = Math.ceil(win / steps);
    const id = setInterval(() => {
        curr = Math.min(curr + inc, win);
        el.textContent = "$" + (base + curr);
        if (curr < win) soundCoin(); else clearInterval(id);
    }, 45);
}

function formatReelsInline(reels) {
    if (!hasValidReels(reels)) return "";
    return reels.map(row => row.map(s => SYMBOLS[s]).join("")).join(" · ");
}
function getWinLabel(player) {
    const wins = Array.isArray(player.winningPaylines) ? player.winningPaylines : [];
    if (!wins.length) return "";
    if (wins.length > 3) return `${wins.length} lines hit!`;
    const names = wins.map(i => LINE_NAMES[i] || `Line ${i + 1}`).join(", ");
    return `${wins.length} line${wins.length > 1 ? "s" : ""} hit: ${names}`;
}
function syncBetDisplay() {
    document.getElementById("betDisplay").textContent = "$" + totalBet();
}
function applyAffordableSelection(balance) {
    if (balance <= 0) return;
    const bestLineChoice = PAYLINE_OPTIONS_DESC.find(lines => selectedBetPerLine * lines <= balance);
    selectedPaylines = bestLineChoice || 1;

    const bestBetPerLine = BET_PER_LINE_OPTIONS_DESC.find(bet => bet * selectedPaylines <= balance);
    selectedBetPerLine = bestBetPerLine || 1;

    document.querySelectorAll(".slots-line-chip").forEach(b => b.classList.toggle("active", Number(b.dataset.lines) === selectedPaylines));
    document.querySelectorAll(".slots-bet-chip").forEach(b => b.classList.toggle("active", Number(b.dataset.betPerLine) === selectedBetPerLine));
    syncBetDisplay();
}

/* ============================================================
   Main render
   ============================================================ */
function render(room) {
    const myPlayer = room.players.find(p => p.name === myName && !p.isBot);
    const totalRounds = room.settings.totalRounds;
    const isBetting = room.phase === 0;

    document.getElementById("roundLabel").textContent = "Round " + Math.min(room.roundsPlayed + 1, totalRounds) + " / " + totalRounds;
    const phaseEl = document.getElementById("phaseLabel");
    phaseEl.textContent = isBetting ? "🎲 Betting" : "🏆 Results";
    phaseEl.className = "slots-phase-label" + (isBetting ? "" : " slots-phase-results");

    if (_prevPhase === 1 && room.phase === 0) flashVegasLights();
    _prevPhase = room.phase;

    const sorted = [...room.players].sort((a, b) => b.balance - a.balance);
    const lb = document.getElementById("leaderboard");
    lb.innerHTML = '<div class="slots-lb-title">🏆 Leaderboard</div>';
    sorted.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "slots-lb-row" + (p.name === myName ? " is-me" : "");
        const medal = ["🥇", "🥈", "🥉"][i] || (i + 1) + ".";
        const reelStr = p.hasSpun && hasValidReels(p.reels) ? `<span class="slots-lb-reels">${formatReelsInline(p.reels)}</span>` : "";
        const lineStr = p.hasSpun && p.activePaylines ? `<span class="slots-lb-lines">${p.activePaylines}L @ $${p.betPerLine || 0}</span>` : "";
        const winStr = p.hasSpun && p.lastWin > 0 ? `<span class="slots-lb-win">+$${p.lastWin}</span>` : "";
        const bustStr = p.balance <= 0 ? '<span class="slots-lb-bust">BUST</span>' : "";
        row.innerHTML = '<span class="slots-lb-rank">' + medal + '</span>'
            + '<span class="slots-lb-name">' + esc(p.name) + (p.isBot ? " 🤖" : "") + '</span>'
            + lineStr + reelStr + winStr + bustStr
            + '<span class="slots-lb-balance' + (p.balance <= 0 ? ' slots-lb-balance-bust' : '') + '">$' + p.balance + '</span>';
        lb.appendChild(row);
    });

    if (myPlayer) {
        _lastBalance = myPlayer.balance;
        const justSpun = !_prevSpun && myPlayer.hasSpun;
        _prevSpun = myPlayer.hasSpun;

        const activeLines = myPlayer.activePaylines || selectedPaylines;
        renderPaylineLegend(activeLines, []);

        if (justSpun && hasValidReels(myPlayer.reels)) {
            animateReels(myPlayer.reels, () => {
                const winEl = document.getElementById("winLabel");
                const winning = Array.isArray(myPlayer.winningPaylines) ? myPlayer.winningPaylines : [];
                const label = getWinLabel(myPlayer);
                winEl.textContent = label || (myPlayer.lastWin > 0 ? "Win!" : "No win");
                if (myPlayer.lastWin > 0) {
                    highlightWinningPaylines(winning);
                    renderPaylineLegend(activeLines, winning);
                    triggerWinEffect(myPlayer.totalMultiplier || 0, myPlayer.lastWin);
                } else {
                    clearPaylineHighlights();
                    winEl.className = "slots-win-label slots-no-win";
                    if (myPlayer.balance <= 0) soundBust();
                }
            });
        } else if (!myPlayer.hasSpun) {
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) reelEl(r, c).textContent = "?";
            document.getElementById("winLabel").textContent = "";
            clearPaylineHighlights();
        } else if (!_reelsAnimating && myPlayer.lastWin > 0) {
            highlightWinningPaylines(myPlayer.winningPaylines || []);
            renderPaylineLegend(activeLines, myPlayer.winningPaylines || []);
        }

        if (!justSpun || myPlayer.lastWin === 0) document.getElementById("myBalance").textContent = "$" + myPlayer.balance;
        applyAffordableSelection(myPlayer.balance);

        const canSpin = isBetting && !myPlayer.hasSpun && myPlayer.balance > 0 && !room.isOver && totalBet() <= myPlayer.balance;
        document.getElementById("betArea").style.display = myPlayer.balance > 0 ? "" : "none";
        document.getElementById("bustMsg").style.display = myPlayer.balance <= 0 && !room.isOver ? "block" : "none";
        document.getElementById("spinBtn").disabled = !canSpin;
        document.getElementById("waitingMsg").style.display = (isBetting && myPlayer.hasSpun && !room.isOver && myPlayer.balance > 0) ? "block" : "none";
        spinning = myPlayer.hasSpun;
    }

    if (room.isOver) setTimeout(() => showResults(room, sorted), 1400);
}

function showResults(room, sorted) {
    const isWinner = room.winnerName === myName;
    document.getElementById("resultText").textContent = isWinner ? "🏆 You Win!" : room.winnerName === "🎰 The Machine" ? "😔 The House Wins!" : "🎰 Game Over!";
    const fs = document.getElementById("finalScores"); fs.innerHTML = "";
    sorted.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "slots-final-row" + (p.name === myName ? " is-me" : "");
        row.innerHTML = (["🥇", "🥈", "🥉"][i] || "") + " <strong>" + esc(p.name) + (p.isBot ? " 🤖" : "") + "</strong>: $" + p.balance;
        fs.appendChild(row);
    });
    document.getElementById("resultOverlay").style.display = "flex";
    if (isWinner) { soundBigWin(); launchConfetti(); launchCoinRain(true); } else soundBust();
}

function showToast(msg) {
    const t = document.createElement("div"); t.className = "game-toast"; t.innerHTML = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("game-toast-show"));
    setTimeout(() => { t.classList.remove("game-toast-show"); t.addEventListener("transitionend", () => t.remove(), { once: true }); }, 4000);
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
    initVegasLights();
    renderPaylineLegend(selectedPaylines, []);
    const res = await fetch("/api/me");
    const me = await res.json();
    myName = me.name;

    if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

    document.querySelectorAll(".slots-bet-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            _resumeAudio(); soundClick();
            selectedBetPerLine = Number(btn.dataset.betPerLine);
            document.querySelectorAll(".slots-bet-chip").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            syncBetDisplay();
        });
    });
    document.querySelectorAll(".slots-line-chip").forEach(btn => {
        btn.addEventListener("click", () => {
            _resumeAudio(); soundClick();
            selectedPaylines = Number(btn.dataset.lines);
            document.querySelectorAll(".slots-line-chip").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderPaylineLegend(selectedPaylines, []);
            syncBetDisplay();
        });
    });

    document.querySelector('.slots-bet-chip[data-bet-per-line="5"]').classList.add("active");
    document.querySelector('.slots-line-chip[data-lines="3"]').classList.add("active");
    syncBetDisplay();

    document.getElementById("spinBtn").addEventListener("click", () => {
        if (spinning) return;
        _resumeAudio(); soundLeverPull();
        const btn = document.getElementById("spinBtn");
        btn.classList.add("slots-spin-pressed");
        setTimeout(() => btn.classList.remove("slots-spin-pressed"), 200);
        connection.invoke("SpinSlots", roomId, selectedBetPerLine, selectedPaylines);
    });

    connection.on("SlotsUpdated", room => render(room));
    connection.on("PlayerLeft", name => showToast("⚠️ " + esc(name) + " left the game"));

    document.getElementById("backBtn").onclick = () => {
        _resumeAudio(); soundClick();
        connection.invoke("LeaveSlotsRoom", roomId).then(() => { window.location.href = "/lobby"; });
    };
    document.getElementById("backToLobby").onclick = () => { window.location.href = "/lobby"; };

    await connection.start();
    await connection.invoke("RejoinSlotsRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

/* ============================================================
   Chat
   ============================================================ */
function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close = document.getElementById("chatClose"), input = document.getElementById("chatInput"),
          send = document.getElementById("chatSend"), msgs = document.getElementById("chatMessages"),
          badge = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread = 0; badge.style.display = "none"; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = "none"; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke("SendChat", groupId, m); input.value = ""; }
    send.onclick = doSend; input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    conn.on("ChatMessage", (name, message) => {
        const el = document.createElement("div"); el.className = "chat-msg";
        el.innerHTML = '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; }
    });
}

init();
