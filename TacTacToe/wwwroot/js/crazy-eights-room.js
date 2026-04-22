const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
const roomId = sessionStorage.getItem('crazyEightsRoomId');
if (!roomId) {
    window.location.replace('/lobby');
    throw new Error('Missing Crazy Eights room id');
}

let myName = '';
let isHost = false;

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => execCopy(text));
    execCopy(text);
}
function execCopy(text) {
    const el = document.createElement('textarea');
    el.value = text; el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el); el.select();
    document.execCommand('copy'); document.body.removeChild(el);
}

async function init() {
    const me = await fetch('/api/me').then(r => r.json());
    myName = me.name;

    const shortCode = roomId.slice(0, 8).toUpperCase();
    document.getElementById('roomCode').textContent = shortCode;
    document.getElementById('copyCodeBtn').onclick = () => { copyToClipboard(shortCode); showCopyToast('Room code copied!'); };
    document.getElementById('copyLinkBtn').onclick = () => {
        copyToClipboard(window.location.origin + '/lobby?join=' + roomId + '&game=crazy-eights');
        showCopyToast('Invite link copied!');
    };

    connection.on('CrazyEightsRoomUpdated', renderRoom);
    connection.on('CrazyEightsRoomDissolved', () => { alert('The room was closed.'); window.location.href = '/lobby'; });
    connection.on('KickedFromRoom', () => { alert('You were kicked.'); window.location.href = '/lobby'; });
    connection.on('CrazyEightsGameStarted', room => {
        sessionStorage.setItem('crazyEightsRoomId', room.id);
        window.location.href = '/crazy-eights';
    });

    await connection.start();
    await connection.invoke('RejoinCrazyEightsRoom', roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById('roomTitle').textContent = room.settings.roomName || 'Crazy Eights Room';
    document.getElementById('playerCount').textContent = room.players.length + '/' + room.settings.maxPlayers;

    const list = document.getElementById('roomPlayers');
    list.innerHTML = '';
    room.players.forEach(p => {
        const el = document.createElement('div');
        el.className = 'room-player' + (p.name === myName ? ' is-me' : '');
        el.innerHTML =
            '<span class="room-player-name">' + esc(p.name) + (p.isBot ? ' <small style="opacity:.7">BOT</small>' : '') + '</span>' +
            (p.name === room.hostName ? '<span class="room-host-badge">HOST</span>' : '') +
            (p.name === myName ? '<span class="you-tag">You</span>' : '') +
            (isHost && p.name !== myName && !p.isBot ? '<button class="btn-kick" type="button">&#x2715;</button>' : '');
        if (isHost && p.name !== myName && !p.isBot)
            el.querySelector('.btn-kick')?.addEventListener('click', () => kickPlayer(p.name));
        list.appendChild(el);
    });

    document.getElementById('fillBotsWrap').style.display = isHost ? '' : 'none';
    if (isHost) {
        const canStart = room.players.length >= 2 || document.getElementById('fillBotsToggle').checked;
        document.getElementById('startBtn').style.display = 'inline-block';
        document.getElementById('startBtn').disabled = !canStart;
        document.getElementById('waitMsg').style.display = 'none';
    } else {
        document.getElementById('startBtn').style.display = 'none';
        document.getElementById('waitMsg').style.display = 'block';
        document.getElementById('hostNameWait').textContent = room.hostName;
    }
}

document.getElementById('startBtn').addEventListener('click', () => {
    const fillBots = !!document.getElementById('fillBotsToggle').checked;
    connection.invoke('StartCrazyEightsGame', roomId, fillBots);
});

document.getElementById('fillBotsToggle').addEventListener('change', () => {
    const startBtn = document.getElementById('startBtn');
    if (isHost && startBtn.style.display !== 'none') startBtn.disabled = false;
});

function kickPlayer(name) { connection.invoke('KickCrazyEightsPlayer', roomId, name); }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('backBtn').addEventListener('click', () =>
        connection.invoke('LeaveCrazyEightsRoom', roomId).then(() => { window.location.href = '/lobby'; }));
});

function showCopyToast(msg) {
    let t = document.getElementById('copyToast');
    if (!t) { t = document.createElement('div'); t.id = 'copyToast'; t.className = 'copy-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('copy-toast-show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('copy-toast-show'), 2500);
}

init();
