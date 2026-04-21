const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("chineseCheckersRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) {
    window.location.replace("/lobby");
    throw new Error("Missing Chinese Checkers room id");
}

let myName = sessionStorage.getItem("myName") || "";
let state = null;
let selectedPiece = null;
let _gameOverEventFired = false;
let _hintTimer = null;

const COLORS = ["#ef4444", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#14b8a6", "#f97316"];

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    try {
        if (!myName) {
            const me = await fetch("/api/me").then(r => r.json());
            myName = me.name;
        }

        connection.on("ChineseCheckersUpdated", s => {
            state = s;
            renderState();
        });

        connection.on("ChineseCheckersHint", hint => {
            if (!hint || !hint.hintAvailable) {
                showTypedHint("No legal moves available.");
                return;
            }
            selectedPiece = hint.pieceId;
            renderState();
            showTypedHint(hint.description || "Try advancing one of your marbles toward its goal.");
        });

        connection.on("PlayerLeft", name => {
            document.getElementById("ccStatus").textContent = name + " left the game.";
        });

        await connection.start();
        await connection.invoke("RejoinChineseCheckersRoom", roomId);
    } catch (err) {
        console.error("Chinese Checkers init failed:", err);
        document.getElementById("ccStatus").textContent = "Failed to load game. Please refresh the page.";
    }
}

function renderState() {
    if (!state) return;

    const playersEl = document.getElementById("ccPlayers");
    playersEl.innerHTML = "";

    fetchAvatars(state.players.map(p => p.name));

    state.players.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "player-bar-item" + (i === state.currentPlayerIndex && !state.isOver ? " active" : "") + (p.name === myName ? " is-me" : "");
        const rank = p.finishRank > 0 ? ` <span class="cc-rank">#${p.finishRank}</span>` : "";
        el.innerHTML = avatarHtml(p.name, 'sm') +
            '<span class="room-player-name">' + esc(p.name) + '</span>' +
            '<span class="player-score">' + p.score + rank + '</span>';
        playersEl.appendChild(el);
    });

    const current = state.players[state.currentPlayerIndex];
    const myTurn = !!current && current.name === myName;

    const status = state.isOver
        ? (state.winnerName === myName ? "You win! 🎉" : (state.winnerName ? (state.winnerName + " wins!") : "Game over"))
        : (myTurn ? "Your turn — select a marble" : (current ? `${current.name}'s turn` : "Waiting..."));
    document.getElementById("ccStatus").textContent = status;

    renderBoard(myTurn);

    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName === myName ? "You won Chinese Checkers!" : (state.winnerName ? `${state.winnerName} wins!` : "Game over");
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverEventFired) { _gameOverEventFired = true; document.dispatchEvent(new Event("gameOver")); }
    }
}

function renderBoard(myTurn) {
    const board = document.getElementById("ccBoard");
    board.innerHTML = "";

    const pieceByNode = new Map();
    (state.pieces || []).forEach(p => pieceByNode.set(p.nodeId, p));

    const legalMoves = (state.legalMoves || []);
    const legalByPiece = new Map();
    legalMoves.forEach(m => {
        if (!legalByPiece.has(m.pieceId)) legalByPiece.set(m.pieceId, []);
        legalByPiece.get(m.pieceId).push(m);
    });

    state.nodes.forEach(node => {
        const nodeEl = document.createElement("button");
        nodeEl.className = "cc-node";
        nodeEl.style.left = node.x + "%";
        nodeEl.style.top = node.y + "%";
        nodeEl.dataset.nodeId = node.id;

        const piece = pieceByNode.get(node.id);
        if (piece) {
            const owner = state.players[piece.ownerIndex];
            const dot = document.createElement("span");
            dot.className = "cc-piece" + (selectedPiece === piece.id ? " selected" : "");
            dot.style.background = COLORS[(owner?.colorIndex ?? piece.ownerIndex) % COLORS.length];
            dot.title = owner?.name || "Player";
            nodeEl.appendChild(dot);

            if (myTurn && owner && owner.name === myName) {
                nodeEl.classList.add("cc-node-clickable");
                nodeEl.onclick = () => {
                    selectedPiece = piece.id;
                    renderBoard(myTurn);
                };
            }
        }

        if (selectedPiece && !piece) {
            const options = legalByPiece.get(selectedPiece) || [];
            const move = options.find(m => m.toNodeId === node.id);
            if (move) {
                nodeEl.classList.add("cc-legal-move");
                nodeEl.title = move.isJump ? "Jump" : "Step";
                if (myTurn) {
                    nodeEl.onclick = () => {
                        connection.invoke("ChineseCheckersMove", roomId, selectedPiece, node.id);
                        selectedPiece = null;
                    };
                }
            }
        }

        board.appendChild(nodeEl);
    });
}

function showTypedHint(text) {
    const el = document.getElementById("ccHintBanner");
    if (_hintTimer) clearInterval(_hintTimer);
    el.style.display = "block";
    el.textContent = "";

    let i = 0;
    _hintTimer = setInterval(() => {
        i++;
        el.textContent = text.slice(0, i);
        if (i >= text.length) {
            clearInterval(_hintTimer);
            _hintTimer = null;
        }
    }, 18);
}

function backToLobby() {
    connection.invoke("LeaveChineseCheckersGame", roomId).finally(() => {
        window.location.href = "/lobby";
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById("ccHintBtn").addEventListener("click", () => {
        connection.invoke("RequestChineseCheckersHint", roomId);
    });

    document.getElementById("ccBackBtn").addEventListener("click", backToLobby);
    document.getElementById("backToLobby").addEventListener("click", backToLobby);
    document.getElementById("hamBackBtn").addEventListener("click", backToLobby);
});

init();
