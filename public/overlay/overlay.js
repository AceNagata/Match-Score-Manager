const socket = io();
const board = document.getElementById('board');
const MODE = window.OVERLAY_MODE || 'full';

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function extraBadge(extra) {
  return extra > 0 ? `<span class="extra-badge">+${extra}</span>` : '';
}

function logoImg(src, className) {
  return src ? `<img class="${className}" src="${src}" />` : '';
}

function penaltyRows(state, options = {}) {
  return ['teamA', 'teamB']
    .map((team) => {
      const t = state[team];
      const slots = state.penalties[team];
      let made = 0;
      const dots = slots
        .map((value) => {
          if (value === true) {
            made += 1;
            return '<span class="pen-dot scored">✓</span>';
          }
          if (value === false) {
            return '<span class="pen-dot missed">✕</span>';
          }
          return '<span class="pen-dot"></span>';
        })
        .join('');
      const logo = options.withLogos ? logoImg(t.logo, 'pen-logo') : '';
      const stripe = options.stripe ? ` style="--stripe:${t.color}"` : '';
      return `<div class="pen-row"${stripe}><span class="team-label">${logo}${esc(t.name)}</span>${dots}<span class="pen-total">${made}</span></div>`;
    })
    .join('');
}

function penaltyBlock(state, options = {}) {
  if (!state.penalties.active) return '';
  return `<div class="penalties"><h4>PENALTIES</h4>${penaltyRows(state, options)}</div>`;
}

const renderers = {
  classic(state) {
    const main = `
      <div class="row">
        <div class="clock">${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
        <div class="score-strip">
          <span>${esc(state.teamA.name)}</span>
          <span class="score">${state.teamA.score} - ${state.teamB.score}</span>
          <span>${esc(state.teamB.name)}</span>
        </div>
      </div>
    `;
    return { main, penalty: penaltyBlock(state) };
  },

  banner(state) {
    const main = `
      <div class="banner-row">
        <div class="team-block team-a" style="background:${state.teamA.color}">
          ${logoImg(state.teamA.logo, 'team-logo')}<span>${esc(state.teamA.name)}</span>
        </div>
        <div class="score-block">${state.teamA.score} - ${state.teamB.score}</div>
        <div class="team-block team-b" style="background:${state.teamB.color}">
          <span>${esc(state.teamB.name)}</span>${logoImg(state.teamB.logo, 'team-logo')}
        </div>
      </div>
      <div class="clock-pill">${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
    `;
    return { main, penalty: penaltyBlock(state) };
  },

  badges(state) {
    const main = `
      <div class="row">
        <div class="clock">${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
        <div class="score-strip">
          <span class="team-side">${logoImg(state.teamA.logo, 'team-logo')}<span>${esc(state.teamA.name)}</span></span>
          <span class="score-box">${state.teamA.score} - ${state.teamB.score}</span>
          <span class="team-side"><span>${esc(state.teamB.name)}</span>${logoImg(state.teamB.logo, 'team-logo')}</span>
        </div>
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true }) };
  },

  flags(state) {
    const main = `
      <div class="flags-row">
        <div class="clock-chip">${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
        <div class="flags-main">
          <div class="flag-team team-a" style="background:${state.teamA.color}">
            <span>${esc(state.teamA.name)}</span>${logoImg(state.teamA.logo, 'flag-img')}
          </div>
          <div class="flags-score">
            <span>${state.teamA.score}</span><span class="vs">VS</span><span>${state.teamB.score}</span>
          </div>
          <div class="flag-team team-b" style="background:${state.teamB.color}">
            ${logoImg(state.teamB.logo, 'flag-img')}<span>${esc(state.teamB.name)}</span>
          </div>
        </div>
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true }) };
  },

  neon(state) {
    const hex = `<svg class="hex" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="#c6f135" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#c6f135"/></svg>`;
    const main = `
      <div class="row">
        <div class="clock">${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
        <div class="score-strip">
          <span>${esc(state.teamA.name)}</span>
          <span class="score">${state.teamA.score}</span>
          ${hex}
          <span class="score">${state.teamB.score}</span>
          <span>${esc(state.teamB.name)}</span>
        </div>
      </div>
    `;
    return { main, penalty: penaltyBlock(state) };
  },

  champions(state) {
    const comp = state.competitionLogo
      ? `<img class="comp-logo" src="${state.competitionLogo}" />`
      : '<span class="comp-logo">⚽</span>';
    const main = `
      <div class="row">
        <div class="clock">${comp}${formatClock(state.timer.seconds)}${extraBadge(state.timer.extra)}</div>
        <div class="score-strip">
          <span>${esc(state.teamA.name)}</span>
          <span class="bracket left">❯</span>
          <span>${state.teamA.score}</span>
          <span>${state.teamB.score}</span>
          <span class="bracket right">❮</span>
          <span>${esc(state.teamB.name)}</span>
        </div>
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true, stripe: true }) };
  },
};

function render(state) {
  const renderer = renderers[state.style] || renderers.classic;
  const { main, penalty } = renderer(state);
  board.className = `board style-${state.style}`;
  if (MODE === 'clock') {
    board.innerHTML = main;
  } else if (MODE === 'penalty') {
    board.innerHTML = penalty;
  } else {
    board.innerHTML = main + penalty;
  }
}

socket.on('state', render);
