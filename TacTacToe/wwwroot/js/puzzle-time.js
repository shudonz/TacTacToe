// ============================================================
// Puzzle Time – client-side game logic
// Jigsaw pieces rendered as SVG with tab/blank connectors.
// Pieces are freely draggable; they snap to correct slot when
// dropped within ~65 % of one cell radius from the target.
// ============================================================

const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
const roomId      = sessionStorage.getItem("puzzleTimeRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing Puzzle Time room id"); }

let myName           = sessionStorage.getItem("myName") || "";
let state            = null;
let _ac              = null;
let _gameOverFired   = false;
let _draggingTileId  = null;   // id of tile currently being dragged by this client

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function tileById(id) { return state?.tiles?.find(t => t.id === id) || null; }
function isMine(tile)  { return !!tile && tile.lockedByName === myName; }
function getGrid()     { return { rows: state?.settings?.grid?.rows || 5, cols: state?.settings?.grid?.cols || 5 }; }
function board()       { return document.getElementById("pt-board"); }

// ---------------------------------------------------------------
// Audio
// ---------------------------------------------------------------
function audioCtx() {
    if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
    return _ac;
}
function tone(freq, dur=0.11, vol=0.1, type='sine', delay=0) {
    const ac=audioCtx(); if(!ac) return;
    const o=ac.createOscillator(), g=ac.createGain(), t=ac.currentTime+delay;
    o.connect(g); g.connect(ac.destination);
    o.type=type; o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.start(t); o.stop(t+dur+0.05);
}
function sndPickup()  { tone(520, 0.07, 0.08); }
function sndPlace()   { tone(660, 0.08, 0.1); tone(880, 0.12, 0.07, 'sine', 0.06); }
function sndSnap()    { tone(880, 0.05, 0.12); tone(1100, 0.1, 0.09, 'sine', 0.04); }
function sndDeny()    { tone(220, 0.14, 0.09, 'triangle'); }
function sndWin()     { [523,659,784,1047].forEach((f,i)=>tone(f,0.2,0.12,'sine',i*0.12)); }

function launchConfetti(count=140) {
    const colors=['#fbbf24','#f472b6','#36d6c3','#7c6aff','#12919E','#ff8a47'];
    for (let i=0; i<count; i++) {
        setTimeout(()=>{
            const el=document.createElement('div');
            el.className='pt-confetti';
            el.style.left=(Math.random()*100)+'%';
            el.style.background=colors[i%colors.length];
            el.style.animationDuration=(1.4+Math.random()*1.6)+'s';
            document.body.appendChild(el);
            setTimeout(()=>el.remove(),3400);
        }, i*12);
    }
}

// ---------------------------------------------------------------
// SVG puzzle-piece path generator
// ps  = piece body size (px)
// pd  = tab overflow padding (px)
// conn = [top, right, bottom, left]: 1=tab, -1=blank, 0=flat
// The piece body occupies the rect (pd, pd) → (pd+ps, pd+ps) inside
// the SVG viewport.  Tabs extend into the padding zone.
// ---------------------------------------------------------------
function puzzlePiecePath(ps, pd, conn) {
    const [T, R, B, L] = conn;
    const x0 = pd, y0 = pd, x1 = pd+ps, y1 = pd+ps;
    const tH = ps * 0.23;   // tab height (protrusion)
    const tW = ps * 0.19;   // half-width of tab base

    // Build one edge of the path.  Travels from (ax,ay) to (bx,by).
    // The right-hand normal of the travel direction points outward (clockwise winding).
    function edge(ax, ay, bx, by, c) {
        if (c === 0) return `L${bx} ${by}`;

        const len = Math.hypot(bx-ax, by-ay);
        const dx = (bx-ax)/len, dy = (by-ay)/len;
        // Right-hand normal for clockwise path = outward direction
        const nx = dy, ny = -dx;
        const dir = c;            // +1 = tab out,  -1 = blank in

        const mx = (ax+bx)*0.5, my = (ay+by)*0.5;
        // Points where the tab begins / ends on the edge
        const t1x = mx - dx*tW, t1y = my - dy*tW;
        const t2x = mx + dx*tW, t2y = my + dy*tW;
        // Peak of the tab
        const px = mx + nx*tH*dir, py = my + ny*tH*dir;

        // Two cubic Béziers: straight-edge → t1 → peak, then peak → t2 → straight-edge
        return `L${t1x} ${t1y}` +
               ` C${t1x + nx*tH*0.55*dir} ${t1y + ny*tH*0.55*dir}` +
               `  ${px - dx*tW*0.55} ${py - dy*tW*0.55}` +
               `  ${px} ${py}` +
               ` C${px + dx*tW*0.55} ${py + dy*tW*0.55}` +
               `  ${t2x + nx*tH*0.55*dir} ${t2y + ny*tH*0.55*dir}` +
               `  ${t2x} ${t2y}` +
               ` L${bx} ${by}`;
    }

    return `M${x0} ${y0}` +
           edge(x0, y0, x1, y0, T) +  // top   (left → right, outside = up)
           edge(x1, y0, x1, y1, R) +  // right (top  → bottom, outside = right)
           edge(x1, y1, x0, y1, B) +  // bottom(right→ left, outside = down)
           edge(x0, y1, x0, y0, L) +  // left  (bottom→ top, outside = left)
           `Z`;
}

// ---------------------------------------------------------------
// Board geometry helpers
// ---------------------------------------------------------------
function boardMetrics() {
    const b = board();
    const bw = b.clientWidth  || 500;
    const bh = b.clientHeight || 500;
    const { rows, cols }  = getGrid();
    const cellW  = bw / cols;
    const cellH  = bh / rows;
    const ps     = Math.floor(Math.min(cellW, cellH) * 0.88); // piece body ≤ cell size
    const pd     = Math.ceil(ps * 0.32);                       // padding for tab overflow
    const svgSz  = ps + 2*pd;
    return { bw, bh, rows, cols, cellW, cellH, ps, pd, svgSz };
}

// Pixel position (top-left of piece SVG) from normalised centre coords
function piecePixelPos(nx, ny, m) {
    return {
        left: nx * m.bw - m.ps/2 - m.pd,
        top:  ny * m.bh - m.ps/2 - m.pd
    };
}

// ---------------------------------------------------------------
// Ghost slot layer (shows target outlines on the board)
// ---------------------------------------------------------------
function renderGhosts(showHints) {
    const b = board();
    let svg = document.getElementById("pt-ghost-svg");
    if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.id = "pt-ghost-svg";
        svg.classList.add("pt-ghost-svg");
        b.insertBefore(svg, b.firstChild);
    }
    svg.innerHTML = "";
    if (!state) return;

    const m = boardMetrics();
    svg.setAttribute("width",  m.bw);
    svg.setAttribute("height", m.bh);
    svg.setAttribute("viewBox", `0 0 ${m.bw} ${m.bh}`);

    state.tiles.forEach(t => {
        const row = Math.floor(t.correctIndex / m.cols);
        const col = t.correctIndex % m.cols;
        const cx  = (col + 0.5) / m.cols;
        const cy  = (row + 0.5) / m.rows;
        const pos = piecePixelPos(cx, cy, m);

        const g = document.createElementNS("http://www.w3.org/2000/svg","g");
        g.setAttribute("transform", `translate(${pos.left},${pos.top})`);

        const pathStr = puzzlePiecePath(m.ps, m.pd, t.connectors);

        if (t.isPlaced) {
            // Placed piece: subtle filled + emoji
            const filled = document.createElementNS("http://www.w3.org/2000/svg","path");
            filled.setAttribute("d", pathStr);
            filled.setAttribute("fill", "rgba(54,214,195,0.13)");
            filled.setAttribute("stroke","rgba(54,214,195,0.35)");
            filled.setAttribute("stroke-width","1.5");
            g.appendChild(filled);

            const txt = document.createElementNS("http://www.w3.org/2000/svg","text");
            txt.setAttribute("x", m.pd + m.ps/2);
            txt.setAttribute("y", m.pd + m.ps/2 + 1);
            txt.setAttribute("text-anchor","middle");
            txt.setAttribute("dominant-baseline","middle");
            txt.setAttribute("font-size", Math.max(12, m.ps * 0.52));
            txt.textContent = t.face;
            g.appendChild(txt);
        } else if (showHints) {
            // Unplaced slot: faint dashed outline + tiny emoji hint
            const outline = document.createElementNS("http://www.w3.org/2000/svg","path");
            outline.setAttribute("d", pathStr);
            outline.setAttribute("fill","rgba(255,255,255,0.03)");
            outline.setAttribute("stroke","rgba(255,255,255,0.14)");
            outline.setAttribute("stroke-width","1");
            outline.setAttribute("stroke-dasharray","4 3");
            g.appendChild(outline);

            const hint = document.createElementNS("http://www.w3.org/2000/svg","text");
            hint.setAttribute("x", m.pd + m.ps/2);
            hint.setAttribute("y", m.pd + m.ps/2 + 1);
            hint.setAttribute("text-anchor","middle");
            hint.setAttribute("dominant-baseline","middle");
            hint.setAttribute("font-size", Math.max(8, m.ps * 0.28));
            hint.setAttribute("opacity","0.35");
            hint.textContent = t.face;
            g.appendChild(hint);
        }

        svg.appendChild(g);
    });
}

// ---------------------------------------------------------------
// Piece rendering
// ---------------------------------------------------------------
function renderPieces() {
    if (!state) return;
    const m = boardMetrics();
    const b = board();
    const showHints = document.getElementById("showHintsChk")?.checked ?? true;

    // Ghost layer must be current
    renderGhosts(showHints);

    // Track which piece elements already exist
    const existing = new Set([...b.querySelectorAll(".pt-piece")].map(el => el.dataset.tileId));

    state.tiles.forEach(tile => {
        const pos  = piecePixelPos(tile.x, tile.y, m);
        const elId = "pt-piece-" + tile.id;
        let el     = document.getElementById(elId);

        if (!el) {
            el = buildPieceEl(tile, m);
            b.appendChild(el);
            makeDraggable(el, tile.id);
        }
        existing.delete(tile.id);

        // Update position (skip if this client is currently dragging this piece)
        if (tile.id !== _draggingTileId) {
            el.style.left = pos.left + "px";
            el.style.top  = pos.top  + "px";
        }

        // Update visual state
        updatePieceVisuals(el, tile, m);
    });

    // Remove orphaned pieces (shouldn't happen but be safe)
    existing.forEach(id => document.getElementById("pt-piece-"+id)?.remove());
}

function buildPieceEl(tile, m) {
    const svgNS  = "http://www.w3.org/2000/svg";
    const svg    = document.createElementNS(svgNS, "svg");
    svg.id       = "pt-piece-" + tile.id;
    svg.dataset.tileId = tile.id;
    svg.classList.add("pt-piece");
    svg.setAttribute("width",  m.svgSz);
    svg.setAttribute("height", m.svgSz);
    svg.setAttribute("viewBox", `0 0 ${m.svgSz} ${m.svgSz}`);
    svg.style.cssText = `position:absolute;width:${m.svgSz}px;height:${m.svgSz}px;`;
    svg.style.cursor  = "grab";

    const pathStr = puzzlePiecePath(m.ps, m.pd, tile.connectors);

    // Clip path so only the piece shape is interactive / visible
    const defs = document.createElementNS(svgNS, "defs");
    const clip = document.createElementNS(svgNS, "clipPath");
    clip.id    = "clip-" + tile.id;
    const cp   = document.createElementNS(svgNS, "path");
    cp.setAttribute("d", pathStr);
    clip.appendChild(cp); defs.appendChild(clip); svg.appendChild(defs);

    // Background fill
    const bg = document.createElementNS(svgNS, "path");
    bg.setAttribute("d", pathStr);
    bg.setAttribute("clip-path", `url(#clip-${tile.id})`);
    bg.classList.add("pt-piece-bg");
    svg.appendChild(bg);

    // Border stroke
    const border = document.createElementNS(svgNS, "path");
    border.setAttribute("d", pathStr);
    border.setAttribute("fill","none");
    border.classList.add("pt-piece-border");
    svg.appendChild(border);

    // Emoji face
    const face = document.createElementNS(svgNS, "text");
    face.setAttribute("x", m.pd + m.ps/2);
    face.setAttribute("y", m.pd + m.ps/2 + 1);
    face.setAttribute("text-anchor","middle");
    face.setAttribute("dominant-baseline","middle");
    face.setAttribute("font-size", Math.max(12, m.ps * 0.52));
    face.classList.add("pt-piece-face");
    face.textContent = tile.face;
    svg.appendChild(face);

    // Lock badge (initially hidden)
    const badge = document.createElementNS(svgNS, "text");
    badge.classList.add("pt-piece-lock");
    badge.setAttribute("x", m.pd + m.ps/2);
    badge.setAttribute("y", m.pd + m.ps - 4);
    badge.setAttribute("text-anchor","middle");
    badge.setAttribute("font-size", Math.max(6, m.ps * 0.14));
    badge.style.display = "none";
    svg.appendChild(badge);

    return svg;
}

function updatePieceVisuals(el, tile, m) {
    const mine      = isMine(tile);
    const lockedOther = tile.isLocked && !mine;
    const placed    = tile.isPlaced;

    el.classList.toggle("pt-piece--mine",        mine);
    el.classList.toggle("pt-piece--locked-other", lockedOther);
    el.classList.toggle("pt-piece--placed",       placed);
    el.style.cursor = placed ? "default" : (lockedOther ? "not-allowed" : "grab");

    // Lock badge
    const badge = el.querySelector(".pt-piece-lock");
    if (badge) {
        if (tile.lockedByName && tile.lockedByName !== myName) {
            badge.textContent = tile.lockedByName;
            badge.style.display = "";
        } else {
            badge.style.display = "none";
        }
    }

    // Placed pieces sit at z=0, dragged/locked at higher z
    if (!placed) {
        el.style.zIndex = mine ? "10" : "1";
    } else {
        el.style.zIndex = "0";
    }
}

// ---------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------
function makeDraggable(el, tileId) {
    el.addEventListener("pointerdown", (e) => {
        if (!state || state.isOver) return;

        const tile = tileById(tileId);
        if (!tile) return;
        if (tile.isPlaced) return;          // already solved; don't move
        if (tile.isLocked && !isMine(tile)) { sndDeny(); return; }

        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);

        const b = board();
        const br = b.getBoundingClientRect();
        const startLeft = parseFloat(el.style.left) || 0;
        const startTop  = parseFloat(el.style.top)  || 0;
        const offsetX   = e.clientX - br.left - startLeft;
        const offsetY   = e.clientY - br.top  - startTop;

        let wasDragged = false;
        _draggingTileId = tileId;
        el.style.zIndex = "200";
        el.style.cursor = "grabbing";

        // Acquire lock from server (optimistic; we start dragging immediately)
        if (!isMine(tile)) {
            connection.invoke("AcquirePuzzleTileLock", roomId, tileId);
        }
        sndPickup();

        function onMove(me) {
            me.preventDefault();
            wasDragged = true;
            const br2 = b.getBoundingClientRect();
            el.style.left = (me.clientX - br2.left - offsetX) + "px";
            el.style.top  = (me.clientY - br2.top  - offsetY) + "px";
        }

        function onUp(ue) {
            el.releasePointerCapture(ue.pointerId);
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerup",   onUp);
            el.removeEventListener("pointercancel", onUp);
            _draggingTileId = null;

            if (!wasDragged) {
                // Pure tap without movement → release lock
                connection.invoke("ReleasePuzzleTileLock", roomId, tileId);
                el.style.cursor = "grab";
                el.style.zIndex = "1";
                return;
            }

            const m  = boardMetrics();
            const br2 = b.getBoundingClientRect();
            const pxLeft = parseFloat(el.style.left);
            const pyTop  = parseFloat(el.style.top);
            // Convert top-left of SVG element back to normalised center
            const nx = Math.max(0.01, Math.min(0.99, (pxLeft + m.ps/2 + m.pd) / m.bw));
            const ny = Math.max(0.01, Math.min(0.99, (pyTop  + m.ps/2 + m.pd) / m.bh));

            connection.invoke("SetPuzzleTilePosition", roomId, tileId, nx, ny)
                .catch(() => {});
            sndPlace();
        }

        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup",   onUp);
        el.addEventListener("pointercancel", onUp);
    });
}

// ---------------------------------------------------------------
// Preview thumbnail
// ---------------------------------------------------------------
function renderPreview() {
    if (!state) return;
    const grid = document.getElementById("ptPreviewGrid");
    const { cols } = getGrid();
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.innerHTML = "";
    state.previewFaces.forEach((face, i) => {
        const cell  = document.createElement("div");
        cell.className = "pt-preview-cell";
        const tile = state.tiles.find(t => t.correctIndex === i);
        if (tile?.isPlaced) cell.classList.add("pt-preview-cell--placed");
        cell.textContent = face;
        grid.appendChild(cell);
    });
}

// ---------------------------------------------------------------
// Player bar
// ---------------------------------------------------------------
function renderPlayers() {
    const bar = document.getElementById("puzzlePlayers");
    bar.innerHTML = "";
    fetchAvatars(state.players.map(p => p.name));
    state.players.forEach(p => {
        const el = document.createElement("div");
        el.className = "player-bar-item" +
            (p.name === myName ? " is-me" : "") +
            (!p.connected ? " player-disconnected" : "");
        el.innerHTML = avatarHtml(p.name,"sm") +
            `<span class="room-player-name">${esc(p.name)}</span>` +
            `<span class="player-score">${p.connected ? "Online" : "Away"}</span>`;
        bar.appendChild(el);
    });
}

// ---------------------------------------------------------------
// Status / progress
// ---------------------------------------------------------------
function updateStatus() {
    const el = document.getElementById("puzzleStatusText");
    const prog = document.getElementById("ptProgressText");
    if (!state) { el.textContent = "Loading puzzle…"; return; }
    const placed = state.tiles.filter(t => t.isPlaced).length;
    const total  = state.tiles.length;
    if (prog) prog.textContent = `${placed} / ${total} pieces placed`;
    if (state.isOver) {
        el.textContent = state.winnerName
            ? (state.winnerName === myName ? "You solved the puzzle! 🎉" : `${state.winnerName} solved the puzzle!`)
            : "Puzzle solved! 🎉";
        return;
    }
    el.textContent = "Drag pieces onto the board to solve the puzzle.";
}

// ---------------------------------------------------------------
// Side effects (audio)
// ---------------------------------------------------------------
let _prevIsOver = false;
let _prevPlaced = 0;
function sideEffects(s) {
    if (!s) return;
    const placed = s.tiles.filter(t => t.isPlaced).length;
    if (placed > _prevPlaced) sndSnap();
    if (s.isOver && !_prevIsOver) { sndWin(); launchConfetti(); }
    _prevPlaced = placed;
    _prevIsOver = s.isOver;
}

// ---------------------------------------------------------------
// Main render
// ---------------------------------------------------------------
function render() {
    if (!state) return;
    renderPlayers();
    renderPreview();
    renderPieces();
    updateStatus();

    if (state.isOver) {
        document.getElementById("resultText").textContent = state.winnerName
            ? (state.winnerName === myName ? "You finished Puzzle Time!" : `${state.winnerName} finished the puzzle!`)
            : "Puzzle completed!";
        document.getElementById("resultOverlay").style.display = "flex";
        if (!_gameOverFired) { _gameOverFired = true; document.dispatchEvent(new Event("gameOver")); }
    }
}

// ---------------------------------------------------------------
// Board aspect-ratio helper (called after first state arrives)
// ---------------------------------------------------------------
function applyBoardAspectRatio() {
    const { rows, cols } = getGrid();
    const b = board();
    b.style.aspectRatio = `${cols} / ${rows}`;
}

// ---------------------------------------------------------------
// Resize handler – rebuild pieces when board size changes
// ---------------------------------------------------------------
let _resizeTimer;
const _ro = new ResizeObserver(() => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => { if (state) render(); }, 80);
});

// ---------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------
function backToLobby() {
    connection.invoke("LeavePuzzleTimeGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

// ---------------------------------------------------------------
// Chat (multiplayer)
// ---------------------------------------------------------------
function initChat(conn, groupId) {
    let chatOpen=false, unread=0;
    const toggle=document.getElementById("chatToggle"), panel=document.getElementById("chatPanel"),
          close=document.getElementById("chatClose"), input=document.getElementById("chatInput"),
          send=document.getElementById("chatSend"), msgs=document.getElementById("chatMessages"),
          badge=document.getElementById("chatBadge");
    toggle.onclick=()=>{ chatOpen=!chatOpen; panel.style.display=chatOpen?"flex":"none"; if(chatOpen){unread=0;badge.style.display="none";msgs.scrollTop=msgs.scrollHeight;input.focus();}};
    close.onclick=()=>{ chatOpen=false; panel.style.display="none"; };
    function doSend(){const m=input.value.trim();if(!m)return;conn.invoke("SendChat",groupId,m);input.value="";}
    send.onclick=doSend; input.addEventListener("keydown",e=>{if(e.key==="Enter")doSend();});
    conn.on("ChatMessage",(name,message)=>{
        const el=document.createElement("div"); el.className="chat-msg";
        el.innerHTML=avatarHtml(name,"xs")+`<span class="chat-name">${esc(name)}</span> <span class="chat-text">${esc(message)}</span>`;
        msgs.appendChild(el); msgs.scrollTop=msgs.scrollHeight;
        if(!chatOpen){unread++;badge.textContent=unread;badge.style.display="inline-flex";}
    });
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
async function init() {
    if (!myName) {
        const me = await fetch("/api/me").then(r=>r.json());
        myName = me.name;
    }

    connection.on("PuzzleTimeUpdated", s => {
        sideEffects(s);
        state = s;
        applyBoardAspectRatio();
        render();
    });

    connection.on("PuzzleTileLockRejected", tileId => {
        sndDeny();
        if (_draggingTileId === tileId) _draggingTileId = null;
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("puzzleStatusText").textContent = name + " left the game.";
    });

    await connection.start();
    _ro.observe(board());
    await connection.invoke("RejoinPuzzleTimeRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("showHintsChk")?.addEventListener("change", () => { if (state) renderPieces(); });
    document.getElementById("backBtn")?.addEventListener("click", backToLobby);
    document.getElementById("backToLobby")?.addEventListener("click", backToLobby);
});

init();
