const connection = new signalR.HubConnectionBuilder().withUrl('/gamehub').withAutomaticReconnect().build();
const roomId = sessionStorage.getItem('rattlerRoomId');
if (!roomId) { window.location.replace('/lobby'); throw new Error('Missing Rattler room id'); }

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
        copyToClipboard(window.location.origin + '/lobby?join=' + roomId + '&game=rattler');
        showCopyToast('Invite link copied!');
    };

    connection.on('RattlerRoomUpdated', renderRoom);
    connection.on('RattlerRoomDissolved', () => { alert('The room was closed.'); window.location.href = '/lobby'; });
    connection.on('KickedFromRoom', () => { alert('You were kicked.'); window.location.href = '/lobby'; });
    connection.on('RattlerGameStarted', rid => {
        sessionStorage.setItem('rattlerRoomId', rid);
        window.location.href = '/rattler';
    });

    await connection.start();
    await connection.invoke('RejoinRattlerRoom', roomId);
}

function renderRoom(room) {
    isHost = room.hostName === myName;
    document.getElementById('roomTitle').textContent = (room.settings?.roomName || 'Rattler Room');
    document.getElementById('playerCount').textContent = room.players.length + '/' + (room.settings?.maxPlayers || 2);

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

    const canStart = room.players.length >= 2;
    if (isHost) {
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
    connection.invoke('StartRattlerGame', roomId);
});

function kickPlayer(name) { connection.invoke('KickRattlerPlayer', roomId, name); }

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('backBtn').addEventListener('click', () =>
        connection.invoke('LeaveRattlerRoom', roomId).then(() => { window.location.href = '/lobby'; }));
});

function showCopyToast(msg) {
    let t = document.getElementById('copyToast');
    if (!t) { t = document.createElement('div'); t.id = 'copyToast'; t.className = 'copy-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('copy-toast-show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('copy-toast-show'), 2500);
}

init();
