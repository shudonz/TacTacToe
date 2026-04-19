const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId = sessionStorage.getItem("concentrationRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
const CARD_BACK_EMOJI = "🧠";
let myName = sessionStorage.getItem("myName") || "";
let gameState = null;

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

async function init() {
    if (!myName) {
        const res = await fetch("/api/me");
        const me = await res.json();
        myName = me.name;
    }

    connection.on("ConcentrationUpdated", state => {
        gameState = state;
        renderState(state);
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("statusText").textContent = name + " left the game.";
    });

    await connection.start();
    await connection.invoke("RejoinConcentrationRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

function renderState(state) {
    const players = document.getElementById("concentrationPlayers");
    players.innerHTML = "";
    state.players.forEach((p, i) => {
        const item = document.createElement("div");
        item.className = "player-bar-item" + (i === state.currentPlayerIndex && !state.isOver ? " active" : "") + (p.name === myName ? " is-me" : "");
        item.innerHTML = '<span class="room-player-name">' + esc(p.name) + '</span>'
            + '<span class="player-score">' + p.score + "</span>";
        players.appendChild(item);
    });

    const myTurn = state.players[state.currentPlayerIndex]?.name === myName;
    document.getElementById("statusText").textContent = state.isOver
        ? (state.winnerName ? (state.winnerName === myName ? "You win! 🎉" : state.winnerName + " wins!") : "It's a tie!")
        : (myTurn ? "Your turn - flip two cards" : (state.players[state.currentPlayerIndex]?.name || "Player") + "'s turn");

    const board = document.getElementById("concentrationBoard");
    board.innerHTML = "";
    state.cards.forEach(card => {
        const btn = document.createElement("button");
        btn.className = "concentration-card";
        if (card.isMatched) btn.classList.add("matched");
        if (card.isRevealed || card.isMatched) btn.classList.add("revealed");
        btn.disabled = state.isOver || !myTurn || card.isMatched || card.isRevealed || state.turnLocked;
        btn.innerHTML = '<span class="concentration-card-front">' + CARD_BACK_EMOJI + '</span><span class="concentration-card-back">' + (card.emoji || "") + "</span>";
        btn.onclick = () => connection.invoke("ConcentrationFlipCard", roomId, card.index);
        board.appendChild(btn);
    });

    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You found the most matches!" : state.winnerName + " wins!")
            : "It's a tie!";
        document.getElementById("resultOverlay").style.display = "flex";
    }
}

function backToLobby() {
    connection.invoke("LeaveConcentrationGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

document.getElementById("backBtn").addEventListener("click", backToLobby);
document.getElementById("backToLobby").addEventListener("click", backToLobby);

function initChat(conn, groupId) {
    let chatOpen = false, unread = 0;
    const toggle = document.getElementById("chatToggle"), panel = document.getElementById("chatPanel"),
          close = document.getElementById("chatClose"), input = document.getElementById("chatInput"),
          send = document.getElementById("chatSend"), msgs = document.getElementById("chatMessages"),
          badge = document.getElementById("chatBadge");
    toggle.onclick = () => { chatOpen = !chatOpen; panel.style.display = chatOpen ? "flex" : "none"; if (chatOpen) { unread = 0; badge.style.display = "none"; msgs.scrollTop = msgs.scrollHeight; input.focus(); } };
    close.onclick = () => { chatOpen = false; panel.style.display = "none"; };
    function doSend() { const m = input.value.trim(); if (!m) return; conn.invoke("SendChat", groupId, m); input.value = ""; }
    send.onclick = doSend;
    input.addEventListener("keydown", e => { if (e.key === "Enter") doSend(); });
    conn.on("ChatMessage", (name, message) => {
        const el = document.createElement("div"); el.className = "chat-msg";
        el.innerHTML = '<span class="chat-name">' + esc(name) + '</span> <span class="chat-text">' + esc(message) + '</span>';
        msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
        if (!chatOpen) { unread++; badge.textContent = unread; badge.style.display = "inline-flex"; }
    });
}

init();
