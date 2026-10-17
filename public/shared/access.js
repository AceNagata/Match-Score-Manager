// Access token handling shared by the control pages.
//
// The server only applies a change if it carries the right token (CONTROL_TOKEN), so a
// device that has the page's URL but not the token can look but not touch. This keeps the
// token in the browser, tells the person when a change was refused (the server sends
// `control:rejected` instead of silently dropping it), and builds a link that sets the
// token on another device, e.g. a friend's phone.
(function () {
  const KEY = 'controlToken';
  let memoryToken = '';

  // Some browsers (private mode, in-app browsers) block storage; fall back to this tab only.
  function getToken() {
    try {
      return localStorage.getItem(KEY) || memoryToken;
    } catch (e) {
      return memoryToken;
    }
  }

  function setToken(value) {
    memoryToken = value;
    try {
      localStorage.setItem(KEY, value);
    } catch (e) {
      // kept in memory only
    }
  }

  // /control/#token=... saves the token and is then removed from the address bar. It lives in
  // the fragment so it is never sent to the server, written to its logs, or shown by link previews.
  // Returns true if it took a token from the address.
  function takeTokenFromAddress() {
    const fromLink = /(?:^|[#&])token=([^&]*)/.exec(location.hash);
    if (!fromLink) return false;
    let taken = false;
    try {
      const value = decodeURIComponent(fromLink[1]).trim();
      if (value) {
        setToken(value);
        taken = true;
      }
    } catch (e) {
      // malformed link: ignore
    }
    history.replaceState(null, '', location.pathname + location.search);
    return taken;
  }

  takeTokenFromAddress();

  function init(socket) {
    const input = document.getElementById('access-token');
    const saveBtn = document.getElementById('token-save');
    const status = document.getElementById('token-status');
    let rejected = false;
    let flashTimer = null;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.id = 'token-copy';
    copyBtn.textContent = 'Copy phone link';
    copyBtn.title = 'Copies a link that sets this token on another device. Anyone with the link can control the match.';
    saveBtn.insertAdjacentElement('afterend', copyBtn);

    const banner = document.createElement('div');
    banner.className = 'access-banner';
    banner.setAttribute('role', 'alert');
    banner.hidden = true;
    banner.innerHTML =
      '<span>Your changes aren’t going through — this device doesn’t have the access token.</span>' +
      '<button type="button">Enter token</button>';
    document.body.appendChild(banner);

    function renderStatus() {
      if (rejected) {
        status.textContent = 'Token not accepted — check it and save again';
        status.className = 'token-status missing';
      } else if (getToken()) {
        status.textContent = 'Saved on this device';
        status.className = 'token-status ok';
      } else {
        status.textContent = 'No token set — updates will be rejected if the server requires one';
        status.className = 'token-status missing';
      }
      copyBtn.disabled = !getToken();
    }

    function flash(text, ok) {
      clearTimeout(flashTimer);
      status.textContent = text;
      status.className = `token-status ${ok ? 'ok' : 'missing'}`;
      flashTimer = setTimeout(renderStatus, 3500);
    }

    function save() {
      setToken(input.value.trim());
      rejected = false;
      banner.hidden = true;
      renderStatus();
    }

    async function copyLink() {
      const url = `${location.origin}/control/#token=${encodeURIComponent(getToken())}`;
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch (e) {
        const box = document.createElement('textarea');
        box.value = url;
        box.setAttribute('readonly', '');
        box.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(box);
        box.select();
        try {
          copied = document.execCommand('copy');
        } catch (e2) {
          copied = false;
        }
        box.remove();
      }
      flash(copied ? 'Link copied — send it to your friend' : 'Couldn’t copy the link on this browser', copied);
    }

    input.value = getToken();
    renderStatus();

    // Pasting the link into the address bar of a page that is already open doesn't reload it.
    window.addEventListener('hashchange', () => {
      if (!takeTokenFromAddress()) return;
      input.value = getToken();
      rejected = false;
      banner.hidden = true;
      renderStatus();
    });

    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    copyBtn.addEventListener('click', copyLink);
    banner.querySelector('button').addEventListener('click', () => {
      banner.hidden = true;
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input.focus();
    });

    socket.on('control:rejected', () => {
      rejected = true;
      banner.hidden = false;
      renderStatus();
    });
  }

  window.Access = { getToken, init };
})();
