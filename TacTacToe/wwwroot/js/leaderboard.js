/**
 * leaderboard.js — shared leaderboard + personal history component
 * Usage: loadLeaderboard(gameType, panelElement)
 */

async function loadLeaderboard(gameType, container, top = 10) {
    container.innerHTML = '<p class="lb-loading">Loading&#8230;</p>';
    try {
        const [lbRes, meRes] = await Promise.all([
            fetch(`/api/leaderboard/${encodeURIComponent(gameType)}?top=${top}`),
            fetch('/api/me')
        ]);
        const entries = lbRes.ok ? await lbRes.json() : [];
        const me = meRes.ok ? (await meRes.json()).name : null;

        if (entries.length === 0) {
            container.innerHTML = '<p class="lb-empty">No scores yet. Be the first!</p>';
            return;
        }

        // Fetch avatars for all usernames in the leaderboard
        if (typeof fetchAvatars === 'function') {
            await fetchAvatars(entries.map(e => e.username));
        }

        let html = '';

        // ── Podium for top 3 (only when we have at least 3 entries) ──
        if (entries.length >= 3) {
            // Layout: 2nd (left) | 1st (centre) | 3rd (right)
            const podiumSlots = [
                { entry: entries[1], cls: 'lb-podium-2nd', crown: '🥈', label: '2nd' },
                { entry: entries[0], cls: 'lb-podium-1st', crown: '🥇', label: '1st' },
                { entry: entries[2], cls: 'lb-podium-3rd', crown: '🥉', label: '3rd' },
            ];
            html += '<div class="lb-podium">';
            podiumSlots.forEach(({ entry: e, cls, crown, label }) => {
                const isMe = me && e.username === me;
                const av = typeof avatarHtml === 'function' ? avatarHtml(e.username, 'xs') : '';
                html +=
                    `<div class="lb-podium-slot ${cls}">` +
                    `<div class="lb-podium-crown">${crown}</div>` +
                    `<div class="lb-podium-avatar">${av}</div>` +
                    `<div class="lb-podium-name${isMe ? ' lb-podium-you' : ''}">${escHtml(e.username)}</div>` +
                    `<div class="lb-podium-score">${e.score.toLocaleString()}</div>` +
                    `<div class="lb-podium-bar">${label}</div>` +
                    `</div>`;
            });
            html += '</div>';
        }

        // ── Table for ranks 4+ (or all entries when < 3) ──
        const tableStart = entries.length >= 3 ? 3 : 0;
        const tableEntries = entries.slice(tableStart);
        if (tableEntries.length > 0) {
            const medals = ['🥇', '🥈', '🥉'];
            const rows = tableEntries.map((e, i) => {
                const globalIdx = tableStart + i;
                const isMe = me && e.username === me;
                const rank = medals[globalIdx] || `#${globalIdx + 1}`;
                const date = e.playedAt ? new Date(e.playedAt).toLocaleDateString() : '';
                const time = e.timePlayed > 0
                    ? (e.timePlayed >= 60 ? `${Math.floor(e.timePlayed / 60)}m ${e.timePlayed % 60}s` : `${e.timePlayed}s`)
                    : '';
                return `<tr class="${isMe ? 'lb-me' : ''}">
                    <td class="lb-rank">${rank}</td>
                    <td class="lb-name">${typeof avatarHtml === 'function' ? avatarHtml(e.username, 'xs') : ''}${escHtml(e.username)}${isMe ? ' <span class="lb-you">(you)</span>' : ''}</td>
                    <td class="lb-score">${e.score.toLocaleString()}</td>
                    <td class="lb-result">${escHtml(e.result)}</td>
                    <td class="lb-time">${time}</td>
                    <td class="lb-date">${date}</td>
                </tr>`;
            }).join('');
            const wrapClass = entries.length >= 3 ? 'lb-rest' : '';
            html += `<div class="${wrapClass}"><table class="lb-table">
                <thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Result</th><th>Time</th><th>Date</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;
        }

        container.innerHTML = html;

        // ── Sticky "Your Rank" bar — shown when user is outside the podium ──
        if (me) {
            const myIdx = entries.findIndex(e => e.username === me);
            if (myIdx >= 3) {
                const myEntry = entries[myIdx];
                const myTime = myEntry.timePlayed > 0
                    ? (myEntry.timePlayed >= 60 ? `${Math.floor(myEntry.timePlayed / 60)}m ${myEntry.timePlayed % 60}s` : `${myEntry.timePlayed}s`)
                    : '';
                const bar = document.createElement('div');
                bar.className = 'lb-sticky-me';
                bar.innerHTML =
                    `<span>📍 You</span>` +
                    `<span>${escHtml(myEntry.username)}</span>` +
                    `<span class="lb-sticky-me-rank">#${myIdx + 1}</span>` +
                    `<span class="lb-sticky-me-score">${myEntry.score.toLocaleString()}</span>` +
                    (myTime ? `<span style="color:var(--text-dim);font-size:0.78rem;">${myTime}</span>` : '');
                container.appendChild(bar);
            }
        }
    } catch (err) {
        container.innerHTML = '<p class="lb-empty">Could not load leaderboard.</p>';
    }
}

async function loadPersonalHistory(gameType, container, limit = 50) {
    container.innerHTML = '<p class="lb-loading">Loading&#8230;</p>';
    try {
        const res = await fetch(`/api/me/history?game=${encodeURIComponent(gameType)}&limit=${limit}`);
        const entries = res.ok ? await res.json() : [];
        if (entries.length === 0) {
            container.innerHTML = '<p class="lb-empty">You haven\'t played yet.</p>';
            return;
        }

        const rows = entries.map(e => {
            const date = e.playedAt ? new Date(e.playedAt).toLocaleDateString() : '';
            const time = e.timePlayed > 0
                ? (e.timePlayed >= 60 ? `${Math.floor(e.timePlayed / 60)}m ${e.timePlayed % 60}s` : `${e.timePlayed}s`)
                : '';
            const resultClass = e.result === 'Win' ? 'lb-win' : e.result === 'Loss' ? 'lb-loss' : 'lb-draw';
            return `<tr>
                <td class="${resultClass}">${escHtml(e.result)}</td>
                <td>${e.score.toLocaleString()}</td>
                <td>${time}</td>
                <td>${date}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="lb-table">
                <thead><tr><th>Result</th><th>Score</th><th>Time</th><th>Date</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    } catch {
        container.innerHTML = '<p class="lb-empty">Could not load history.</p>';
    }
}

function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
