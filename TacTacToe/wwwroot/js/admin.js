/* ============================================================
   admin.js — Admin Dashboard
   ============================================================ */

let currentUserId = null;
let allUsers    = [];
let allSessions = [];

// ── Bootstrap ────────────────────────────────────────────────
(async () => {
    const me = await api('/api/me');
    if (!me || !me.isAdmin) { window.location.replace('/lobby'); return; }
    currentUserId = parseInt(me.userId, 10);
    document.getElementById('adminName').textContent = me.name;
    await Promise.all([loadUsers(), loadSessions()]);
    bindTabs();
    bindSearch();
})();

// ── API helper ───────────────────────────────────────────────
async function api(url, options) {
    try {
        const r = await fetch(url, options);
        if (!r.ok) return null;
        const text = await r.text();
        return text ? JSON.parse(text) : {};
    } catch { return null; }
}

// ── Tabs ─────────────────────────────────────────────────────
function bindTabs() {
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).style.display = '';
        });
    });
}

// ── Search / filter ──────────────────────────────────────────
function bindSearch() {
    document.getElementById('userSearch').addEventListener('input', renderUsers);
    document.getElementById('sessionSearch').addEventListener('input', renderSessions);
    document.getElementById('sessionGameFilter').addEventListener('change', renderSessions);
}

// ════════════════════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════════════════════
async function loadUsers() {
    allUsers = await api('/api/admin/users') ?? [];
    renderUsers();
}

function renderUsers() {
    const q   = document.getElementById('userSearch').value.trim().toLowerCase();
    const rows = allUsers.filter(u => !q || u.username.toLowerCase().includes(q));
    const wrap = document.getElementById('usersTableWrap');

    if (rows.length === 0) {
        wrap.innerHTML = '<p class="admin-empty">No users found.</p>';
        return;
    }

    const tbody = rows.map(u => {
        const isSelf  = u.id === currentUserId;
        const adminBadge = u.isAdmin
            ? '<span class="admin-tag">Admin</span>'
            : '';
        return `<tr data-uid="${u.id}">
            <td class="admin-col-name">${esc(u.username)} ${adminBadge}</td>
            <td class="admin-col-date">${fmtDate(u.createdAt)}</td>
            <td class="admin-col-date">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</td>
            <td class="admin-col-actions">
                ${!isSelf && !u.isAdmin
                    ? `<button class="admin-btn admin-btn-promote" data-uid="${u.id}" data-name="${esc(u.username)}">&#11014; Make Admin</button>`
                    : ''}
                ${!isSelf && u.isAdmin
                    ? `<button class="admin-btn admin-btn-demote" data-uid="${u.id}" data-name="${esc(u.username)}">&#11015; Remove Admin</button>`
                    : ''}
                <button class="admin-btn admin-btn-pw" data-uid="${u.id}" data-name="${esc(u.username)}">&#128274; Reset PW</button>
                <button class="admin-btn admin-btn-clr" data-uid="${u.id}" data-name="${esc(u.username)}">&#128465; Clear Scores</button>
                ${!isSelf
                    ? `<button class="admin-btn admin-btn-del" data-uid="${u.id}" data-name="${esc(u.username)}">&#10060; Delete User</button>`
                    : ''}
            </td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
        <table class="admin-table">
            <thead><tr>
                <th>Username</th><th>Registered</th><th>Last Login</th><th>Actions</th>
            </tr></thead>
            <tbody>${tbody}</tbody>
        </table>`;

    // Bind action buttons
    wrap.querySelectorAll('.admin-btn-promote').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Make <strong>${esc(b.dataset.name)}</strong> an administrator?`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/admin`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({isAdmin:true}) }); await loadUsers(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-demote').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Remove admin rights from <strong>${esc(b.dataset.name)}</strong>?`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/admin`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({isAdmin:false}) }); await loadUsers(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-pw').forEach(b =>
        b.addEventListener('click', () => openPwModal(b.dataset.uid, b.dataset.name))
    );
    wrap.querySelectorAll('.admin-btn-clr').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Delete ALL scores for <strong>${esc(b.dataset.name)}</strong>? This cannot be undone.`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/sessions`, { method:'DELETE' }); await loadSessions(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-del').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Permanently delete user <strong>${esc(b.dataset.name)}</strong> and all their scores? This cannot be undone.`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}`, { method:'DELETE' }); await Promise.all([loadUsers(), loadSessions()]); }
        ))
    );
}

// ════════════════════════════════════════════════════════════
//  SESSIONS
// ════════════════════════════════════════════════════════════
async function loadSessions() {
    allSessions = await api('/api/admin/sessions') ?? [];
    renderSessions();
}

function renderSessions() {
    const q    = document.getElementById('sessionSearch').value.trim().toLowerCase();
    const game = document.getElementById('sessionGameFilter').value;
    const rows = allSessions.filter(s =>
        (!q    || s.username.toLowerCase().includes(q)) &&
        (!game || s.gameType === game)
    );
    const wrap = document.getElementById('sessionsTableWrap');

    if (rows.length === 0) {
        wrap.innerHTML = '<p class="admin-empty">No scores found.</p>';
        return;
    }

    const tbody = rows.map(s => {
        const timeStr = s.timePlayed > 0
            ? (s.timePlayed >= 60 ? `${Math.floor(s.timePlayed/60)}m ${s.timePlayed%60}s` : `${s.timePlayed}s`)
            : '—';
        const resultCls = s.result === 'Win' ? 'lb-win' : s.result === 'Loss' ? 'lb-loss' : 'lb-draw';
        return `<tr>
            <td>${esc(s.username)}</td>
            <td>${esc(s.gameType)}</td>
            <td class="${resultCls}">${esc(s.result)}</td>
            <td class="lb-score">${s.score.toLocaleString()}</td>
            <td>${timeStr}</td>
            <td>${fmtDate(s.playedAt)}</td>
            <td><button class="admin-btn admin-btn-del-session" data-sid="${s.id}">&#10060;</button></td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
        <table class="admin-table">
            <thead><tr>
                <th>Player</th><th>Game</th><th>Result</th><th>Score</th><th>Time</th><th>Date</th><th></th>
            </tr></thead>
            <tbody>${tbody}</tbody>
        </table>`;

    wrap.querySelectorAll('.admin-btn-del-session').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            'Delete this score entry?',
            async () => { await api(`/api/admin/sessions/${b.dataset.sid}`, { method:'DELETE' }); await loadSessions(); }
        ))
    );
}

// ════════════════════════════════════════════════════════════
//  Confirm modal
// ════════════════════════════════════════════════════════════
function confirmAction(msg, onYes) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMsg').innerHTML = msg;
    modal.style.display = 'flex';

    const yes = document.getElementById('confirmYes');
    const no  = document.getElementById('confirmNo');

    const cleanup = () => { modal.style.display = 'none'; yes.replaceWith(yes.cloneNode(true)); no.replaceWith(no.cloneNode(true)); };
    document.getElementById('confirmYes').addEventListener('click', async () => { cleanup(); await onYes(); }, { once: true });
    document.getElementById('confirmNo').addEventListener('click',  () => cleanup(), { once: true });
}

// ════════════════════════════════════════════════════════════
//  Reset-password modal
// ════════════════════════════════════════════════════════════
function openPwModal(uid, name) {
    document.getElementById('pwModalUser').textContent = `Reset password for: ${name}`;
    document.getElementById('pwInput').value = '';
    document.getElementById('pwError').style.display = 'none';
    document.getElementById('pwModal').style.display = 'flex';

    document.getElementById('pwSave').onclick = async () => {
        const pw = document.getElementById('pwInput').value;
        if (pw.length < 8) {
            const e = document.getElementById('pwError');
            e.textContent = 'Password must be at least 8 characters.';
            e.style.display = 'block';
            return;
        }
        const res = await api(`/api/admin/users/${uid}/password`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        });
        document.getElementById('pwModal').style.display = 'none';
    };
    document.getElementById('pwCancel').onclick = () => {
        document.getElementById('pwModal').style.display = 'none';
    };
}

// ── Utilities ────────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
