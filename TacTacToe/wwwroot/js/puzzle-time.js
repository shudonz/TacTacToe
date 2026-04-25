// ================================================================
// Puzzle Time – client-side game logic
// Jigsaw pieces rendered as SVG with tab/blank connectors.
// Each piece shows a cropped window of a canvas-drawn scene.
// Click to select, click again to rotate 90°, drag to move.
// Pieces snap when placed near correct position AND rotation=0.
// ================================================================

const connection = new signalR.HubConnectionBuilder().withUrl("/gamehub").withAutomaticReconnect().build();
let roomId         = sessionStorage.getItem("puzzleTimeRoomId");
const isSinglePlayer = sessionStorage.getItem("isSinglePlayer") === "1";
if (!roomId) { window.location.replace("/lobby"); throw new Error("Missing Puzzle Time room id"); }

let myName          = sessionStorage.getItem("myName") || "";
let state           = null;
let _ac             = null;
let _gameOverFired  = false;
let _draggingTileId = null;   // tile id being actively dragged right now (pointer down + moved)
let _selectedTileId = null;   // tile id currently highlighted by this client
let _puzzleImgUrl   = null;   // cached data URL of the canvas scene
let _puzzleImgKey   = "";     // invalidation key: "imageKey_ps"
let _lastSvgSz      = 0;      // svgSz at last full DOM rebuild (detects resize)
let _prevPlaced     = 0;
let _prevIsOver     = false;

if (isSinglePlayer) document.getElementById("chatWidget").style.display = "none";

// Extra columns to the right of the puzzle grid used as a piece tray (normalised: 1.0 = one puzzle width)
const TRAY_COLS = 0.65;

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function tileById(id) { return state?.tiles?.find(t => t.id === id) || null; }
function isMine(tile) { return !!tile && tile.lockedByName === myName; }
function getGrid()    { return { rows: state?.settings?.grid?.rows || 5, cols: state?.settings?.grid?.cols || 5 }; }
function board()      { return document.getElementById("pt-board"); }

// ----------------------------------------------------------------
// Audio
// ----------------------------------------------------------------
function audioCtx() {
    if (!_ac) { try { _ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
    return _ac;
}
function tone(freq, dur=0.11, vol=0.1, type='sine', delay=0) {
    const ac = audioCtx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + delay;
    o.connect(g); g.connect(ac.destination);
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
}
function sndSelect() { tone(520, 0.07, 0.08); }
function sndRotate() { tone(720, 0.06, 0.09); tone(540, 0.10, 0.06, 'triangle', 0.05); }
function sndDrop()   { tone(640, 0.08, 0.10); }
function sndSnap()   { tone(880, 0.05, 0.13); tone(1100, 0.11, 0.09, 'sine', 0.05); }
function sndDeny()   { tone(220, 0.14, 0.09, 'triangle'); }
function sndWin()    { [523,659,784,1047].forEach((f,i)=>tone(f,0.2,0.12,'sine',i*0.12)); }

function launchConfetti(count=140) {
    const colors=['#fbbf24','#f472b6','#36d6c3','#7c6aff','#12919E','#ff8a47'];
    for (let i=0; i<count; i++) {
        setTimeout(()=>{
            const el=document.createElement('div'); el.className='pt-confetti';
            el.style.left=(Math.random()*100)+'%';
            el.style.background=colors[i%colors.length];
            el.style.animationDuration=(1.4+Math.random()*1.6)+'s';
            document.body.appendChild(el);
            setTimeout(()=>el.remove(),3400);
        }, i*12);
    }
}

// ----------------------------------------------------------------
// Canvas-drawn scenes – deterministic, no external resources
// ----------------------------------------------------------------

function buildPuzzleImage(m) {
    if (!state) return null;
    const key = `${state.settings.imageKey}_${m.ps.toFixed(2)}`;
    if (_puzzleImgUrl && _puzzleImgKey === key) return _puzzleImgUrl;

    const { rows, cols } = getGrid();
    const W = Math.ceil(cols * m.ps);
    const H = Math.ceil(rows * m.ps);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const drawers = {
        'emoji-garden': drawGarden,
        'emoji-space':  drawSpace,
        'emoji-ocean':  drawOcean,
        'emoji-snacks': drawSunset
    };
    (drawers[state.settings.imageKey] || drawGarden)(ctx, W, H);

    _puzzleImgUrl = canvas.toDataURL('image/png');
    _puzzleImgKey = key;
    return _puzzleImgUrl;
}

// ---- GARDEN ----
function drawGarden(ctx, w, h) {
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.58);
    sky.addColorStop(0, '#48abe0'); sky.addColorStop(1, '#c8ecff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.58);
    // Ground
    const gnd = ctx.createLinearGradient(0, h * 0.58, 0, h);
    gnd.addColorStop(0, '#5cb85c'); gnd.addColorStop(1, '#1b5e20');
    ctx.fillStyle = gnd; ctx.fillRect(0, h * 0.58, w, h);
    // Sun glow
    const sg = ctx.createRadialGradient(w*0.82, h*0.12, 0, w*0.82, h*0.12, h*0.22);
    sg.addColorStop(0,'rgba(255,240,80,0.95)'); sg.addColorStop(0.4,'rgba(255,210,0,0.40)'); sg.addColorStop(1,'transparent');
    ctx.fillStyle = sg; ctx.fillRect(w*0.55, 0, w*0.45, h*0.4);
    ctx.beginPath(); ctx.arc(w*0.82, h*0.12, h*0.065, 0, Math.PI*2);
    ctx.fillStyle = '#fff9c4'; ctx.fill();
    // Clouds
    function cloud(cx, cy, sc) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        [[0,0,1],[0.28,0.08,0.72],[-0.26,0.07,0.68],[0.5,-0.04,0.55],[-0.48,-0.03,0.52]].forEach(([ox,oy,or])=>{
            ctx.beginPath(); ctx.arc(cx+ox*sc*w, cy+oy*sc*h, or*sc*Math.min(w,h)*0.09, 0, Math.PI*2); ctx.fill();
        });
    }
    cloud(0.17, 0.10, 0.13); cloud(0.50, 0.07, 0.10);
    // Flowers
    function flower(cx, cy, r, petals, pc, cc) {
        ctx.strokeStyle = '#2d6a1f'; ctx.lineWidth = Math.max(1.5, r*0.12);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + r*2.8); ctx.stroke();
        ctx.fillStyle = pc;
        for (let p=0; p<petals; p++) {
            const a = (p/petals)*Math.PI*2;
            ctx.beginPath();
            ctx.ellipse(cx+Math.cos(a)*r*0.95, cy+Math.sin(a)*r*0.95, r*0.65, r*0.38, a, 0, Math.PI*2);
            ctx.fill();
        }
        ctx.fillStyle = cc;
        ctx.beginPath(); ctx.arc(cx, cy, r*0.4, 0, Math.PI*2); ctx.fill();
    }
    const unit = Math.min(w, h);
    [
        [0.10,0.57,0.058,6,'#ff79b0','#fdd835'],[0.23,0.54,0.062,5,'#ff4081','#fffde7'],
        [0.37,0.58,0.060,6,'#ce93d8','#ff8a65'],[0.52,0.55,0.064,5,'#ffca28','#f06292'],
        [0.66,0.57,0.058,6,'#80deea','#ff80ab'],[0.81,0.54,0.062,5,'#ff7043','#fdd835'],
        [0.15,0.65,0.050,5,'#a5d6a7','#ff6090'],[0.46,0.67,0.052,6,'#f48fb1','#ffe082'],
        [0.72,0.66,0.054,5,'#b39ddb','#ffca28'],
    ].forEach(([fx,fy,fr,fp,fc,fcc])=>flower(fx*w, fy*h, fr*unit, fp, fc, fcc));
    // Path stones
    ctx.fillStyle = 'rgba(180,160,120,0.45)';
    [[0.48,0.82,0.04],[0.52,0.90,0.035],[0.44,0.94,0.032],[0.57,0.97,0.030]].forEach(([sx,sy,sr])=>{
        ctx.beginPath(); ctx.ellipse(sx*w, sy*h, sr*w, sr*0.45*w, 0, 0, Math.PI*2); ctx.fill();
    });
}

// ---- SPACE ----
function drawSpace(ctx, w, h) {
    ctx.fillStyle = '#04051a'; ctx.fillRect(0, 0, w, h);
    // Nebula
    function neb(x,y,r,c){ const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,c); g.addColorStop(1,'transparent'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); }
    neb(w*0.28,h*0.38,w*0.50,'rgba(85,25,145,0.58)');
    neb(w*0.74,h*0.60,w*0.42,'rgba(200,35,90,0.42)');
    neb(w*0.50,h*0.18,w*0.38,'rgba(18,55,170,0.38)');
    // Stars (deterministic)
    for (let i=0; i<95; i++) {
        const sx = ((i*137.508)%100)/100*w, sy = ((i*97.31)%100)/100*h;
        const sr = i%7===0 ? 2.2 : i%3===0 ? 1.5 : 0.9;
        ctx.globalAlpha = 0.35+(i%5)*0.13;
        ctx.fillStyle = i%11===0 ? '#ffe0b2' : 'white';
        ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Ringed planet
    const p1g=ctx.createRadialGradient(w*0.68,h*0.26,0,w*0.68,h*0.26,h*0.17);
    p1g.addColorStop(0,'#b3f0e8'); p1g.addColorStop(0.5,'#0e8fa0'); p1g.addColorStop(1,'#04384a');
    ctx.beginPath(); ctx.arc(w*0.68,h*0.26,h*0.17,0,Math.PI*2); ctx.fillStyle=p1g; ctx.fill();
    ctx.save(); ctx.translate(w*0.68,h*0.26); ctx.scale(1,0.32);
    ctx.strokeStyle='rgba(160,240,220,0.6)'; ctx.lineWidth=h*0.045;
    ctx.beginPath(); ctx.arc(0,0,h*0.28,0,Math.PI*2); ctx.stroke();
    ctx.restore();
    // Moon (crescent)
    ctx.save();
    ctx.beginPath(); ctx.arc(w*0.15,h*0.7,h*0.12,0,Math.PI*2);
    const mg=ctx.createRadialGradient(w*0.13,h*0.68,0,w*0.15,h*0.7,h*0.12);
    mg.addColorStop(0,'#fff9e6'); mg.addColorStop(0.6,'#f5deb3'); mg.addColorStop(1,'#c4a35a');
    ctx.fillStyle=mg; ctx.fill();
    ctx.globalCompositeOperation='destination-out';
    ctx.beginPath(); ctx.arc(w*0.19,h*0.67,h*0.105,0,Math.PI*2); ctx.fillStyle='black'; ctx.fill();
    ctx.globalCompositeOperation='source-over';
    ctx.restore();
    // Shooting star
    ctx.strokeStyle='rgba(255,255,255,0.75)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(w*0.53,h*0.07); ctx.lineTo(w*0.68,h*0.18); ctx.stroke();
    // Small asteroid
    const a2g=ctx.createRadialGradient(w*0.82,h*0.75,0,w*0.82,h*0.75,h*0.06);
    a2g.addColorStop(0,'#a0856a'); a2g.addColorStop(1,'#4a3020');
    ctx.beginPath(); ctx.arc(w*0.82,h*0.75,h*0.06,0,Math.PI*2); ctx.fillStyle=a2g; ctx.fill();
}

// ---- OCEAN ----
function drawOcean(ctx, w, h) {
    const sky=ctx.createLinearGradient(0,0,0,h*0.38);
    sky.addColorStop(0,'#0d47a1'); sky.addColorStop(1,'#42a5f5');
    ctx.fillStyle=sky; ctx.fillRect(0,0,w,h*0.38);
    const ocean=ctx.createLinearGradient(0,h*0.38,0,h);
    ocean.addColorStop(0,'#0288d1'); ocean.addColorStop(0.45,'#01579b'); ocean.addColorStop(1,'#01295f');
    ctx.fillStyle=ocean; ctx.fillRect(0,h*0.38,w,h);
    // Horizon glow
    const hg=ctx.createRadialGradient(w*0.5,h*0.38,0,w*0.5,h*0.38,h*0.22);
    hg.addColorStop(0,'rgba(255,232,80,0.85)'); hg.addColorStop(1,'transparent');
    ctx.fillStyle=hg; ctx.fillRect(0,h*0.18,w,h*0.4);
    // Waves
    [0,1,2].forEach(wi => {
        const wy = h*(0.38+wi*0.068);
        ctx.fillStyle=`rgba(255,255,255,${0.07-wi*0.018})`;
        ctx.beginPath(); ctx.moveTo(0,wy);
        for (let x=0; x<=w; x+=w/14) ctx.lineTo(x, wy+Math.sin((x/w+wi*0.25)*Math.PI*6)*h*0.012);
        ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fill();
    });
    // Fish
    function fish(fx,fy,fs,fc,dir) {
        const d=dir?1:-1;
        ctx.fillStyle=fc;
        ctx.beginPath(); ctx.ellipse(fx,fy,fs*1.35,fs*0.55,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(fx-d*fs*1.1,fy); ctx.lineTo(fx-d*fs*1.9,fy-fs*0.78); ctx.lineTo(fx-d*fs*1.9,fy+fs*0.78); ctx.closePath(); ctx.fill();
        ctx.fillStyle='rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(fx+d*fs*0.65,fy-fs*0.12,fs*0.11,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=fs*0.10;
        [-0.28,0,0.28].forEach(off=>{ ctx.beginPath(); ctx.moveTo(fx+off*fs,fy-fs*0.48); ctx.lineTo(fx+off*fs,fy+fs*0.48); ctx.stroke(); });
    }
    fish(w*0.22,h*0.58,w*0.042,'#ff8f00',true);
    fish(w*0.56,h*0.70,w*0.034,'#26c6da',false);
    fish(w*0.77,h*0.53,w*0.038,'#ef5350',true);
    fish(w*0.38,h*0.82,w*0.030,'#ab47bc',false);
    fish(w*0.65,h*0.88,w*0.026,'#aed581',true);
    // Coral
    function coral(cx, cy, color) {
        function branch(x,y,len,ang,dep){
            if(dep===0||len<w*0.007) return;
            ctx.strokeStyle=color; ctx.lineWidth=Math.max(1.5,len*0.18);
            const nx=x+Math.cos(ang)*len, ny=y-Math.sin(ang)*len;
            ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(nx,ny); ctx.stroke();
            branch(nx,ny,len*0.62,ang+0.44,dep-1);
            branch(nx,ny,len*0.62,ang-0.44,dep-1);
            if(dep>2) branch(nx,ny,len*0.52,ang,dep-1);
        }
        branch(cx,cy,h*0.12,Math.PI/2,4);
    }
    coral(w*0.10,h,'#ef9a9a'); coral(w*0.42,h,'#ce93d8');
    coral(w*0.80,h,'#80deea'); coral(w*0.64,h,'#ffcc80');
    // Bubbles
    ctx.strokeStyle='rgba(180,230,255,0.5)'; ctx.lineWidth=1.5;
    [[0.30,0.73],[0.48,0.64],[0.66,0.77],[0.22,0.87],[0.58,0.90]].forEach(([bx,by])=>{
        ctx.beginPath(); ctx.arc(bx*w,by*h,w*0.013,0,Math.PI*2); ctx.stroke();
    });
}

// ---- SUNSET ----
function drawSunset(ctx, w, h) {
    const sky=ctx.createLinearGradient(0,0,0,h*0.62);
    sky.addColorStop(0,'#160030'); sky.addColorStop(0.32,'#7b1fa2');
    sky.addColorStop(0.64,'#e65100'); sky.addColorStop(1,'#f9a825');
    ctx.fillStyle=sky; ctx.fillRect(0,0,w,h*0.62);
    const water=ctx.createLinearGradient(0,h*0.62,0,h);
    water.addColorStop(0,'#e65100'); water.addColorStop(1,'#0a1929');
    ctx.fillStyle=water; ctx.fillRect(0,h*0.62,w,h);
    // Sun glow
    const sunGrd=ctx.createRadialGradient(w*0.5,h*0.62,0,w*0.5,h*0.62,h*0.20);
    sunGrd.addColorStop(0,'rgba(255,236,60,1)'); sunGrd.addColorStop(0.28,'rgba(255,140,0,0.75)'); sunGrd.addColorStop(1,'transparent');
    ctx.fillStyle=sunGrd; ctx.fillRect(0,h*0.28,w,h*0.62);
    ctx.beginPath(); ctx.arc(w*0.5,h*0.62,h*0.08,0,Math.PI*2); ctx.fillStyle='#fff8d6'; ctx.fill();
    // Reflection
    ctx.fillStyle='rgba(255,200,50,0.20)';
    ctx.beginPath(); ctx.ellipse(w*0.5,h*0.80,w*0.055,h*0.17,0,0,Math.PI*2); ctx.fill();
    // Mountains
    ctx.fillStyle='rgba(10,8,30,0.94)';
    ctx.beginPath(); ctx.moveTo(0,h*0.62);
    [[0,0.62],[0.11,0.44],[0.22,0.56],[0.33,0.38],[0.46,0.52],[0.58,0.40],[0.70,0.55],[0.82,0.43],[0.93,0.56],[1,0.62]]
        .forEach(([px,py])=>ctx.lineTo(px*w,py*h));
    ctx.lineTo(w,h*0.62); ctx.closePath(); ctx.fill();
    // Stars (deterministic)
    for (let i=0; i<55; i++) {
        const sx=((i*137.5)%100)/100*w, sy=((i*97.3)%100)/100*h*0.52;
        ctx.globalAlpha=0.28+(i%5)*0.14; ctx.fillStyle='white';
        ctx.beginPath(); ctx.arc(sx,sy,i%7===0?2:1,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    ctx.strokeStyle='rgba(255,200,80,0.55)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,h*0.62); ctx.lineTo(w,h*0.62); ctx.stroke();
}

// ----------------------------------------------------------------
// SVG puzzle-piece path builder
// Body occupies (pd, pd) → (pd+ps, pd+ps).  Tabs extend into padding.
// conn = [top, right, bottom, left]: 1=tab out, -1=notch in, 0=flat
// ----------------------------------------------------------------
function puzzlePiecePath(ps, pd, conn) {
    const [T,R,B,L] = conn;
    const x0=pd, y0=pd, x1=pd+ps, y1=pd+ps;
    const tH=ps*0.22, tW=ps*0.18;

    function edge(ax,ay,bx,by,c) {
        if (c===0) return `L${bx} ${by}`;
        const len=Math.hypot(bx-ax,by-ay);
        const dx=(bx-ax)/len, dy=(by-ay)/len;
        const nx=dy, ny=-dx, dir=c;
        const mx=(ax+bx)/2, my=(ay+by)/2;
        const t1x=mx-dx*tW, t1y=my-dy*tW;
        const t2x=mx+dx*tW, t2y=my+dy*tW;
        const px=mx+nx*tH*dir, py=my+ny*tH*dir;
        return (
            `L${t1x} ${t1y}` +
            ` C${t1x+nx*tH*0.55*dir} ${t1y+ny*tH*0.55*dir} ${px-dx*tW*0.55} ${py-dy*tW*0.55} ${px} ${py}` +
            ` C${px+dx*tW*0.55} ${py+dy*tW*0.55} ${t2x+nx*tH*0.55*dir} ${t2y+ny*tH*0.55*dir} ${t2x} ${t2y}` +
            ` L${bx} ${by}`
        );
    }
    return `M${x0} ${y0}${edge(x0,y0,x1,y0,T)}${edge(x1,y0,x1,y1,R)}${edge(x1,y1,x0,y1,B)}${edge(x0,y1,x0,y0,L)}Z`;
}

// ----------------------------------------------------------------
// Board metrics
// ----------------------------------------------------------------
function boardMetrics() {
    const b  = board();
    b.style.width  = '';
    b.style.height = '';
    const containerW = b.clientWidth || 500;
    const { rows, cols } = getGrid();
    // Total board = puzzle grid + right tray.
    // Derive ps so the WHOLE board (puzzle + tray) fits within containerW
    // AND the puzzle grid fits within 70 % of viewport height.
    const totalCols  = cols + cols * TRAY_COLS;   // effective column count across full board
    const maxByWidth = containerW / totalCols;
    const maxByHeight = (window.innerHeight * 0.70) / rows;
    const ps    = Math.min(maxByWidth, maxByHeight);
    const pd    = ps * 0.28;
    const svgSz = ps + 2 * pd;
    const puzzleW = ps * cols;
    const puzzleH = ps * rows;
    const trayW   = ps * cols * TRAY_COLS;
    const totalW  = puzzleW + trayW;
    b.style.width  = totalW  + 'px';
    b.style.height = puzzleH + 'px';
    return { bw: puzzleW, bh: puzzleH, puzzleW, puzzleH, trayW, totalW, rows, cols, ps, pd, svgSz };
}

// SVG element top-left from normalised piece center.
// nx is relative to puzzle width (bw); ny is relative to puzzle height (bh).
// nx > 1 places the piece in the right-side tray.
function piecePixelPos(nx, ny, m) {
    return { left: nx * m.bw - m.svgSz / 2, top: ny * m.bh - m.svgSz / 2 };
}

// ----------------------------------------------------------------
// Ghost slot layer (faint outlines for unplaced slots when hints on)
// ----------------------------------------------------------------
function renderGhosts(showHints, m) {
    const b = board();

    // Tray background strip
    let tray = document.getElementById("pt-tray");
    if (!tray) {
        tray = document.createElement("div");
        tray.id = "pt-tray";
        tray.className = "pt-tray";
        b.appendChild(tray);
    }
    tray.style.top    = '0';
    tray.style.height = m.puzzleH + 'px';
    tray.style.left   = m.puzzleW + 'px';
    tray.style.width  = m.trayW   + 'px';

    let svg = document.getElementById("pt-ghost-svg");
    if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
        svg.id = "pt-ghost-svg";
        svg.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;";
        b.insertBefore(svg, b.firstChild);
    }
    svg.innerHTML = "";
    if (!state) return;

    svg.setAttribute("width",  m.bw);
    svg.setAttribute("height", m.bh);
    svg.setAttribute("viewBox", `0 0 ${m.bw} ${m.bh}`);

    if (!showHints) return;

    state.tiles.forEach(t => {
        if (t.isPlaced) return;
        const row = Math.floor(t.correctIndex / m.cols);
        const col = t.correctIndex % m.cols;
        const cx  = (col + 0.5) / m.cols;
        const cy  = (row + 0.5) / m.rows;
        const pos = piecePixelPos(cx, cy, m);

        const g = document.createElementNS("http://www.w3.org/2000/svg","g");
        g.setAttribute("transform", `translate(${pos.left},${pos.top})`);

        const pathStr = puzzlePiecePath(m.ps, m.pd, t.connectors);
        const outline = document.createElementNS("http://www.w3.org/2000/svg","path");
        outline.setAttribute("d", pathStr);
        outline.setAttribute("fill","rgba(255,255,255,0.04)");
        outline.setAttribute("stroke","rgba(255,255,255,0.18)");
        outline.setAttribute("stroke-width","1");
        outline.setAttribute("stroke-dasharray","4 3");
        g.appendChild(outline);
        svg.appendChild(g);
    });
}

// ----------------------------------------------------------------
// Build a single piece SVG element
// ----------------------------------------------------------------
function buildPieceEl(tile, m) {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS,"svg");
    svg.id = "pt-piece-" + tile.id;
    svg.dataset.tileId = tile.id;
    svg.classList.add("pt-piece");
    svg.setAttribute("width",  m.svgSz);
    svg.setAttribute("height", m.svgSz);
    svg.setAttribute("viewBox",`0 0 ${m.svgSz} ${m.svgSz}`);
    svg.style.cssText = `position:absolute;overflow:visible;touch-action:none;`;

    const pathStr = puzzlePiecePath(m.ps, m.pd, tile.connectors);
    const col = tile.correctIndex % m.cols;
    const row = Math.floor(tile.correctIndex / m.cols);

    // Defs: clip path (piece shape)
    const defs = document.createElementNS(svgNS,"defs");
    const clip = document.createElementNS(svgNS,"clipPath");
    clip.id = "clip-" + tile.id;
    const cp  = document.createElementNS(svgNS,"path");
    cp.setAttribute("d", pathStr);
    clip.appendChild(cp); defs.appendChild(clip); svg.appendChild(defs);

    // Background fill (visible while image loads / as fallback)
    const bg = document.createElementNS(svgNS,"path");
    bg.setAttribute("d", pathStr);
    bg.classList.add("pt-piece-bg");
    svg.appendChild(bg);

    // Scene image – positioned so the correct grid cell aligns with the piece body
    const imgUrl = buildPuzzleImage(m);
    if (imgUrl) {
        const img = document.createElementNS(svgNS,"image");
        img.setAttribute("href",   imgUrl);
        img.setAttribute("x",      m.pd - col * m.ps);
        img.setAttribute("y",      m.pd - row * m.ps);
        img.setAttribute("width",  m.cols * m.ps);
        img.setAttribute("height", m.rows * m.ps);
        img.setAttribute("clip-path", `url(#clip-${tile.id})`);
        img.classList.add("pt-piece-img");
        svg.appendChild(img);
    }

    // Border stroke
    const border = document.createElementNS(svgNS,"path");
    border.setAttribute("d", pathStr);
    border.setAttribute("fill","none");
    border.classList.add("pt-piece-border");
    svg.appendChild(border);

    // Selection highlight overlay (transparent until selected)
    const hl = document.createElementNS(svgNS,"path");
    hl.setAttribute("d", pathStr);
    hl.classList.add("pt-piece-hl");
    svg.appendChild(hl);

    // Other-player lock badge
    const badge = document.createElementNS(svgNS,"text");
    badge.classList.add("pt-piece-lock");
    badge.setAttribute("x", m.pd + m.ps/2);
    badge.setAttribute("y", m.pd + m.ps - 4);
    badge.setAttribute("text-anchor","middle");
    badge.setAttribute("font-size", Math.max(6, m.ps*0.13));
    badge.style.display = "none";
    svg.appendChild(badge);

    return svg;
}

// ----------------------------------------------------------------
// Update visuals of an existing piece element from current state
// ----------------------------------------------------------------
function updatePieceVisuals(el, tile, m) {
    const isSelected  = (tile.id === _selectedTileId) || isMine(tile);
    const lockedOther = tile.isLocked && !isMine(tile);
    const placed      = tile.isPlaced;

    el.classList.toggle("pt-piece--selected",    isSelected);
    el.classList.toggle("pt-piece--locked-other",lockedOther && !isSelected);
    el.classList.toggle("pt-piece--placed",      placed);

    el.style.cursor   = placed ? "default" : (lockedOther ? "not-allowed" : (isSelected ? "grab" : "pointer"));
    el.style.zIndex   = placed ? "0" : (tile.id === _draggingTileId ? "200" : (isSelected ? "10" : "2"));

    // Rotation (CSS transform around the SVG centre = piece body centre)
    el.style.transformOrigin = `${m.svgSz/2}px ${m.svgSz/2}px`;
    el.style.transform = tile.rotation ? `rotate(${tile.rotation*90}deg)` : "";

    // Other-player badge
    const badge = el.querySelector(".pt-piece-lock");
    if (badge) {
        if (tile.lockedByName && tile.lockedByName !== myName) {
            badge.textContent = tile.lockedByName;
            badge.style.display = "";
        } else {
            badge.style.display = "none";
        }
    }
}

// ----------------------------------------------------------------
// Render all pieces
// ----------------------------------------------------------------
function renderPieces() {
    if (!state) return;
    const m = boardMetrics();
    const b = board();
    const showHints = document.getElementById("showHintsChk")?.checked ?? false;

    // Full DOM rebuild on resize (svgSz change) or first render
    if (m.svgSz !== _lastSvgSz) {
        _lastSvgSz   = m.svgSz;
        _puzzleImgUrl = null;   // force image rebuild at new size
        b.querySelectorAll(".pt-piece").forEach(el => el.remove());
    }

    renderGhosts(showHints, m);

    const existing = new Set([...b.querySelectorAll(".pt-piece")].map(el => el.dataset.tileId));

    state.tiles.forEach(tile => {
        let el = document.getElementById("pt-piece-" + tile.id);
        if (!el) {
            el = buildPieceEl(tile, m);
            b.appendChild(el);
            makeDraggable(el, tile.id);
        }
        existing.delete(tile.id);

        // Move piece to new position (skip the actively dragged piece)
        if (tile.id !== _draggingTileId) {
            const pos = piecePixelPos(tile.x, tile.y, m);
            el.style.left = pos.left + "px";
            el.style.top  = pos.top  + "px";
        }

        updatePieceVisuals(el, tile, m);
    });

    // Prune orphaned elements
    existing.forEach(id => document.getElementById("pt-piece-"+id)?.remove());
}

// ----------------------------------------------------------------
// Selection management
// ----------------------------------------------------------------
function selectTile(tileId) {
    // Deselect previous piece if different
    if (_selectedTileId && _selectedTileId !== tileId) {
        document.getElementById("pt-piece-"+_selectedTileId)?.classList.remove("pt-piece--selected");
        connection.invoke("ReleasePuzzleTileLock", roomId, _selectedTileId).catch(()=>{});
    }
    _selectedTileId = tileId;
    document.getElementById("pt-piece-"+tileId)?.classList.add("pt-piece--selected");
    connection.invoke("AcquirePuzzleTileLock", roomId, tileId).catch(()=>{});
}

function deselectAll() {
    if (!_selectedTileId) return;
    document.getElementById("pt-piece-"+_selectedTileId)?.classList.remove("pt-piece--selected");
    connection.invoke("ReleasePuzzleTileLock", roomId, _selectedTileId).catch(()=>{});
    _selectedTileId = null;
}

// ----------------------------------------------------------------
// Drag and drop
// ----------------------------------------------------------------
function makeDraggable(el, tileId) {
    el.addEventListener("pointerdown", e => {
        if (!state || state.isOver) return;
        const tile = tileById(tileId);
        if (!tile || tile.isPlaced) return;
        if (tile.isLocked && !isMine(tile) && tileId !== _selectedTileId) { sndDeny(); return; }

        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);

        // A piece is "already selected" if it was locally tracked as selected OR
        // is already server-locked to this player (covers the case where _selectedTileId
        // was cleared by a lock-rejected response between two clicks).
        const alreadyMine = isMine(tile);
        const wasAlreadySelected = (_selectedTileId === tileId) || alreadyMine;

        // Select the piece (releases old selection if different)
        if (!wasAlreadySelected) {
            selectTile(tileId);
            sndSelect();
        } else if (_selectedTileId !== tileId) {
            // Piece is server-locked to us but _selectedTileId drifted — re-sync it
            _selectedTileId = tileId;
        }

        const b  = board();
        const br = b.getBoundingClientRect();
        // Piece is always position:absolute inside the board.
        // Track the pointer offset relative to the board origin so movement
        // stays in the same coordinate space on every device/screen size.
        const startLeft = parseFloat(el.style.left) || 0;
        const startTop  = parseFloat(el.style.top)  || 0;
        const offsetX   = e.clientX - br.left - startLeft;
        const offsetY   = e.clientY - br.top  - startTop;

        let dragged = false;

        function onMove(me) {
            if (!dragged) {
                const ddx = me.clientX - e.clientX, ddy = me.clientY - e.clientY;
                if (Math.hypot(ddx, ddy) < 5) return;   // minimum drag threshold
                dragged = true;
                _draggingTileId = tileId;
                el.style.zIndex = "9999";
                el.style.cursor = "grabbing";
            }
            me.preventDefault();
            // Keep piece position:absolute inside the board — overflow:visible lets it
            // render outside the board boundary while coordinates stay board-relative.
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

            if (!dragged) {
                // Pure click: if piece was already selected → rotate it
                if (wasAlreadySelected) {
                    connection.invoke("RotatePuzzleTile", roomId, tileId).catch(()=>{});
                    sndRotate();
                }
                // else: piece was just selected by this click, nothing more needed
                return;
            }

            // Normalize position relative to puzzle board dimensions.
            // ny > 1 means the piece is in the tray below the grid, which is valid.
            const m  = boardMetrics();
            const px = parseFloat(el.style.left);
            const py = parseFloat(el.style.top);
            const nx = (px + m.svgSz / 2) / m.bw;
            const ny = (py + m.svgSz / 2) / m.bh;
            connection.invoke("SetPuzzleTilePosition", roomId, tileId, nx, ny).catch(()=>{});
            sndDrop();
        }

        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup",   onUp);
        el.addEventListener("pointercancel", onUp);
    });
}

// ----------------------------------------------------------------
// Preview thumbnail
// ----------------------------------------------------------------
function renderPreview() {
    if (!state) return;
    const canvas = document.getElementById("ptPreviewCanvas");
    if (!canvas) return;
    const { rows, cols } = getGrid();

    // Compact thumbnail that fits the head bar — max 140 px wide / 80 px tall
    const cellPx = Math.max(Math.floor(Math.min(140 / cols, 80 / rows)), 4);
    const W = cellPx * cols;
    const H = cellPx * rows;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");

    // Draw the same scene used by the puzzle pieces
    const drawers = {
        'emoji-garden': drawGarden,
        'emoji-space':  drawSpace,
        'emoji-ocean':  drawOcean,
        'emoji-snacks': drawSunset
    };
    (drawers[state.settings.imageKey] || drawGarden)(ctx, W, H);

    // Subtle grid lines
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (let c = 1; c < cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * cellPx, 0); ctx.lineTo(c * cellPx, H); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * cellPx); ctx.lineTo(W, r * cellPx); ctx.stroke();
    }

    // Teal overlay on placed cells
    state.tiles.forEach(t => {
        if (!t.isPlaced) return;
        const row = Math.floor(t.correctIndex / cols);
        const col = t.correctIndex % cols;
        ctx.fillStyle   = "rgba(54,214,195,0.38)";
        ctx.strokeStyle = "rgba(54,214,195,0.70)";
        ctx.lineWidth   = 1.5;
        ctx.fillRect  (col * cellPx,        row * cellPx,        cellPx,        cellPx);
        ctx.strokeRect(col * cellPx + 0.75, row * cellPx + 0.75, cellPx - 1.5, cellPx - 1.5);
    });
}

// ----------------------------------------------------------------
// Player bar
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Status / progress
// ----------------------------------------------------------------
function updateStatus() {
    const el   = document.getElementById("puzzleStatusText");
    const prog = document.getElementById("ptProgressText");
    if (!state) { el.textContent = "Loading puzzle\u2026"; return; }
    const placed = state.tiles.filter(t => t.isPlaced).length;
    const total  = state.tiles.length;
    if (prog) prog.textContent = `${placed} / ${total} pieces placed`;
    if (state.isOver) {
        el.textContent = state.winnerName
            ? (state.winnerName === myName ? "You solved the puzzle! 🎉" : `${state.winnerName} solved the puzzle!`)
            : "Puzzle solved! 🎉";
        return;
    }
    el.textContent = "Click a piece to select, click again to rotate, then drag to place.";
}

// ----------------------------------------------------------------
// Side effects (audio / confetti)
// ----------------------------------------------------------------
function sideEffects(s) {
    if (!s) return;
    const placed = s.tiles.filter(t => t.isPlaced).length;
    if (placed > _prevPlaced) sndSnap();
    if (s.isOver && !_prevIsOver) { sndWin(); launchConfetti(); }
    _prevPlaced = placed;
    _prevIsOver = s.isOver;
}

// ----------------------------------------------------------------
// Main render
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Board sizing helper — called on state update before render()
// boardMetrics() itself pins width + height; this just clears any
// stale aspect-ratio that might override those explicit values.
// ----------------------------------------------------------------
function applyBoardAspectRatio() {
    board().style.aspectRatio = '';
}

// ----------------------------------------------------------------
// Resize → rebuild piece DOM when board pixel size changes
// ----------------------------------------------------------------
let _resizeTimer;
const _ro = new ResizeObserver(() => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => { if (state) render(); }, 80);
});

// ----------------------------------------------------------------
// Navigation
// ----------------------------------------------------------------
function backToLobby() {
    connection.invoke("LeavePuzzleTimeGame", roomId).finally(() => { window.location.href = "/lobby"; });
}

// ----------------------------------------------------------------
// Chat (multiplayer)
// ----------------------------------------------------------------
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

// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------
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
        // Clear local selection if the lock was rejected
        if (_selectedTileId === tileId) {
            document.getElementById("pt-piece-"+tileId)?.classList.remove("pt-piece--selected");
            _selectedTileId = null;
        }
        if (_draggingTileId === tileId) _draggingTileId = null;
    });

    connection.on("PlayerLeft", name => {
        document.getElementById("puzzleStatusText").textContent = name + " left the game.";
    });

    connection.on("PuzzleTimeSinglePlayerStarted", newRoomId => {
        roomId = newRoomId;
        sessionStorage.setItem("puzzleTimeRoomId", newRoomId);
    });

    connection.on("PuzzleTimeRoomUpdated", () => {
        if (state?.isOver) window.location.href = "/puzzle-time-room";
    });

    await connection.start();
    _ro.observe(board());

    // Deselect when clicking the empty board area
    board().addEventListener("pointerdown", e => {
        if (e.target === board() || e.target.id === "pt-ghost-svg") deselectAll();
    });

    await connection.invoke("RejoinPuzzleTimeRoom", roomId);
    if (!isSinglePlayer) initChat(connection, roomId);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("showHintsChk")?.addEventListener("change", () => { if (state) renderPieces(); });
    document.getElementById("backBtn")?.addEventListener("click", backToLobby);
    document.getElementById("backToLobby")?.addEventListener("click", backToLobby);
    document.getElementById("playAgainBtn")?.addEventListener("click", () => {
        if (isSinglePlayer) {
            const imageKey = state?.settings?.imageKey || "emoji-garden";
            const pieceCount = state?.settings?.pieceCount || 25;
            document.getElementById("resultOverlay").style.display = "none";
            _gameOverFired = false;
            state = null;
            connection.invoke("StartPuzzleTimeSinglePlayer", imageKey, pieceCount).catch(e => console.error(e));
        } else {
            window.location.href = "/puzzle-time-room";
        }
    });
});

init();
