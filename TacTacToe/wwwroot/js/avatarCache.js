/**
 * avatarCache.js — shared avatar fetching, caching & rendering
 *
 * Security: avatars are fetched from our own API and stored server-side.
 * All user-supplied strings (names) are escaped before going into innerHTML.
 * Emoji values are set via textContent on a wrapper span, never raw innerHTML.
 */

const _avatarCache = new Map(); // username (lowercase) → emoji string | null
const _avatarPending = new Set(); // usernames currently in-flight

/**
 * Fetch avatars for a list of usernames (batched).
 * Skips usernames already in cache. Idempotent.
 * @param {string[]} names
 */
async function fetchAvatars(names) {
    if (!names || names.length === 0) return;
    const toFetch = names.filter(n => n && !_avatarCache.has(n.toLowerCase()) && !_avatarPending.has(n.toLowerCase()));
    if (toFetch.length === 0) return;

    toFetch.forEach(n => _avatarPending.add(n.toLowerCase()));

    try {
        const res = await fetch('/api/avatars?names=' + toFetch.map(encodeURIComponent).join(','));
        if (res.ok) {
            const data = await res.json();
            Object.entries(data).forEach(([k, v]) => {
                _avatarCache.set(k.toLowerCase(), v || null);
                _avatarPending.delete(k.toLowerCase());
            });
        }
    } catch (_) { /* network error — fall back to initials */ }

    // Mark any unfetched names as null so we don't retry endlessly
    toFetch.forEach(n => {
        if (!_avatarCache.has(n.toLowerCase())) _avatarCache.set(n.toLowerCase(), null);
        _avatarPending.delete(n.toLowerCase());
    });
}

/**
 * Synchronously get a cached avatar emoji for a username.
 * Returns null if not in cache yet.
 * @param {string} name
 * @returns {string|null}
 */
function getAvatar(name) {
    return _avatarCache.get((name || '').toLowerCase()) ?? null;
}

/**
 * Returns an HTML string for an avatar badge.
 * @param {string} name      — player username (used for fallback initial)
 * @param {string} [size]    — 'xs' | 'sm' | 'md' | 'lg'
 * @returns {string}         — safe HTML string
 */
function avatarHtml(name, size = 'sm') {
    const emoji = getAvatar(name);
    // Build element in-memory so we use textContent (no XSS)
    const span = document.createElement('span');
    span.className = 'av av-' + size + (emoji ? '' : ' av-initial');
    if (emoji) {
        span.textContent = emoji;
    } else {
        span.textContent = name ? name[0].toUpperCase() : '?';
    }
    return span.outerHTML;
}

/**
 * Prepend an avatar badge into a DOM element.
 * @param {HTMLElement} el
 * @param {string} name
 * @param {string} [size]
 */
function prependAvatar(el, name, size = 'sm') {
    const emoji = getAvatar(name);
    const span = document.createElement('span');
    span.className = 'av av-' + size + (emoji ? '' : ' av-initial');
    span.textContent = emoji || (name ? name[0].toUpperCase() : '?');
    el.prepend(span);
}
