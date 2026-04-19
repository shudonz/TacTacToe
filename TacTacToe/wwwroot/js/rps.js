const Moves = Object.freeze({ Rock: "Rock", Paper: "Paper", Scissors: "Scissors" });
const PowerUps = Object.freeze({
    Shield: "Shield",
    DoubleStrike: "DoubleStrike",
    Reveal: "Reveal",
    Reverse: "Reverse",
    LockIn: "LockIn",
    Randomizer: "Randomizer",
    Sabotage: "Sabotage",
    Charge: "Charge"
});
const PowerUpList = Object.values(PowerUps);
const PowerUpLabels = {
    Shield: "🛡 Shield",
    DoubleStrike: "⚡ Double Strike",
    Reveal: "👁 Reveal",
    Reverse: "🔄 Reverse",
    LockIn: "🔒 Lock-In",
    Randomizer: "🎲 Randomizer",
    Sabotage: "💣 Sabotage",
    Charge: "⚙ Charge"
};
const PowerCosts = {
    Shield: 2,
    DoubleStrike: 3,
    Reveal: 1,
    Reverse: 3,
    LockIn: 2,
    Randomizer: 2,
    Sabotage: 3,
    Charge: 1
};

const state = {
    mode: "single",
    difficulty: "easy",
    format: "best5",
    powerMode: "random",
    round: 0,
    players: [],
    history: [],
    selectedMove: null,
    selectedPower: null,
    localStep: 0,
    pendingSelections: [null, null],
    currentAvailable: [[], []],
    pendingAiSelection: null,
    gameOver: false,
    timerEndAt: 0,
    timerHandle: null
};

const els = {
    modeSelect: document.getElementById("modeSelect"),
    difficultySelect: document.getElementById("difficultySelect"),
    formatSelect: document.getElementById("formatSelect"),
    powerModeSelect: document.getElementById("powerModeSelect"),
    startBtn: document.getElementById("startBtn"),
    backBtn: document.getElementById("backBtn"),
    gameCard: document.getElementById("gameCard"),
    leftName: document.getElementById("leftName"),
    rightName: document.getElementById("rightName"),
    scoreText: document.getElementById("scoreText"),
    statusText: document.getElementById("statusText"),
    timerText: document.getElementById("timerText"),
    shopPanel: document.getElementById("shopPanel"),
    powerPanel: document.getElementById("powerPanel"),
    peekPanel: document.getElementById("peekPanel"),
    moveBtns: [...document.querySelectorAll(".rps-move-btn")],
    lockBtn: document.getElementById("lockBtn"),
    roundSummary: document.getElementById("roundSummary"),
    effectBanner: document.getElementById("effectBanner"),
    historyLog: document.getElementById("historyLog"),
    resultOverlay: document.getElementById("resultOverlay"),
    resultText: document.getElementById("resultText"),
    playAgainBtn: document.getElementById("playAgainBtn"),
    backToLobby: document.getElementById("backToLobby")
};

els.modeSelect.addEventListener("change", () => {
    els.difficultySelect.disabled = els.modeSelect.value !== "single";
});
els.startBtn.addEventListener("click", startMatch);
els.lockBtn.addEventListener("click", lockSelection);
els.backBtn.addEventListener("click", () => window.location.href = "/lobby");
els.backToLobby.addEventListener("click", () => window.location.href = "/lobby");
els.playAgainBtn.addEventListener("click", () => {
    els.resultOverlay.style.display = "none";
    startMatch();
});

els.moveBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        if (state.gameOver) return;
        state.selectedMove = btn.dataset.move;
        els.moveBtns.forEach(b => b.classList.toggle("active", b === btn));
        renderStatus();
    });
});

async function startMatch() {
    const me = await fetch("/api/me").then(r => r.ok ? r.json() : ({ name: "Player 1" }));
    state.mode = els.modeSelect.value;
    state.difficulty = els.difficultySelect.value;
    state.format = els.formatSelect.value;
    state.powerMode = els.powerModeSelect.value;
    state.round = 0;
    state.history = [];
    state.localStep = 0;
    state.pendingSelections = [null, null];
    state.pendingAiSelection = null;
    state.selectedMove = null;
    state.selectedPower = null;
    state.gameOver = false;

    state.players = [
        makePlayerState(me.name || "Player 1"),
        makePlayerState(state.mode === "single" ? "CPU" : "Player 2")
    ];

    els.leftName.textContent = state.players[0].name;
    els.rightName.textContent = state.players[1].name;
    els.gameCard.style.display = "block";
    els.resultOverlay.style.display = "none";
    els.historyLog.innerHTML = "";
    els.roundSummary.textContent = "";

    if (state.format === "timed") {
        state.timerEndAt = Date.now() + 60000;
        startTimer();
    } else {
        stopTimer();
        els.timerText.style.display = "none";
    }

    beginRound();
}

function beginRound() {
    if (state.gameOver) return;
    state.round += 1;
    state.selectedMove = null;
    state.selectedPower = null;
    state.pendingAiSelection = null;
    state.pendingSelections = [null, null];
    els.moveBtns.forEach(b => b.classList.remove("active"));

    for (let i = 0; i < 2; i++) {
        decrementCooldowns(state.players[i]);
        const bonus = grantChargeBonusIfAny(state.players[i]);
        state.currentAvailable[i] = getAvailablePowerUps(i, bonus);
    }

    if (state.mode === "single") {
        state.localStep = 0;
        autoShopForAi();
    } else {
        state.localStep = 0;
    }

    renderShop();
    renderPowerUps();
    renderStatus();
    renderScore();
}

function makePlayerState(name) {
    return {
        name,
        score: 0,
        coins: 0,
        lastMove: null,
        cooldowns: Object.fromEntries(PowerUpList.map(p => [p, 0])),
        inventory: [],
        chargeRewardCount: 0,
        history: []
    };
}

function startTimer() {
    stopTimer();
    els.timerText.style.display = "block";
    state.timerHandle = setInterval(() => {
        const left = Math.max(0, state.timerEndAt - Date.now());
        els.timerText.textContent = `Time left: ${(left / 1000).toFixed(1)}s`;
        if (left <= 0) {
            stopTimer();
            endMatch();
        }
    }, 100);
}

function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
}

function decrementCooldowns(player) {
    if (state.powerMode !== "cooldown") return;
    for (const key of PowerUpList) {
        if (player.cooldowns[key] > 0) player.cooldowns[key] -= 1;
    }
}

function grantChargeBonusIfAny(player) {
    const list = [];
    if (player.chargeRewardCount > 0) {
        for (let i = 0; i < player.chargeRewardCount; i++) list.push(randomPowerUp());
        player.chargeRewardCount = 0;
    }
    return list;
}

function getAvailablePowerUps(playerIndex, bonus) {
    const player = state.players[playerIndex];
    if (state.powerMode === "random") {
        return dedupe([randomPowerUp(), ...bonus]);
    }
    if (state.powerMode === "cooldown") {
        const base = PowerUpList.filter(p => player.cooldowns[p] === 0);
        return dedupe([...base, ...bonus]);
    }
    return dedupe([...player.inventory, ...bonus]);
}

function renderShop() {
    if (state.powerMode !== "shop") {
        els.shopPanel.style.display = "none";
        return;
    }

    els.shopPanel.style.display = "block";
    const actor = state.mode === "single" ? 0 : state.localStep;
    const player = state.players[actor];

    const canBuy = PowerUpList.map(p => {
        const disabled = player.coins < PowerCosts[p] ? "disabled" : "";
        return `<button class="btn btn-sp rps-buy-btn" data-buy="${p}" ${disabled}>${PowerUpLabels[p]} (${PowerCosts[p]}c)</button>`;
    }).join("");

    els.shopPanel.innerHTML = `
        <div><strong>${escapeHtml(player.name)} Coins:</strong> ${player.coins}</div>
        <div class="rps-buy-grid">${canBuy}</div>
    `;

    els.shopPanel.querySelectorAll(".rps-buy-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const power = btn.dataset.buy;
            const cost = PowerCosts[power];
            if (player.coins < cost) return;
            player.coins -= cost;
            player.inventory.push(power);
            state.currentAvailable[actor] = getAvailablePowerUps(actor, []);
            renderShop();
            renderPowerUps();
            renderScore();
        });
    });
}

function renderPowerUps() {
    const actor = state.mode === "single" ? 0 : state.localStep;
    const available = state.currentAvailable[actor] || [];
    const player = state.players[actor];

    const cooldownInfo = state.powerMode === "cooldown"
        ? `<div class="lobby-hint">Cooldowns: ${PowerUpList.map(p => `${PowerUpLabels[p]} ${player.cooldowns[p] > 0 ? `(${player.cooldowns[p]})` : "(ready)"}`).join(" · ")}</div>`
        : "";

    els.powerPanel.innerHTML = `
        <div class="lobby-hint">${escapeHtml(player.name)} available power-ups (optional):</div>
        <div class="rps-power-grid">
            <button class="btn btn-outline rps-power-btn ${state.selectedPower ? "" : "active"}" data-power="">No Power-Up</button>
            ${available.map(p => `<button class="btn btn-outline rps-power-btn ${state.selectedPower === p ? "active" : ""}" data-power="${p}">${PowerUpLabels[p]}</button>`).join("")}
        </div>
        ${cooldownInfo}
    `;

    els.powerPanel.querySelectorAll(".rps-power-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            state.selectedPower = btn.dataset.power || null;
            renderPowerUps();
            renderPeekPanel();
            renderStatus();
        });
    });

    renderPeekPanel();
}

function renderPeekPanel() {
    const actor = state.mode === "single" ? 0 : state.localStep;
    const revealSelected = state.selectedPower === PowerUps.Reveal;

    if (!revealSelected) {
        els.peekPanel.style.display = "none";
        els.peekPanel.innerHTML = "";
        return;
    }

    els.peekPanel.style.display = "block";

    if (state.mode === "single") {
        els.peekPanel.innerHTML = `<button id="peekBtn" class="btn btn-sp">Reveal CPU Move (0.5s early)</button><div id="peekText" class="lobby-hint"></div>`;
        document.getElementById("peekBtn").addEventListener("click", async () => {
            if (!state.pendingAiSelection) state.pendingAiSelection = buildAiSelection();
            const txt = document.getElementById("peekText");
            txt.textContent = `CPU is preparing: ${state.pendingAiSelection.move}`;
            await delay(500);
            txt.textContent = `Reveal complete. You may now lock your move.`;
        });
    } else {
        const otherSelection = state.pendingSelections[1 - actor];
        if (!otherSelection) {
            els.peekPanel.innerHTML = `<div class="lobby-hint">Reveal activates once opponent locks first.</div>`;
            return;
        }
        els.peekPanel.innerHTML = `<div class="lobby-hint">Reveal: opponent's move shown 0.5s early...</div><div id="peekText" class="lobby-hint"></div>`;
        delay(500).then(() => {
            const txt = document.getElementById("peekText");
            if (txt) txt.textContent = `Opponent move: ${otherSelection.move}`;
        });
    }
}

function lockSelection() {
    if (state.gameOver) return;
    if (!state.selectedMove) {
        renderStatus("Pick Rock, Paper, or Scissors first.");
        return;
    }

    const actor = state.mode === "single" ? 0 : state.localStep;
    const selection = {
        move: state.selectedMove,
        power: state.selectedPower
    };

    if (state.mode === "single") {
        const aiSelection = state.pendingAiSelection ?? buildAiSelection();
        resolveRound(selection, aiSelection);
        return;
    }

    state.pendingSelections[actor] = selection;

    if (actor === 0) {
        state.localStep = 1;
        state.selectedMove = null;
        state.selectedPower = null;
        els.moveBtns.forEach(b => b.classList.remove("active"));
        renderShop();
        renderPowerUps();
        renderStatus("Player 1 locked in. Pass to Player 2 and make a hidden selection.");
    } else {
        resolveRound(state.pendingSelections[0], state.pendingSelections[1]);
    }
}

function resolveRound(playerSelection, opponentSelection) {
    let pMove = playerSelection.move;
    let oMove = opponentSelection.move;
    let pPower = playerSelection.power;
    let oPower = opponentSelection.power;

    // 1) Sabotage
    if (pPower === PowerUps.Sabotage && oPower !== PowerUps.Sabotage) oPower = null;
    if (oPower === PowerUps.Sabotage && pPower !== PowerUps.Sabotage) pPower = null;

    // 2) Lock-In
    if (pPower === PowerUps.LockIn && state.players[1].lastMove) oMove = state.players[1].lastMove;
    if (oPower === PowerUps.LockIn && state.players[0].lastMove) pMove = state.players[0].lastMove;

    // 3) Reveal (already handled by UI)

    // 4) Reverse
    const reverse = pPower === PowerUps.Reverse || oPower === PowerUps.Reverse;

    // 5) Randomizer
    if (pPower === PowerUps.Randomizer) pMove = weightedRandomMove(oMove, reverse);
    if (oPower === PowerUps.Randomizer) oMove = weightedRandomMove(pMove, reverse);

    // 8) Charge check, then winner
    const pCharge = pPower === PowerUps.Charge;
    const oCharge = oPower === PowerUps.Charge;

    let compare = 0;
    if (pCharge && oCharge) compare = 0;
    else if (pCharge) compare = -1;
    else if (oCharge) compare = 1;
    else compare = compareMoves(pMove, oMove, reverse);

    // 6) Shield
    if (compare < 0 && pPower === PowerUps.Shield) compare = 0;
    if (compare > 0 && oPower === PowerUps.Shield) compare = 0;

    // 7) Double Strike
    let pPoints = 0;
    let oPoints = 0;
    let winnerText = "Tie";
    if (compare > 0) {
        pPoints = pPower === PowerUps.DoubleStrike ? 2 : 1;
        state.players[0].score += pPoints;
        state.players[0].coins += pPoints;
        winnerText = state.players[0].name;
    } else if (compare < 0) {
        oPoints = oPower === PowerUps.DoubleStrike ? 2 : 1;
        state.players[1].score += oPoints;
        state.players[1].coins += oPoints;
        winnerText = state.players[1].name;
    }

    if (pCharge) state.players[0].chargeRewardCount = 2;
    if (oCharge) state.players[1].chargeRewardCount = 2;

    consumePower(0, pPower);
    consumePower(1, oPower);

    state.players[0].lastMove = pMove;
    state.players[1].lastMove = oMove;
    state.players[0].history.push(pMove);
    state.players[1].history.push(oMove);

    const result = {
        round: state.round,
        playerMove: pMove,
        opponentMove: oMove,
        playerPower: pPower,
        opponentPower: oPower,
        reverse,
        winner: winnerText,
        pPoints,
        oPoints
    };

    state.history.unshift(result);
    renderRoundSummary(result);
    renderHistory();
    renderScore();
    renderEffects(result);

    if (shouldEndMatch()) {
        endMatch();
    } else {
        beginRound();
    }
}

function consumePower(playerIndex, power) {
    if (!power) return;
    const player = state.players[playerIndex];
    if (state.powerMode === "cooldown") {
        player.cooldowns[power] = 3;
    } else if (state.powerMode === "shop") {
        const idx = player.inventory.indexOf(power);
        if (idx >= 0) player.inventory.splice(idx, 1);
    }
}

function shouldEndMatch() {
    if (state.format === "timed") return Date.now() >= state.timerEndAt;
    if (state.format === "best5") return state.players[0].score >= 3 || state.players[1].score >= 3;
    return state.players[0].score >= 4 || state.players[1].score >= 4;
}

function endMatch() {
    if (state.gameOver) return;
    state.gameOver = true;
    stopTimer();

    let text = "Match tied!";
    if (state.players[0].score > state.players[1].score) text = `${state.players[0].name} wins the match!`;
    else if (state.players[1].score > state.players[0].score) text = `${state.players[1].name} wins the match!`;

    els.resultText.textContent = `${text} Final: ${state.players[0].score} - ${state.players[1].score}`;
    els.resultOverlay.style.display = "flex";
    renderStatus("Match complete.");
}

function renderStatus(override) {
    if (override) {
        els.statusText.textContent = override;
        return;
    }
    if (state.mode === "single") {
        els.statusText.textContent = `Round ${state.round}: choose your move${state.selectedPower ? ` + ${PowerUpLabels[state.selectedPower]}` : ""}.`;
        return;
    }
    const currentName = state.players[state.localStep].name;
    els.statusText.textContent = `Round ${state.round}: ${currentName}, choose move + optional power-up secretly.`;
}

function renderScore() {
    els.scoreText.textContent = `${state.players[0].score} : ${state.players[1].score}`;
}

function renderRoundSummary(result) {
    const pPow = result.playerPower ? PowerUpLabels[result.playerPower] : "None";
    const oPow = result.opponentPower ? PowerUpLabels[result.opponentPower] : "None";
    els.roundSummary.innerHTML = `
        <strong>Round ${result.round}</strong><br>
        ${escapeHtml(state.players[0].name)}: ${result.playerMove} (${pPow})<br>
        ${escapeHtml(state.players[1].name)}: ${result.opponentMove} (${oPow})<br>
        Winner: ${escapeHtml(result.winner)}
    `;
}

function renderHistory() {
    els.historyLog.innerHTML = state.history.slice(0, 12).map(h => {
        const pPow = h.playerPower ? PowerUpLabels[h.playerPower] : "None";
        const oPow = h.opponentPower ? PowerUpLabels[h.opponentPower] : "None";
        return `
            <div class="rps-history-item">
                <div><strong>R${h.round}</strong> · ${escapeHtml(h.winner)} · ${h.pPoints}-${h.oPoints}</div>
                <div>${escapeHtml(state.players[0].name)}: ${h.playerMove} (${pPow})</div>
                <div>${escapeHtml(state.players[1].name)}: ${h.opponentMove} (${oPow})</div>
            </div>
        `;
    }).join("");
}

function renderEffects(result) {
    const effects = [];
    if (result.playerPower === PowerUps.Shield || result.opponentPower === PowerUps.Shield) effects.push({ cls: "shield", text: "🛡 Shield activated" });
    if (result.reverse) effects.push({ cls: "reverse", text: "🔄 Reverse rules active" });
    if (result.playerPower === PowerUps.LockIn || result.opponentPower === PowerUps.LockIn) effects.push({ cls: "lockin", text: "🔒 Lock-In forced repeat move" });
    if (result.playerPower === PowerUps.DoubleStrike || result.opponentPower === PowerUps.DoubleStrike) effects.push({ cls: "doublestrike", text: "⚡ Double Strike bonus possible" });
    if (effects.length === 0) {
        els.effectBanner.style.display = "none";
        return;
    }

    const top = effects[0];
    els.effectBanner.className = `rps-effect-banner ${top.cls}`;
    els.effectBanner.textContent = top.text;
    els.effectBanner.style.display = "block";
    setTimeout(() => { els.effectBanner.style.display = "none"; }, 1200);
}

function autoShopForAi() {
    if (state.powerMode !== "shop") return;
    const ai = state.players[1];
    const affordable = PowerUpList.filter(p => ai.coins >= PowerCosts[p]);
    if (!affordable.length) return;
    const choice = ai.coins >= 3 && affordable.includes(PowerUps.DoubleStrike)
        ? PowerUps.DoubleStrike
        : affordable[Math.floor(Math.random() * affordable.length)];
    ai.coins -= PowerCosts[choice];
    ai.inventory.push(choice);
    state.currentAvailable[1] = getAvailablePowerUps(1, []);
}

function buildAiSelection() {
    const available = state.currentAvailable[1] || [];
    let move;

    if (state.difficulty === "easy") {
        move = randomMove();
    } else if (state.difficulty === "normal") {
        move = normalAiMove();
    } else {
        move = hardAiMove();
    }

    let power = null;
    if (available.length) {
        if (state.difficulty === "easy") {
            if (Math.random() < 0.45) power = available[Math.floor(Math.random() * available.length)];
        } else if (state.difficulty === "normal") {
            power = chooseStrategicPower(move, available, false);
        } else {
            power = chooseStrategicPower(move, available, true);
        }
    }

    return { move, power };
}

function normalAiMove() {
    const history = state.players[0].history;
    if (!history.length) return randomMove();

    const counts = { Rock: 0, Paper: 0, Scissors: 0 };
    history.slice(-8).forEach(m => counts[m]++);
    const predicted = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    if (Math.random() < 0.7) return counterMove(predicted, false);
    return randomMove();
}

function hardAiMove() {
    const history = state.players[0].history;
    if (history.length < 2) return randomMove();

    const recent = history.slice(-5);
    const counts = { Rock: 0, Paper: 0, Scissors: 0 };
    for (const m of recent) counts[m] += 1;

    // Simple predictive weighting with recency bias
    let predicted;
    if (counts.Rock >= counts.Paper && counts.Rock >= counts.Scissors) predicted = Moves.Rock;
    else if (counts.Paper >= counts.Scissors) predicted = Moves.Paper;
    else predicted = Moves.Scissors;

    return counterMove(predicted, false);
}

function chooseStrategicPower(aiMove, available, hard) {
    const playerLikely = state.players[0].history.length ? state.players[0].history[state.players[0].history.length - 1] : randomMove();
    const aiWouldLose = compareMoves(aiMove, playerLikely, false) < 0;
    const aiWouldWin = compareMoves(aiMove, playerLikely, false) > 0;

    if (aiWouldLose && available.includes(PowerUps.Shield)) return PowerUps.Shield;
    if (aiWouldWin && available.includes(PowerUps.DoubleStrike)) return PowerUps.DoubleStrike;
    if (hard && available.includes(PowerUps.Sabotage)) return PowerUps.Sabotage;
    if (hard && available.includes(PowerUps.LockIn) && state.players[0].lastMove) return PowerUps.LockIn;
    if (available.includes(PowerUps.Randomizer) && !aiWouldWin) return PowerUps.Randomizer;
    if (available.includes(PowerUps.Reverse) && aiWouldLose) return PowerUps.Reverse;
    return available[0] ?? null;
}

function compareMoves(playerMove, opponentMove, reverse) {
    if (playerMove === opponentMove) return 0;
    let win = (playerMove === Moves.Rock && opponentMove === Moves.Scissors)
        || (playerMove === Moves.Scissors && opponentMove === Moves.Paper)
        || (playerMove === Moves.Paper && opponentMove === Moves.Rock);
    if (reverse) win = !win;
    return win ? 1 : -1;
}

function counterMove(move, reverse) {
    if (!reverse) {
        if (move === Moves.Rock) return Moves.Paper;
        if (move === Moves.Paper) return Moves.Scissors;
        return Moves.Rock;
    }
    if (move === Moves.Rock) return Moves.Scissors;
    if (move === Moves.Paper) return Moves.Rock;
    return Moves.Paper;
}

function weightedRandomMove(opponentMove, reverse) {
    const winning = counterMove(opponentMove, reverse);
    const moves = [Moves.Rock, Moves.Paper, Moves.Scissors];
    const others = moves.filter(m => m !== winning);
    const pool = [
        ...Array(10).fill(winning),
        ...Array(7).fill(others[0]),
        ...Array(7).fill(others[1])
    ];
    return pool[Math.floor(Math.random() * pool.length)];
}

function randomMove() {
    const m = Object.values(Moves);
    return m[Math.floor(Math.random() * m.length)];
}

function randomPowerUp() {
    return PowerUpList[Math.floor(Math.random() * PowerUpList.length)];
}

function dedupe(list) {
    return [...new Set(list)];
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function applyQueryDefaults() {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const difficulty = params.get("difficulty");
    if (mode === "single" || mode === "local") els.modeSelect.value = mode;
    if (difficulty && [ "easy", "normal", "hard" ].includes(difficulty)) els.difficultySelect.value = difficulty;
    els.difficultySelect.disabled = els.modeSelect.value !== "single";
}

els.difficultySelect.disabled = els.modeSelect.value !== "single";
applyQueryDefaults();
