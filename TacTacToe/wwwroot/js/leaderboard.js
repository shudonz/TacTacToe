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

        const medals = ['🥇', '🥈', '🥉'];
        const rows = entries.map((e, i) => {
            const isMe = me && e.username === me;
            const rank = medals[i] || `#${i + 1}`;
            const date = e.playedAt ? new Date(e.playedAt).toLocaleDateString() : '';
            const time = e.timePlayed > 0
                ? (e.timePlayed >= 60 ? `${Math.floor(e.timePlayed / 60)}m ${e.timePlayed % 60}s` : `${e.timePlayed}s`)
                : '';
            return `<tr class="${isMe ? 'lb-me' : ''}">
                <td class="lb-rank">${rank}</td>
                <td class="lb-name">${escHtml(e.username)}${isMe ? ' <span class="lb-you">(you)</span>' : ''}</td>
                <td class="lb-score">${e.score.toLocaleString()}</td>
                <td class="lb-result">${escHtml(e.result)}</td>
                <td class="lb-time">${time}</td>
                <td class="lb-date">${date}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <table class="lb-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Player</th>
                        <th>Score</th>
                        <th>Result</th>
                        <th>Time</th>
                        <th>Date</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>`;
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
