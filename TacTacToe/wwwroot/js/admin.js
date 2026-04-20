/* ============================================================
   admin.js — Admin Dashboard
   ============================================================ */

let currentUserId = null;
let allUsers      = [];
let allSessions   = [];

// ── Bootstrap ────────────────────────────────────────────────
(async () => {
    const me = await api('/api/me');
    if (!me || !me.isAdmin) { window.location.replace('/lobby'); return; }
    currentUserId = parseInt(me.userId, 10);
    document.getElementById('adminName').textContent = me.name;
    bindTabs();
    bindSearch();
    // Load overview first (active tab)
    await loadStats();
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
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).style.display = '';

            // Lazy-load tabs on first visit
            if (btn.dataset.tab === 'users'    && allUsers.length    === 0) await loadUsers();
            if (btn.dataset.tab === 'sessions' && allSessions.length === 0) await loadSessions();
        });
    });

    document.getElementById('statsRefresh').addEventListener('click', () => loadStats());
}

// ── Search / filter ──────────────────────────────────────────
function bindSearch() {
    document.getElementById('userSearch').addEventListener('input', renderUsers);
    document.getElementById('userStatusFilter').addEventListener('change', renderUsers);
    document.getElementById('sessionSearch').addEventListener('input', renderSessions);
    document.getElementById('sessionGameFilter').addEventListener('change', renderSessions);
}

// ════════════════════════════════════════════════════════════
//  STATS / OVERVIEW
// ════════════════════════════════════════════════════════════
async function loadStats() {
    document.getElementById('statsContent').innerHTML = '<p class="admin-loading">Loading&#8230;</p>';
    const data = await api('/api/admin/stats');
    if (!data) {
        document.getElementById('statsContent').innerHTML = '<p class="admin-empty">Failed to load stats.</p>';
        return;
    }
    renderStats(data);
}

function renderStats(data) {
    const s = data.summary;

    // ── Summary cards ──
    const cards = [
        { icon: '👥', label: 'Total Users',        value: s.totalUsers,           sub: `${s.newUsersLast7Days} joined last 7 days` },
        { icon: '🚫', label: 'Banned Users',        value: s.bannedUsers,          sub: 'cannot log in', cls: s.bannedUsers > 0 ? 'stat-card-danger' : '' },
        { icon: '🟢', label: 'Active (7 days)',     value: s.activeUsersLast7Days, sub: 'unique players' },
        { icon: '🎮', label: 'Total Games Played',  value: (s.totalSessions ?? 0).toLocaleString(), sub: 'all time' },
        { icon: '⏱️', label: 'Total Time Played',   value: fmtDuration(s.totalTimeSecs ?? 0),  sub: 'across all games' },
        { icon: '⚡', label: 'Avg Session Length',  value: fmtDuration(s.avgSessionSecs ?? 0), sub: 'per game played' },
    ];

    const cardsHtml = cards.map(c => `
        <div class="stat-card ${c.cls ?? ''}">
            <div class="stat-card-icon">${c.icon}</div>
            <div class="stat-card-value">${c.value}</div>
            <div class="stat-card-label">${c.label}</div>
            <div class="stat-card-sub">${c.sub}</div>
        </div>`).join('');

    // ── Game breakdown ──
    const gameRows = (data.gameBreakdown ?? []).map(g => {
        const winRate  = g.count > 0 ? Math.round(g.wins / g.count * 100) : 0;
        const winColor = winRate >= 50 ? 'lb-win' : winRate >= 30 ? '' : 'lb-loss';
        return `<tr>
            <td style="font-weight:600;color:var(--text)">${esc(g.gameType)}</td>
            <td>${(g.count ?? 0).toLocaleString()}</td>
            <td class="lb-win">${g.wins ?? 0}</td>
            <td class="lb-loss">${g.losses ?? 0}</td>
            <td>${g.draws ?? 0}</td>
            <td class="${winColor}">${winRate}%</td>
            <td>${(g.avgScore ?? 0).toLocaleString()}</td>
            <td>${fmtDuration(g.avgTimeSecs ?? 0)}</td>
            <td>${fmtDuration(g.totalTimeSecs ?? 0)}</td>
        </tr>`;
    }).join('');

    const gameTable = gameRows
        ? `<table class="admin-table">
            <thead><tr>
                <th>Game</th><th>Played</th><th>Wins</th><th>Losses</th><th>Draws</th>
                <th>Win %</th><th>Avg Score</th><th>Avg Time</th><th>Total Time</th>
            </tr></thead>
            <tbody>${gameRows}</tbody>
           </table>`
        : '<p class="admin-empty">No game data yet.</p>';

    // ── Top players ──
    const playerRows = (data.topPlayers ?? []).map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        return `<tr>
            <td style="font-weight:700;color:var(--text-dim);width:2rem">${medal}</td>
            <td style="font-weight:600;color:var(--text)">${esc(p.username)}</td>
            <td>${p.gamesPlayed}</td>
            <td class="lb-win">${p.wins}</td>
            <td>${p.winRate ?? 0}%</td>
            <td class="lb-score">${(p.totalScore ?? 0).toLocaleString()}</td>
            <td>${fmtDuration(p.totalTimeSecs ?? 0)}</td>
        </tr>`;
    }).join('');

    const playersTable = playerRows
        ? `<table class="admin-table">
            <thead><tr>
                <th>#</th><th>Player</th><th>Games</th><th>Wins</th><th>Win %</th><th>Total Score</th><th>Time</th>
            </tr></thead>
            <tbody>${playerRows}</tbody>
           </table>`
        : '<p class="admin-empty">No player data yet.</p>';

    // ── Daily activity bar chart ──
    const activity  = data.dailyActivity ?? [];
    const maxCount  = Math.max(...activity.map(d => d.count), 1);
    const activityBars = activity.length
        ? activity.map(d => {
            const pct   = Math.round(d.count / maxCount * 100);
            const label = new Date(d.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
            return `<div class="bar-row">
                <span class="bar-label">${label}</span>
                <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="bar-val">${d.count}</span>
            </div>`;
        }).join('')
        : '<p class="admin-empty" style="padding:0.5rem 0">No activity in the last 14 days.</p>';

    document.getElementById('statsContent').innerHTML = `
        <div class="stat-cards-grid">${cardsHtml}</div>

        <div class="stats-section-title">&#127922; Games Breakdown</div>
        <div class="admin-table-wrap" style="margin-bottom:1.5rem">${gameTable}</div>

        <div class="stats-two-col">
            <div>
                <div class="stats-section-title">&#127942; Top 10 Players</div>
                <div class="admin-table-wrap">${playersTable}</div>
            </div>
            <div>
                <div class="stats-section-title">&#128197; Daily Activity (Last 14 Days)</div>
                <div class="bar-chart">${activityBars}</div>
            </div>
        </div>
    `;
}

// ════════════════════════════════════════════════════════════
//  USERS
// ════════════════════════════════════════════════════════════
async function loadUsers() {
    allUsers = await api('/api/admin/users') ?? [];
    renderUsers();
}

function renderUsers() {
    const q      = document.getElementById('userSearch').value.trim().toLowerCase();
    const filter = document.getElementById('userStatusFilter').value;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const rows = allUsers.filter(u => {
        if (q && !u.username.toLowerCase().includes(q)) return false;
        if (filter === 'banned' && !u.isBanned) return false;
        if (filter === 'admin'  && !u.isAdmin)  return false;
        if (filter === 'active' && (!u.lastLoginAt || new Date(u.lastLoginAt).getTime() < sevenDaysAgo)) return false;
        return true;
    });

    const wrap = document.getElementById('usersTableWrap');

    if (rows.length === 0) {
        wrap.innerHTML = '<p class="admin-empty">No users found.</p>';
        return;
    }

    const tbody = rows.map(u => {
        const isSelf     = u.id === currentUserId;
        const adminBadge = u.isAdmin  ? '<span class="admin-tag">Admin</span>' : '';
        const banBadge   = u.isBanned
            ? `<span class="ban-tag" title="${esc(u.banReason ?? '')}">&#128683; Banned</span>`
            : '';
        return `<tr data-uid="${u.id}" class="${u.isBanned ? 'row-banned' : ''}">
            <td class="admin-col-name">${esc(u.username)} ${adminBadge}${banBadge}</td>
            <td class="admin-col-date">${fmtDate(u.createdAt)}</td>
            <td class="admin-col-date">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</td>
            <td class="admin-col-actions">
                ${!isSelf && !u.isAdmin
                    ? `<button class="admin-btn admin-btn-promote" data-uid="${u.id}" data-name="${esc(u.username)}">&#11014; Make Admin</button>`
                    : ''}
                ${!isSelf && u.isAdmin
                    ? `<button class="admin-btn admin-btn-demote"  data-uid="${u.id}" data-name="${esc(u.username)}">&#11015; Remove Admin</button>`
                    : ''}
                <button class="admin-btn admin-btn-pw"  data-uid="${u.id}" data-name="${esc(u.username)}">&#128274; Reset PW</button>
                <button class="admin-btn admin-btn-clr" data-uid="${u.id}" data-name="${esc(u.username)}">&#128465; Clear Scores</button>
                ${!isSelf && !u.isBanned
                    ? `<button class="admin-btn admin-btn-ban"   data-uid="${u.id}" data-name="${esc(u.username)}">&#128683; Ban</button>`
                    : ''}
                ${!isSelf && u.isBanned
                    ? `<button class="admin-btn admin-btn-unban" data-uid="${u.id}" data-name="${esc(u.username)}">&#9989; Unban</button>`
                    : ''}
                ${!isSelf
                    ? `<button class="admin-btn admin-btn-del"   data-uid="${u.id}" data-name="${esc(u.username)}">&#10060; Delete</button>`
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

    wrap.querySelectorAll('.admin-btn-promote').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Make <strong>${esc(b.dataset.name)}</strong> an administrator?`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/admin`, jsonPatch({ isAdmin: true })); await loadUsers(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-demote').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Remove admin rights from <strong>${esc(b.dataset.name)}</strong>?`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/admin`, jsonPatch({ isAdmin: false })); await loadUsers(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-pw').forEach(b =>
        b.addEventListener('click', () => openPwModal(b.dataset.uid, b.dataset.name))
    );
    wrap.querySelectorAll('.admin-btn-clr').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Delete ALL scores for <strong>${esc(b.dataset.name)}</strong>? This cannot be undone.`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/sessions`, { method: 'DELETE' }); await loadSessions(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-ban').forEach(b =>
        b.addEventListener('click', () => openBanModal(b.dataset.uid, b.dataset.name))
    );
    wrap.querySelectorAll('.admin-btn-unban').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Unban <strong>${esc(b.dataset.name)}</strong>? They will be able to log in again.`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}/ban`, jsonPatch({ isBanned: false, reason: null })); await loadUsers(); }
        ))
    );
    wrap.querySelectorAll('.admin-btn-del').forEach(b =>
        b.addEventListener('click', () => confirmAction(
            `Permanently delete user <strong>${esc(b.dataset.name)}</strong> and all their scores? This cannot be undone.`,
            async () => { await api(`/api/admin/users/${b.dataset.uid}`, { method: 'DELETE' }); await Promise.all([loadUsers(), loadSessions()]); }
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
        const timeStr   = fmtDuration(s.timePlayed);
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
            async () => { await api(`/api/admin/sessions/${b.dataset.sid}`, { method: 'DELETE' }); await loadSessions(); }
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
        await api(`/api/admin/users/${uid}/password`, jsonPatch({ password: pw }));
        document.getElementById('pwModal').style.display = 'none';
    };
    document.getElementById('pwCancel').onclick = () => {
        document.getElementById('pwModal').style.display = 'none';
    };
}

// ════════════════════════════════════════════════════════════
//  Ban modal
// ════════════════════════════════════════════════════════════
function openBanModal(uid, name) {
    document.getElementById('banModalUser').textContent = `Banning: ${name}`;
    document.getElementById('banReasonInput').value = '';
    document.getElementById('banModal').style.display = 'flex';

    document.getElementById('banConfirm').onclick = async () => {
        const reason = document.getElementById('banReasonInput').value.trim() || null;
        await api(`/api/admin/users/${uid}/ban`, jsonPatch({ isBanned: true, reason }));
        document.getElementById('banModal').style.display = 'none';
        await loadUsers();
    };
    document.getElementById('banCancel').onclick = () => {
        document.getElementById('banModal').style.display = 'none';
    };
}

// ── Utilities ────────────────────────────────────────────────
function jsonPatch(body) {
    return { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(secs) {
    if (!secs || secs <= 0) return '—';
    const s = Math.round(secs);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
}

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
