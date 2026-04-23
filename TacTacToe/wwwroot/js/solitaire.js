/* ============================================================
   Solitaire — Klondike client
   ============================================================ */
const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("solitaireRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Solitaire game room id");
}

// Card helpers
const RANKS      = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS      = ['\u2660','\u2665','\u2666','\u2663']; // ♠♥♦♣
const SUIT_NAMES = ['Spades \u2660','Hearts \u2665','Diamonds \u2666','Clubs \u2663'];
const SUIT_CLASS = ['spades','hearts','diamonds','clubs'];
function cRank(c)  { return c % 13; }
function cSuit(c)  { return Math.floor(c / 13); }
function cIsRed(c) { const s = cSuit(c); return s === 1 || s === 2; }
function cRankStr(c) { return RANKS[cRank(c)]; }
function cSuitStr(c) { return SUITS[cSuit(c)]; }

// Client-side rule helpers (mirrors server)
function canGoToFoundation(card, foundation) {
    return cRank(card) === foundation[cSuit(card)] + 1;
}
function canGoToTableau(card, pile) {
    if (!pile.faceUp.length && !pile.faceDown.length) return cRank(card) === 12;
    if (!pile.faceUp.length) return false;
    const top = pile.faceUp[pile.faceUp.length - 1];
    return cIsRed(card) !== cIsRed(top) && cRank(card) === cRank(top) - 1;
}

let myName = "";
let roomState = null;
let myGame = null;   // my SolitaireGameState
let selected = null; // { source:'waste'|'tableau', pileIdx:N, faceUpIdx:N, cardId:N }
let timerInterval = null;
let myStartMs = 0;
let gameFinished = false;
let gaveUp = false;
let _gameOverEventFired = false;

// Drag state
let drag = null;            // active drag info (see onPointerDown)
let _suppressNextClick = false; // set after a successful drag to block the subsequent click event

// Hint state
let currentHint  = null;   // the last computed hint object
let hintTimeout  = null;   // auto-dismiss timer

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

/* ============================================================
   Sound Engine (same pattern as slots.js)
   ============================================================ */
let _ac = null;
function _resumeAudio() {
    try {
        if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
        if (_ac.state === "suspended") _ac.resume();
    } catch(e) {}
}
function _tone(freq, type, start, dur, vol = 0.12) {
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
function soundCardPlace() {
    if (!_ac) return;
    const t = _ac.currentTime;
    _tone(300, "sine",  t,       0.04, 0.15);
    _tone(180, "sine",  t+0.02,  0.03, 0.08);
}
function soundCardFlip() {
    if (!_ac) return;
    const t = _ac.currentTime;
    _tone(500, "sine",  t,       0.03, 0.10);
    _tone(650, "sine",  t+0.02,  0.02, 0.07);
}
function soundFoundation() {
    if (!_ac) return;
    const t = _ac.currentTime;
    [523, 659, 784].forEach((f, i) => _tone(f, "triangle", t + i*0.07, 0.12, 0.14));
}
function soundStock() {
    if (!_ac) return;
    const t = _ac.currentTime;
    _tone(220, "sine", t, 0.05, 0.12);
}
function soundInvalid() {
    if (!_ac) return;
    const t = _ac.currentTime;
    _tone(150, "sawtooth", t, 0.10, 0.12);
}
function soundWin() {
    if (!_ac) return;
    const t = _ac.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
        _tone(f, "triangle", t + i*0.10, 0.22, 0.14);
        _tone(f*0.5, "sine",  t + i*0.10, 0.22, 0.07);
    });
}
function soundClick() {
    if (!_ac) return;
    const t = _ac.currentTime;
    _tone(800, "sine", t, 0.02, 0.07);
}

/* ============================================================
   Confetti
   ============================================================ */
const CONF_COLORS = ["#12919E","#C4E7E9","#fbbf24","#f472b6","#7c6aff","#36d6c3"];
function launchConfetti() {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const w = canvas.width = window.innerWidth, h = canvas.height = window.innerHeight;
    const pts = Array.from({ length: 220 }, () => {
        const a = Math.random() * Math.PI * 2, s = 6 + Math.random() * 10;
        return { x: w/2, y: h*0.4, vx: Math.cos(a)*s, vy: Math.sin(a)*s*-1.3 - Math.random()*4,
            sz: 5+Math.random()*7, color: CONF_COLORS[Math.floor(Math.random()*CONF_COLORS.length)],
            rot: Math.random()*360, rotS: (Math.random()-0.5)*14, op: 1, grav: 0.14+Math.random()*0.08 };
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
        fr++; if (alive&&fr<300) requestAnimationFrame(draw); else canvas.remove();
    }
    requestAnimationFrame(draw);
}

function showToast(msg) {
    const t = document.createElement("div"); t.className = "game-toast"; t.innerHTML = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("game-toast-show"));
    setTimeout(() => { t.classList.remove("game-toast-show"); t.addEventListener("transitionend", () => t.remove(), { once: true }); }, 3500);
}

/* ============================================================
   Timer
   ============================================================ */
function startTimer(startMs) {
    myStartMs = startMs;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameFinished) { clearInterval(timerInterval); return; }
        const secs = Math.floor((Date.now() - myStartMs) / 1000);
        const m = Math.floor(secs / 60), s = secs % 60;
        document.getElementById("timerDisplay").textContent = m + ":" + String(s).padStart(2, "0");
    }, 1000);
}

/* ============================================================
   Card rendering
   ============================================================ */
function buildCard(cardId, opts = {}) {
    const { selected: sel = false, faceDown = false, pileIdx = -1, faceUpIdx = -1, source = "", draggable = false } = opts;
    if (faceDown) {
        return `<div class="sol-card sol-card-back" data-role="facedown"></div>`;
    }
    const r = cRankStr(cardId), s = cSuitStr(cardId);
    const ri = cRank(cardId);
    const color = cIsRed(cardId) ? "red" : "black";
    const selClass = sel ? " sol-selected" : "";
    const grabClass = (source === "waste" || source === "tableau") ? " sol-draggable" : "";
    const dAttrs = `data-card="${cardId}" data-source="${source}" data-pile="${pileIdx}" data-fup="${faceUpIdx}"`;
    const si = cSuit(cardId);
    const centerHtml = buildCardCenter(ri, r, s, si);
    return `<div class="sol-card ${color}${selClass}${grabClass}" ${dAttrs}>
        <div class="sol-card-tl">${r}<br>${s}</div>
        ${centerHtml}
        <div class="sol-card-br">${r}<br>${s}</div>
    </div>`;
}

// Face-card emoji indexed by [rankOffset][suitIdx]
// rankOffset: 0=Jack, 1=Queen, 2=King  |  suitIdx: 0=♠ 1=♥ 2=♦ 3=♣
// Unicode Playing Cards block U+1F0A0–U+1F0FF
const FACE_EMOJI = [
    ['\u{1F0AB}', '\u{1F0BB}', '\u{1F0CB}', '\u{1F0DB}'], // Jack  ♠♥♦♣
    ['\u{1F0AD}', '\u{1F0BD}', '\u{1F0CD}', '\u{1F0DD}'], // Queen ♠♥♦♣
    ['\u{1F0AE}', '\u{1F0BE}', '\u{1F0CE}', '\u{1F0DE}']  // King  ♠♥♦♣
];

function buildCardCenter(rankIdx, rankText, suitText, suitIdx = 0) {
    const pipRows = {
        0: [1],
        1: [1, 1],
        2: [1, 1, 1],
        3: [2, 2],
        4: [2, 1, 2],
        5: [2, 2, 2],
        6: [2, 1, 2, 2],
        7: [2, 2, 2, 2],
        8: [2, 2, 1, 2, 2],
        9: [2, 2, 2, 2, 2]
    }[rankIdx];

    if (!pipRows) {
        const faceOffset = rankIdx - 10; // 10=J, 11=Q, 12=K
        const emoji = FACE_EMOJI[faceOffset]?.[suitIdx] ?? rankText;
        return `<div class="sol-card-center sol-card-face-rank"><div class="sol-card-face-emoji">${emoji}</div></div>`;
    }

    const rowsHtml = pipRows.map(count => {
        const row = Array.from({ length: count }, () => `<span class="sol-card-pip">${suitText}</span>`).join("");
        return `<div class="sol-card-pip-row">${row}</div>`;
    }).join("");
    return `<div class="sol-card-center sol-card-pips">${rowsHtml}</div>`;
}

function buildEmptySlot(role, extra = "") {
    return `<div class="sol-empty-slot" data-role="${role}" ${extra}></div>`;
}

/* ============================================================
   Board rendering
   ============================================================ */
function renderBoard(game) {
    if (!game) return;
    if (drag?.active) return; // never tear down DOM while a drag gesture is live

    // ── Stock ─────────────────────────────────────────────────
    const stockEl = document.getElementById("stockCard");
    if (game.stock.length > 0) {
        stockEl.innerHTML = `<div class="sol-card sol-card-back sol-stock-card" data-role="stock" title="${game.stock.length} cards remaining"></div>`;
        document.getElementById("stockSlot").classList.remove("sol-empty-slot-outline");
    } else {
        stockEl.innerHTML = `<div class="sol-stock-empty" data-role="stock" title="Click to recycle waste">&#8635;</div>`;
        document.getElementById("stockSlot").classList.add("sol-empty-slot-outline");
    }

    // ── Waste ─────────────────────────────────────────────────
    const wasteEl = document.getElementById("wasteCard");
    if (game.waste.length > 0) {
        const top = game.waste[game.waste.length - 1];
        const isSel = selected && selected.source === "waste";
        wasteEl.innerHTML = buildCard(top, { selected: isSel, source: "waste", pileIdx: -1, faceUpIdx: 0 });
    } else {
        wasteEl.innerHTML = "";
    }

    // ── Foundations ───────────────────────────────────────────
    for (let suit = 0; suit < 4; suit++) {
        const fEl = document.getElementById("foundation-" + suit);
        const top = game.foundation[suit];
        if (top >= 0) {
            const cardId = suit * 13 + top;
            fEl.innerHTML = buildCard(cardId, { source: "foundation", pileIdx: suit });
        } else {
            fEl.innerHTML = SUITS[suit]; // placeholder icon
            fEl.className = "sol-foundation sol-slot sol-foundation-empty";
        }
    }

    // ── Tableau ───────────────────────────────────────────────
    const FACE_DOWN_H = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sol-fan-fd")) || 18;
    const FACE_UP_H   = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sol-fan-fu")) || 26;
    const CARD_H      = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sol-card-h")) || 109;

    for (let p = 0; p < 7; p++) {
        const pile = game.tableau[p];
        const wrap = document.getElementById("pile-" + p);
        let y = 0;
        let html = "";

        // Face-down cards
        for (let i = 0; i < pile.faceDown.length; i++) {
            html += `<div class="sol-pile-card sol-card sol-card-back" style="top:${y}px" data-role="facedown-${p}"></div>`;
            y += FACE_DOWN_H;
        }

        // Face-up cards
        for (let i = 0; i < pile.faceUp.length; i++) {
            const cardId = pile.faceUp[i];
            const isSel = selected && selected.source === "tableau" && selected.pileIdx === p && selected.faceUpIdx <= i;
            html += `<div class="sol-pile-card" style="top:${y}px">${buildCard(cardId, { selected: isSel, source: "tableau", pileIdx: p, faceUpIdx: i })}</div>`;
            y += FACE_UP_H;
        }

        // Empty pile placeholder
        if (pile.faceDown.length === 0 && pile.faceUp.length === 0) {
            html = `<div class="sol-empty-slot sol-pile-slot sol-slot" data-role="pile-drop" data-pile="${p}" style="top:0px"></div>`;
            y = CARD_H;
        }

        const totalH = Math.max(CARD_H, y - FACE_UP_H + CARD_H);
        wrap.style.height = totalH + "px";
        wrap.innerHTML = html;
    }

    // ── Auto-complete bar ─────────────────────────────────────
    const canAC = game.tableau.every(p => p.faceDown.length === 0) && game.stock.length === 0;
    document.getElementById("autoCompleteBar").style.display = canAC && !gameFinished ? "flex" : "none";
    const giveUpBtn = document.getElementById("giveUpBtn");
    if (giveUpBtn) giveUpBtn.disabled = gameFinished;

    // Re-apply hint highlights (DOM was just rebuilt)
    applyHintHighlights();
}

function renderLeaderboard(room) {
    const lb = document.getElementById("solLeaderboard");
    if (isSinglePlayer || !room || room.players.length <= 1) {
        lb.style.display = "none";
        return;
    }
    lb.style.display = "";
    fetchAvatars(room.players.map(p => p.name));
    const sorted = [...room.players].sort((a, b) => b.score - a.score);
    lb.innerHTML = '<div class="sol-lb-title">&#127760; Race</div>';
    sorted.forEach((p, i) => {
        const medal = ["&#129351;","&#129352;","&#129353;"][i] || (i+1)+".";
        const pct = Math.round((p.game.cardsOnFoundation / 52) * 100);
        const timeStr = p.hasFinished
            ? "&#10003; Done"
            : formatElapsed(p.startedAtMs);
        const rankBadge = p.hasFinished ? `<span class="sol-lb-rank-badge">&#127937; #${p.finishRank}</span>` : "";
        const meClass = p.name === myName ? " sol-lb-me" : "";
        lb.innerHTML += `<div class="sol-lb-row${meClass}">
            <span class="sol-lb-medal">${medal}</span>
            ${avatarHtml(p.name, 'sm')}
            <div class="sol-lb-info">
                <span class="sol-lb-name">${esc(p.name)}</span>
                <div class="sol-lb-progress-bar"><div class="sol-lb-progress-fill" style="width:${pct}%"></div></div>
                <span class="sol-lb-sub">${p.game.cardsOnFoundation}/52 &middot; ${p.score}pts &middot; ${timeStr}</span>
            </div>
            ${rankBadge}
        </div>`;
    });
}

function formatElapsed(startMs) {
    if (!startMs) return "—";
    const s = Math.floor((Date.now() - startMs) / 1000);
    const m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
}

function render(room) {
    roomState = room;
    const me = room.players.find(p => p.name === myName);
    if (!me) return;

    myGame = me.game;
    gameFinished = me.hasFinished;
    gaveUp = !!me.gaveUp;

    document.getElementById("movesDisplay").textContent = myGame.moveCount + " moves";
    document.getElementById("scoreDisplay").textContent = me.score + " pts";

    renderBoard(myGame);
    renderLeaderboard(room);

    if (room.isOver) {
        setTimeout(() => showResults(room), 600);
    }
}

/* ============================================================
   Selection management
   ============================================================ */
function deselect() {
    selected = null;
    if (myGame) renderBoard(myGame);
}

function selectCard(source, pileIdx, faceUpIdx, cardId) {
    selected = { source, pileIdx, faceUpIdx, cardId };
    renderBoard(myGame);
}

/* ============================================================
   Move validation (client-side for instant feedback)
   ============================================================ */
function validateAndSend(moveType, cardId, toPile) {
    if (!myGame || gameFinished) return;
    _resumeAudio();
    soundCardPlace();
    clearHint(); // dismiss active hint whenever the player makes a move
    selected = null;
    connection.invoke("MakeSolitaireMove", roomId, moveType, cardId, toPile)
        .catch(err => { console.error("Move failed:", err); renderBoard(myGame); });
}

/* ============================================================
   Hint System  (pure client-side, deterministic — spec §4)
   ============================================================ */

function cardLabel(cardId) {
    return cRankStr(cardId) + cSuitStr(cardId);
}

function destTopLabel(pile) {
    if (!pile.faceUp.length) return "the empty column";
    return cardLabel(pile.faceUp[pile.faceUp.length - 1]);
}

// Compute a hint from the current game state.
// Follows the spec priority order exactly:
//   1 Tableau→Foundation  2 Waste→Foundation  3 Tableau→Tableau
//   4 Waste→Tableau       5 Stock→Waste        6 Auto-flip  7 None
function computeHint(game) {

    // ── Step 1: Tableau → Foundation ─────────────────────────
    for (let p = 0; p < 7; p++) {
        const pile = game.tableau[p];
        if (!pile.faceUp.length) continue;
        const card = pile.faceUp[pile.faceUp.length - 1];
        if (canGoToFoundation(card, game.foundation)) {
            const suit = cSuit(card);
            return {
                hintAvailable: true,
                hintType: "TableauToFoundation",
                description: `Move ${cardLabel(card)} from column ${p + 1} to the ${SUIT_NAMES[suit]} foundation.`,
                source: { type: "tableau", pileIdx: p, faceUpIdx: pile.faceUp.length - 1, cardId: card },
                dest:   { type: "foundation", pileIdx: suit },
            };
        }
    }

    // ── Step 2: Waste → Foundation ───────────────────────────
    if (game.waste.length) {
        const card = game.waste[game.waste.length - 1];
        if (canGoToFoundation(card, game.foundation)) {
            const suit = cSuit(card);
            return {
                hintAvailable: true,
                hintType: "WasteToFoundation",
                description: `Move ${cardLabel(card)} from the waste to the ${SUIT_NAMES[suit]} foundation.`,
                source: { type: "waste", cardId: card },
                dest:   { type: "foundation", pileIdx: suit },
            };
        }
    }

    // ── Step 3: Tableau → Tableau ─────────────────────────────
    for (let from = 0; from < 7; from++) {
        const fromPile = game.tableau[from];
        for (let fup = 0; fup < fromPile.faceUp.length; fup++) {
            const card = fromPile.faceUp[fup];
            for (let to = 0; to < 7; to++) {
                if (from === to) continue;
                if (canGoToTableau(card, game.tableau[to])) {
                    return {
                        hintAvailable: true,
                        hintType: "TableauToTableau",
                        description: `Move ${cardLabel(card)} from column ${from + 1} onto ${destTopLabel(game.tableau[to])} in column ${to + 1}.`,
                        source: { type: "tableau", pileIdx: from, faceUpIdx: fup, cardId: card },
                        dest:   { type: "tableau", pileIdx: to },
                    };
                }
            }
        }
    }

    // ── Step 4: Waste → Tableau ───────────────────────────────
    if (game.waste.length) {
        const card = game.waste[game.waste.length - 1];
        for (let to = 0; to < 7; to++) {
            if (canGoToTableau(card, game.tableau[to])) {
                return {
                    hintAvailable: true,
                    hintType: "WasteToTableau",
                    description: `Move ${cardLabel(card)} from the waste onto ${destTopLabel(game.tableau[to])} in column ${to + 1}.`,
                    source: { type: "waste", cardId: card },
                    dest:   { type: "tableau", pileIdx: to },
                };
            }
        }
    }

    // ── Step 5: Stock → Waste ─────────────────────────────────
    if (game.stock.length) {
        return {
            hintAvailable: true,
            hintType: "StockToWaste",
            description: `Draw from the stock pile (${game.stock.length} card${game.stock.length > 1 ? "s" : ""} remaining).`,
            source: { type: "stock" },
            dest:   null,
        };
    }

    // ── Step 6: Auto-flip ─────────────────────────────────────
    for (let p = 0; p < 7; p++) {
        const pile = game.tableau[p];
        if (!pile.faceUp.length && pile.faceDown.length) {
            return {
                hintAvailable: true,
                hintType: "AutoFlip",
                description: `Flip the top face-down card in column ${p + 1}.`,
                source: { type: "facedown", pileIdx: p },
                dest:   null,
            };
        }
    }

    // ── Step 7: No moves ──────────────────────────────────────
    return { hintAvailable: false, description: "No legal moves remain." };
}

// Apply amber (source) and green (dest) highlights after a renderBoard call.
// Safe to call any time — always starts by stripping old highlights.
function applyHintHighlights() {
    document.querySelectorAll(".sol-hint-source, .sol-hint-dest")
        .forEach(el => el.classList.remove("sol-hint-source", "sol-hint-dest"));
    if (!currentHint?.hintAvailable || !myGame) return;

    const hint = currentHint;

    // ── Source ────────────────────────────────────────────────
    if (hint.source) {
        switch (hint.source.type) {
            case "waste": {
                document.querySelector("#wasteCard .sol-card")?.classList.add("sol-hint-source");
                break;
            }
            case "stock": {
                // Highlight the visible back card or the recycle icon
                document.querySelector("#stockCard .sol-card, #stockCard .sol-stock-empty")
                    ?.classList.add("sol-hint-source");
                break;
            }
            case "tableau": {
                const pile  = myGame.tableau[hint.source.pileIdx];
                const wrap  = document.getElementById("pile-" + hint.source.pileIdx);
                if (!wrap) break;
                const nodes = wrap.querySelectorAll(".sol-pile-card");
                const fdCount = pile.faceDown.length;
                // Highlight every card from the picked-up index to the top
                for (let i = hint.source.faceUpIdx; i < pile.faceUp.length; i++) {
                    nodes[fdCount + i]?.querySelector(".sol-card")
                        ?.classList.add("sol-hint-source");
                }
                break;
            }
            case "facedown": {
                const wrap  = document.getElementById("pile-" + hint.source.pileIdx);
                const nodes = wrap?.querySelectorAll(".sol-pile-card");
                if (nodes?.length) nodes[nodes.length - 1].classList.add("sol-hint-source");
                break;
            }
        }
    }

    // ── Destination ───────────────────────────────────────────
    if (hint.dest) {
        switch (hint.dest.type) {
            case "foundation": {
                document.getElementById("foundation-" + hint.dest.pileIdx)
                    ?.classList.add("sol-hint-dest");
                break;
            }
            case "tableau": {
                const pile = myGame.tableau[hint.dest.pileIdx];
                const wrap = document.getElementById("pile-" + hint.dest.pileIdx);
                if (!wrap) break;
                if (pile.faceUp.length) {
                    // Highlight the specific top card the stack lands on
                    const nodes   = wrap.querySelectorAll(".sol-pile-card");
                    const topNode = nodes[pile.faceDown.length + pile.faceUp.length - 1];
                    topNode?.querySelector(".sol-card")?.classList.add("sol-hint-dest");
                } else {
                    // Empty column: highlight the placeholder slot
                    (wrap.querySelector(".sol-empty-slot") ?? wrap).classList.add("sol-hint-dest");
                }
                break;
            }
        }
    }
}

function clearHint() {
    if (hintTimeout) { clearTimeout(hintTimeout); hintTimeout = null; }
    currentHint = null;
    document.querySelectorAll(".sol-hint-source, .sol-hint-dest")
        .forEach(el => el.classList.remove("sol-hint-source", "sol-hint-dest"));
    const banner = document.getElementById("hintBanner");
    if (banner) banner.style.display = "none";
}

function showHint() {
    if (!myGame || gameFinished) return;
    _resumeAudio();
    soundClick();

    // Ask the server for an authoritative hint. Server will respond with
    // a "SolitaireHint" message and broadcast the updated room (score etc.).
    clearHint();
    connection.invoke("RequestSolitaireHint", roomId).catch(err => console.error("Hint request failed:", err));
}

/* ============================================================
   Drag-and-Drop  (Pointer Events — unified mouse + touch)
   ============================================================
   Flow:
     pointerdown  → record drag candidate, capture pointer
     pointermove  → after DRAG_THRESHOLD px, create ghost + dim source
     pointerup    → commit drop; if no drag happened, let click fire
     pointercancel→ abort drag cleanly
   ============================================================ */
const DRAG_THRESHOLD = 8; // px before drag activates

function _parseCSSPx(varName, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName);
    return parseInt(raw) || fallback;
}

// Returns the ordered list of card IDs that would move in a drag
function _getDragCards(source, pileIdx, faceUpIdx) {
    if (source === "waste") {
        const top = myGame?.waste.at(-1);
        return top !== undefined ? [top] : [];
    }
    if (source === "tableau") {
        return myGame?.tableau[pileIdx]?.faceUp.slice(faceUpIdx) ?? [];
    }
    return [];
}

// Build a floating ghost element showing the dragged card stack
function _buildGhost(cards) {
    const cw = _parseCSSPx("--sol-card-w", 78);
    const ch = _parseCSSPx("--sol-card-h", 109);
    const fu = _parseCSSPx("--sol-fan-fu", 26);
    const totalH = ch + (cards.length - 1) * fu;

    const ghost = document.createElement("div");
    ghost.className = "sol-ghost";
    ghost.style.cssText = `width:${cw}px;height:${totalH}px;`;

    cards.forEach((cardId, i) => {
        const wrap = document.createElement("div");
        wrap.style.cssText = `position:absolute;top:${i * fu}px;left:0;`;
        wrap.innerHTML = buildCard(cardId, { source: "", pileIdx: -1, faceUpIdx: -1 });
        ghost.appendChild(wrap);
    });
    document.body.appendChild(ghost);
    return ghost;
}

function _moveGhost(clientX, clientY) {
    if (!drag?.ghostEl) return;
    drag.ghostEl.style.left = (clientX - drag.offX) + "px";
    drag.ghostEl.style.top  = (clientY - drag.offY) + "px";
}

// Find the drop zone element under the pointer (hiding ghost first)
function _hitTest(clientX, clientY) {
    if (drag?.ghostEl) drag.ghostEl.style.visibility = "hidden";
    const el = document.elementFromPoint(clientX, clientY);
    if (drag?.ghostEl) drag.ghostEl.style.visibility = "";
    return el?.closest("[data-role],[data-card],[data-pile]") ?? null;
}

// Evaluate whether dropping drag.cards[0] on target is legal
function _dropValid(target) {
    if (!target || !drag || !myGame) return false;
    const role    = target.dataset.role  ?? "";
    const srcStr  = target.dataset.source ?? "";
    const pileIdx = parseInt(target.dataset.pile ?? "-1");
    const card    = drag.cards[0]; // bottom of dragged stack
    if (role === "foundation" || srcStr === "foundation") {
        return drag.cards.length === 1 && canGoToFoundation(card, myGame.foundation);
    }
    if (role === "pile-drop") {
        return cRank(card) === 12;
    }
    if (srcStr === "tableau" && pileIdx >= 0) {
        return canGoToTableau(card, myGame.tableau[pileIdx]);
    }
    if (pileIdx >= 0 && myGame.tableau[pileIdx]) {
        return canGoToTableau(card, myGame.tableau[pileIdx]);
    }
    return false;
}

// Apply / remove drop-zone highlight classes
function _applyDropHighlight(target) {
    document.querySelectorAll(".sol-drop-valid,.sol-drop-invalid")
        .forEach(el => el.classList.remove("sol-drop-valid", "sol-drop-invalid"));
    if (!target || !drag) return;
    const valid = _dropValid(target);
    const role    = target.dataset.role  ?? "";
    const srcStr  = target.dataset.source ?? "";
    const pileIdx = parseInt(target.dataset.pile ?? "-1");
    // Find the highlight anchor element
    let anchor = null;
    if (role === "foundation" || srcStr === "foundation") {
        anchor = pileIdx >= 0 ? document.getElementById("foundation-" + pileIdx) : target.closest(".sol-foundation");
    } else if (role === "pile-drop" || srcStr === "tableau" || pileIdx >= 0) {
        anchor = pileIdx >= 0 ? document.getElementById("pile-" + pileIdx) : null;
    }
    (anchor ?? target).classList.add(valid ? "sol-drop-valid" : "sol-drop-invalid");
}

// Dim / restore the original card elements during drag
function _setSourceOpacity(opacity) {
    if (!drag) return;
    if (drag.source === "waste") {
        const el = document.getElementById("wasteCard");
        if (el) el.style.opacity = opacity;
    } else if (drag.source === "tableau") {
        const wrap = document.getElementById("pile-" + drag.pileIdx);
        if (!wrap || !myGame) return;
        const fdCount = myGame.tableau[drag.pileIdx].faceDown.length;
        wrap.querySelectorAll(".sol-pile-card").forEach((c, i) => {
            if (i >= fdCount + drag.faceUpIdx) c.style.opacity = opacity;
        });
    }
}

// Execute the drop on pointerup
function _commitDrop(clientX, clientY) {
    document.querySelectorAll(".sol-drop-valid,.sol-drop-invalid")
        .forEach(el => el.classList.remove("sol-drop-valid", "sol-drop-invalid"));
    const target = _hitTest(clientX, clientY);
    if (!target || !drag || !myGame) { soundInvalid(); return false; }

    const role    = target.dataset.role  ?? "";
    const srcStr  = target.dataset.source ?? "";
    const pileIdx = parseInt(target.dataset.pile ?? "-1");
    const card    = drag.cards[0];

    if (role === "foundation" || srcStr === "foundation") {
        if (drag.cards.length === 1 && canGoToFoundation(card, myGame.foundation)) {
            if (drag.source === "waste") validateAndSend("waste-to-foundation", card, pileIdx);
            else validateAndSend("tableau-to-foundation", card, pileIdx);
            return true;
        }
    } else if (role === "pile-drop") {
        if (cRank(card) === 12) {
            if (drag.source === "waste") validateAndSend("waste-to-tableau", card, pileIdx);
            else validateAndSend("tableau-to-tableau", card, pileIdx);
            return true;
        }
    } else {
        const destIdx = pileIdx;
        const destPile = destIdx >= 0 ? myGame.tableau[destIdx] : null;
        if (destPile && canGoToTableau(card, destPile)) {
            if (drag.source === "waste") validateAndSend("waste-to-tableau", card, destIdx);
            else validateAndSend("tableau-to-tableau", card, destIdx);
            return true;
        }
    }
    soundInvalid();
    return false;
}

function _cleanupDrag() {
    document.querySelectorAll(".sol-drop-valid,.sol-drop-invalid")
        .forEach(el => el.classList.remove("sol-drop-valid", "sol-drop-invalid"));
    _setSourceOpacity("");
    drag?.ghostEl?.remove();
    drag = null;
}

function onPointerDown(e) {
    if (gameFinished || drag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const cardEl = e.target.closest("[data-card]");
    if (!cardEl) return;
    const src       = cardEl.dataset.source   ?? "";
    const cardId    = parseInt(cardEl.dataset.card  ?? "-1");
    const pileIdx   = parseInt(cardEl.dataset.pile  ?? "-1");
    const faceUpIdx = parseInt(cardEl.dataset.fup   ?? "-1");

    if (src !== "waste" && src !== "tableau") return;
    if (isNaN(cardId) || cardId < 0) return;
    if (src === "waste" && myGame?.waste.at(-1) !== cardId) return;

    const cards = _getDragCards(src, pileIdx, faceUpIdx);
    if (!cards.length) return;

    // Stop the browser starting a scroll/zoom gesture immediately.
    // This is the critical fix for touch — without it the page scrolls
    // and pointer events become unreliable before the threshold is crossed.
    e.preventDefault();

    const rect   = cardEl.getBoundingClientRect();
    const isTouch = e.pointerType === "touch" || e.pointerType === "pen";
    const cw = _parseCSSPx("--sol-card-w", 78);
    const ch = _parseCSSPx("--sol-card-h", 109);

    // On touch: float the card above the finger so the face is visible.
    // The bottom of the ghost sits ~16 px above the touch point.
    const offX = isTouch ? Math.round(cw * 0.5)  : e.clientX - rect.left;
    const offY = isTouch ? ch + 16               : e.clientY - rect.top;

    drag = {
        active:    false,
        startX:    e.clientX,
        startY:    e.clientY,
        source:    src,
        pileIdx,
        faceUpIdx,
        cardId,
        cards,
        ghostEl:   null,
        offX,
        offY,
        pointerId: e.pointerId,
        isTouch,
    };
    try { cardEl.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerMove(e) {
    if (!drag) return;

    // Prevent scroll/zoom for every move while a drag candidate is live —
    // not just after the threshold — so the browser never steals the gesture.
    e.preventDefault();

    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        drag.ghostEl = _buildGhost(drag.cards);
        _setSourceOpacity("0.22");
        _resumeAudio();
    }
    _moveGhost(e.clientX, e.clientY);
    _applyDropHighlight(_hitTest(e.clientX, e.clientY));
}

function onPointerUp(e) {
    if (!drag) return;
    const wasActive = drag.active;
    if (wasActive) {
        _setSourceOpacity("");
        drag.ghostEl?.remove();
        drag.ghostEl = null;
        const dropped = _commitDrop(e.clientX, e.clientY);
        selected = null;
        _suppressNextClick = true; // block the click event that fires after pointerup
    }
    drag = null;
}

function onPointerCancel(e) {
    if (!drag) return;
    _cleanupDrag();
    if (myGame) renderBoard(myGame);
}

/* ============================================================
   Click handling
   ============================================================ */
function handleBoardClick(e) {
    if (_suppressNextClick) { _suppressNextClick = false; return; }
    _resumeAudio();
    if (gameFinished) return;
    const target = e.target.closest("[data-role],[data-card],[data-pile]");
    if (!target) { deselect(); return; }

    const role    = target.dataset.role ?? "";
    const cardStr = target.dataset.card;
    const srcStr  = target.dataset.source;
    const pileStr = target.dataset.pile;
    const fupStr  = target.dataset.fup;

    const cardId   = cardStr !== undefined ? parseInt(cardStr) : -1;
    const pileIdx  = pileStr !== undefined ? parseInt(pileStr) : -1;
    const faceUpIdx = fupStr !== undefined ? parseInt(fupStr) : -1;

    // ── Stock click ───────────────────────────────────────────
    if (role === "stock") {
        deselect();
        soundStock();
        connection.invoke("MakeSolitaireMove", roomId, "stock-flip", -1, -1);
        return;
    }

    // ── Face-down card (no action) ────────────────────────────
    if (role.startsWith("facedown")) {
        if (selected) deselect(); else soundInvalid();
        return;
    }

    // ── Foundation click ──────────────────────────────────────
    if (role === "foundation" || srcStr === "foundation") {
        const fSuit = pileIdx >= 0 ? pileIdx : parseInt(target.dataset.suit ?? "-1");
        if (selected) {
            // Try to move selected card to this foundation
            if (selected.source === "waste") {
                const card = myGame.waste[myGame.waste.length - 1];
                if (card !== undefined && canGoToFoundation(card, myGame.foundation)) {
                    validateAndSend("waste-to-foundation", card, fSuit);
                } else { soundInvalid(); deselect(); }
            } else if (selected.source === "tableau") {
                const pile = myGame.tableau[selected.pileIdx];
                const topCard = pile.faceUp[pile.faceUp.length - 1];
                if (selected.faceUpIdx === pile.faceUp.length - 1 && canGoToFoundation(topCard, myGame.foundation)) {
                    validateAndSend("tableau-to-foundation", topCard, fSuit);
                } else { soundInvalid(); deselect(); }
            } else { deselect(); }
        }
        return;
    }

    // ── Face-up card or pile-drop ─────────────────────────────
    if (role === "pile-drop") {
        // Empty tableau pile — place selected card (must be King)
        if (selected) {
            const movingCard = selected.source === "waste"
                ? myGame.waste[myGame.waste.length - 1]
                : myGame.tableau[selected.pileIdx]?.faceUp[selected.faceUpIdx];
            if (movingCard !== undefined && cRank(movingCard) === 12) {
                if (selected.source === "waste") validateAndSend("waste-to-tableau", movingCard, pileIdx);
                else validateAndSend("tableau-to-tableau", movingCard, pileIdx);
            } else { soundInvalid(); deselect(); }
        }
        return;
    }

    // ── Actual card click ─────────────────────────────────────
    if (cardId >= 0) {
        if (!selected) {
            // Select this card
            soundClick();
            selectCard(srcStr, pileIdx, faceUpIdx, cardId);
        } else {
            // Something is already selected — try to place on this card's pile
            if (selected.source === srcStr && selected.pileIdx === pileIdx && selected.faceUpIdx === faceUpIdx) {
                // Same card — deselect
                deselect();
                return;
            }

            const movingCard = selected.source === "waste"
                ? myGame.waste[myGame.waste.length - 1]
                : myGame.tableau[selected.pileIdx]?.faceUp[selected.faceUpIdx];

            if (movingCard === undefined) { deselect(); return; }

            if (srcStr === "tableau") {
                // Try to place on top of this tableau pile
                const destPile = myGame.tableau[pileIdx];
                if (destPile && canGoToTableau(movingCard, destPile)) {
                    if (selected.source === "waste") validateAndSend("waste-to-tableau", movingCard, pileIdx);
                    else validateAndSend("tableau-to-tableau", movingCard, pileIdx);
                } else {
                    // If clicking on a card in the same pile but lower, reselect from that card
                    if (selected.source === "tableau" && pileIdx === selected.pileIdx && faceUpIdx < selected.faceUpIdx) {
                        soundClick();
                        selectCard("tableau", pileIdx, faceUpIdx, cardId);
                    } else {
                        soundInvalid(); deselect();
                    }
                }
            } else if (srcStr === "foundation") {
                // Place selected on foundation
                if (canGoToFoundation(movingCard, myGame.foundation)) {
                    if (selected.source === "waste") validateAndSend("waste-to-foundation", movingCard, pileIdx);
                    else validateAndSend("tableau-to-foundation", movingCard, pileIdx);
                } else { soundInvalid(); deselect(); }
            } else if (srcStr === "waste") {
                // Clicking waste card while something selected — reselect waste
                soundClick();
                selectCard("waste", -1, 0, cardId);
            } else {
                deselect();
            }
        }
        return;
    }

    deselect();
}

function handleBoardDblClick(e) {
    _resumeAudio();
    if (gameFinished) return;
    const target = e.target.closest("[data-card]");
    if (!target) return;
    const cardId = parseInt(target.dataset.card);
    const src    = target.dataset.source;
    if (isNaN(cardId)) return;

    // Double-click: auto-move top card to foundation if possible
    if (src === "waste") {
        const card = myGame.waste[myGame.waste.length - 1];
        if (card === cardId && canGoToFoundation(card, myGame.foundation)) {
            selected = null;
            validateAndSend("waste-to-foundation", card, -1);
        }
    } else if (src === "tableau") {
        const pileIdx = parseInt(target.dataset.pile);
        const pile = myGame.tableau[pileIdx];
        if (pile && pile.faceUp.length > 0) {
            const topCard = pile.faceUp[pile.faceUp.length - 1];
            if (topCard === cardId && canGoToFoundation(topCard, myGame.foundation)) {
                selected = null;
                validateAndSend("tableau-to-foundation", topCard, -1);
            }
        }
    }
}

/* ============================================================
   Results
   ============================================================ */
function showResults(room) {
    if (timerInterval) clearInterval(timerInterval);
    const me = room.players.find(p => p.name === myName);
    const gaveUpResult = !!me?.gaveUp;
    const isWinner = !gaveUpResult && (me?.finishRank === 1 || (isSinglePlayer && me?.hasFinished));
    const allDone = room.players.filter(p => !p.isBot).every(p => p.hasFinished);

    document.getElementById("resultEmoji").textContent = gaveUpResult ? "🏳️" : isWinner ? "🏆" : me?.hasFinished ? "🎉" : "🃏";
    document.getElementById("resultText").textContent  = gaveUpResult ? "You Gave Up" : isWinner ? "You Win!" : me?.hasFinished ? "Well Done!" : "Game Over";

    if (me) {
        const secs = me.hasFinished
            ? Math.floor((me.finishedAtMs - me.startedAtMs) / 1000)
            : Math.floor((Date.now() - me.startedAtMs) / 1000);
        const m = Math.floor(secs / 60), s = secs % 60;
        document.getElementById("resultStats").innerHTML =
            `<div class="sol-stat"><span>Cards</span><strong>${me.game.cardsOnFoundation}/52</strong></div>` +
            `<div class="sol-stat"><span>Moves</span><strong>${me.game.moveCount}</strong></div>` +
            `<div class="sol-stat"><span>Time</span><strong>${m}:${String(s).padStart(2,"0")}</strong></div>` +
            `<div class="sol-stat"><span>Cycles</span><strong>${me.game.stockCycles}</strong></div>` +
            `<div class="sol-stat sol-stat-score"><span>Score</span><strong>${me.score} pts</strong></div>`;
    }

    if (!isSinglePlayer) {
        const sorted = [...room.players].sort((a, b) => b.score - a.score);
        const fs = document.getElementById("finalScores");
        fs.innerHTML = "";
        sorted.forEach((p, i) => {
            const row = document.createElement("div");
            row.className = "sol-final-row" + (p.name === myName ? " is-me" : "");
            row.innerHTML = (["&#129351;","&#129352;","&#129353;"][i] || "") +
                " " + avatarHtml(p.name, 'xs') + " <strong>" + esc(p.name) + "</strong>: " + p.score + " pts";
            fs.appendChild(row);
        });
    }

    document.getElementById("resultOverlay").style.display = "flex";
    if (isWinner) { soundWin(); launchConfetti(); }
    if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event('gameOver')); }
}

function giveUpGame() {
    if (!myGame || gameFinished || gaveUp) return;
    _resumeAudio();
    soundClick();
    const modal = document.getElementById("giveUpModal");
    modal.style.display = "flex";
    document.getElementById("giveUpCancel").onclick  = () => { modal.style.display = "none"; };
    document.getElementById("giveUpConfirm").onclick = () => {
        modal.style.display = "none";
        clearHint();
        connection.invoke("GiveUpSolitaire", roomId).catch(err => console.error("Give up failed:", err));
    };
}

/* ============================================================
   Chat
   ============================================================ */
function initChat(conn, groupId) {
    document.getElementById("chatWidget").style.display = "";
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close  = document.getElementById("chatClose"),  input = document.getElementById("chatInput"),
          send   = document.getElementById("chatSend"),   msgs  = document.getElementById("chatMessages"),
          badge  = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread=0; badge.style.display="none"; msgs.scrollTop=msgs.scrollHeight; input.focus(); } };
    close.onclick  = () => { chatOpen = false; panel.style.display = "none"; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke("SendChat", groupId, m); input.value = ""; }
    send.onclick = doSend; input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    conn.on("ChatMessage", (name, message) => {
        const el = document.createElement("div"); el.className = "chat-msg";
        el.innerHTML = avatarHtml(name, 'xs') + '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; }
    });
}

/* ============================================================
   Init
   ============================================================ */
async function init() {
    const res = await fetch("/api/me");
    const me  = await res.json();
    myName = me.name;
    await fetchAvatars([myName]);

    // Board click delegation
    document.getElementById("solBoard").addEventListener("click",    handleBoardClick);
    document.getElementById("solBoard").addEventListener("dblclick", handleBoardDblClick);

    // Drag-and-drop (pointer events — unified mouse + touch)
    // pointerdown must be { passive: false } so e.preventDefault() can block
    // the browser's scroll gesture before it starts.
    document.getElementById("solBoard").addEventListener("pointerdown",   onPointerDown,  { passive: false });
    document.addEventListener("pointermove",  onPointerMove,  { passive: false });
    document.addEventListener("pointerup",    onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);

    // Auto-complete
    document.getElementById("autoCompleteBtn").addEventListener("click", () => {
        _resumeAudio();
        connection.invoke("MakeSolitaireMove", roomId, "auto-complete", -1, -1);
    });

    // Hint
    document.getElementById("hintBtn").addEventListener("click", showHint);
    document.getElementById("giveUpBtn").addEventListener("click", giveUpGame);

    // Back button
    document.getElementById("backBtn").addEventListener("click", () => {
        _resumeAudio();
        connection.invoke("LeaveSolitaireRoom", roomId).then(() => { window.location.href = "/lobby"; });
    });
    document.getElementById("backToLobby").onclick = () => { window.location.href = "/lobby"; };

    // Hub events
    connection.on("SolitaireUpdated", room => {
        render(room);
        // Update timer start if needed
        const me = room.players.find(p => p.name === myName);
        if (me && me.startedAtMs && !timerInterval) startTimer(me.startedAtMs);
    });
    // Server-provided hint — apply visuals and show banner
    connection.on("SolitaireHint", hint => {
        if (!hint) return;
        currentHint = hint;
        const banner = document.getElementById("hintBanner");
        if (banner) {
            banner.textContent = hint.description;
            banner.className = "sol-hint-banner" + (hint.hintAvailable ? "" : " sol-hint-none");
            banner.style.display = "";
        }
        if (hint.hintAvailable) {
            applyHintHighlights();
            if (hintTimeout) clearTimeout(hintTimeout);
            hintTimeout = setTimeout(clearHint, 4000);
        }
    });
    connection.on("PlayerLeft", name => showToast("&#9888; " + esc(name) + " left the game"));

    await connection.start();
    await connection.invoke("RejoinSolitaireRoom", roomId);

    if (!isSinglePlayer) initChat(connection, roomId);
}

init();
