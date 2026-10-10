// /overlay/ — a gallery of every overlay page, each with a scaled live preview,
// its URL and Copy / Open buttons. Previews are the real overlay pages in
// iframes; "Sample data" adds ?demo=1 so empty overlays still show something.

const OVERLAYS = [
  {
    path: '/overlay/clock/',
    name: 'Scoreboard',
    what: 'Clock, team names and score, plus the +N extra-time bar when it is switched on.',
    when: 'Always on while the match is live.',
  },
  {
    path: '/overlay/goal/',
    name: 'Goal animation',
    what: 'Full-width animated GOAL banner with the scorer, minute and updated score.',
    when: 'Pops up when a goal, penalty goal or own goal is logged, then hides itself after 9s.',
  },
  {
    path: '/overlay/cards-subs/',
    name: 'Cards & substitutions',
    what: 'Lower-third in the bottom left for yellow, second yellow, red cards and substitutions.',
    when: 'Pops up when one is logged, then hides itself (7s cards, 8s subs).',
  },
  {
    path: '/overlay/event-list/',
    name: 'Event list',
    what: 'Running list of the last 12 match events in the top left.',
    when: 'Shown while "Show event list on overlay" is on in the control panel.',
  },
  {
    path: '/overlay/penalty/',
    name: 'Penalty shootout',
    what: 'Kick-by-kick panel for both teams with running totals.',
    when: 'Shown while "Show penalty panel on overlay" is on.',
  },
  {
    path: '/overlay/bracket/',
    name: 'Tournament bracket',
    what: 'The full bracket from the Bracket Maker, scaled to fill the frame, with the champion.',
    when: 'Always shows the current bracket. Bring it in between matches.',
  },
];

const view = { preview: 'sample', style: 'flags' };
const gallery = document.getElementById('gallery');

function fullUrl(path) {
  return `${location.origin}${path}`;
}

function previewSrc(path) {
  return view.preview === 'sample' ? `${path}?demo=1&style=${view.style}` : path;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back for http://<LAN-IP> access.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function card(overlay) {
  const el = document.createElement('article');
  el.className = 'ov-card';
  el.innerHTML = `
    <div class="ov-preview">
      <iframe title="${overlay.name} preview" loading="lazy" tabindex="-1"></iframe>
      <span class="ov-size">1920 × 1080</span>
    </div>
    <div class="ov-body">
      <h2>${overlay.name}</h2>
      <p class="ov-what">${overlay.what}</p>
      <p class="ov-when">${overlay.when}</p>
      <div class="ov-url">
        <code>${fullUrl(overlay.path)}</code>
        <button class="primary ov-copy">Copy link</button>
        <a class="ov-open" href="${overlay.path}" target="_blank" rel="noopener">Open</a>
      </div>
    </div>`;
  const copyBtn = el.querySelector('.ov-copy');
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(fullUrl(overlay.path));
    copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
    copyBtn.classList.toggle('done', ok);
    setTimeout(() => {
      copyBtn.textContent = 'Copy link';
      copyBtn.classList.remove('done');
    }, 1600);
  });
  return el;
}

const cards = OVERLAYS.map((overlay) => {
  const el = card(overlay);
  gallery.appendChild(el);
  return { overlay, el, iframe: el.querySelector('iframe'), box: el.querySelector('.ov-preview') };
});

// Scale each 1920x1080 iframe down to its card's width.
const ro = new ResizeObserver((entries) => {
  entries.forEach((entry) => {
    const iframe = entry.target.querySelector('iframe');
    iframe.style.transform = `scale(${entry.contentRect.width / 1920})`;
  });
});
cards.forEach((c) => ro.observe(c.box));

function loadPreviews() {
  cards.forEach((c) => {
    const src = previewSrc(c.overlay.path);
    if (c.iframe.getAttribute('src') !== src) c.iframe.setAttribute('src', src);
  });
  document.querySelectorAll('[data-preview]').forEach((b) => b.classList.toggle('active', b.dataset.preview === view.preview));
  document.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('active', b.dataset.style === view.style));
  document.getElementById('style-seg').hidden = view.preview !== 'sample';
}

document.querySelectorAll('[data-preview]').forEach((b) =>
  b.addEventListener('click', () => {
    view.preview = b.dataset.preview;
    loadPreviews();
  })
);
document.querySelectorAll('[data-style]').forEach((b) =>
  b.addEventListener('click', () => {
    view.style = b.dataset.style;
    loadPreviews();
  })
);

loadPreviews();
