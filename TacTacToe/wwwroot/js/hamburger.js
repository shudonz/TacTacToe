function hamOpen() {
    document.querySelector('.ham-drawer').classList.add('open');
    document.querySelector('.ham-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function hamClose() {
    document.querySelector('.ham-drawer').classList.remove('open');
    document.querySelector('.ham-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hamClose();
});

// Populate the navbar avatar button on every page
(async function initNavbarAvatar() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) return;
        const me = await res.json();
        const emojiEl = document.getElementById('navbarAvatarEmoji');
        const imgEl   = document.getElementById('navbarAvatarImg');
        const phEl    = document.getElementById('navbarAvatarPlaceholder');
        if (!emojiEl || !imgEl) return;
        if (phEl) phEl.style.display = 'none';
        if (me.avatar) {
            emojiEl.textContent = me.avatar;
            emojiEl.style.display = 'inline-flex';
            imgEl.style.display = 'none';
        } else {
            imgEl.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(me.name) + '&background=12919E&color=fff';
            imgEl.style.display = 'inline-block';
            emojiEl.style.display = 'none';
        }
        const unEl = document.getElementById('navbarUsername');
        if (unEl) unEl.textContent = me.name;
    } catch (e) { /* not logged in */ }
})();
