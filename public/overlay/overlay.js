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

function teamChip(team) {
  const primary = team.color || '#64748b';
  const secondary = team.secondaryColor || '#ffffff';
  return `<span class="team-chip" style="background:linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)"></span>`;
}

function twoToneBg(team) {
  const primary = team.color || '#64748b';
  const secondary = team.secondaryColor || '#ffffff';
  return `linear-gradient(180deg, ${primary} 0%, ${primary} 78%, ${secondary} 78%, ${secondary} 100%)`;
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
      return `<div class="pen-row"><span class="team-label">${logo}${esc(t.name)}</span>${dots}<span class="pen-total">${made}</span></div>`;
    })
    .join('');
}

function penaltyBlock(state, options = {}) {
  if (!state.penalties.active) return '';
  return `<div class="penalties"><h4>PENALTIES</h4>${penaltyRows(state, options)}</div>`;
}

const renderers = {
  flags(state) {
    const main = `
      <div class="flags-wrap">
        <div class="flags-row">
          <div class="clock-chip">${formatClock(state.timer.seconds)}</div>
          <div class="flags-main">
            <div class="flag-team team-a" style="background:${twoToneBg(state.teamA)}">
              <span class="flag-name">${esc(state.teamA.name)}</span>${logoImg(state.teamA.logo, 'flag-img')}
            </div>
            <div class="flags-score">
              <span>${state.teamA.score}</span><span class="vs">-</span><span>${state.teamB.score}</span>
            </div>
            <div class="flag-team team-b" style="background:${twoToneBg(state.teamB)}">
              ${logoImg(state.teamB.logo, 'flag-img')}<span class="flag-name">${esc(state.teamB.name)}</span>
            </div>
          </div>
        </div>
        ${extraBadge(state.timer.extra)}
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true }) };
  },

  neon(state) {
    const neonColor = state.neonColor || '#c6f135';
    const hex = `<svg class="hex" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="none" stroke="${neonColor}" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="${neonColor}"/></svg>`;
    const main = `
      <div class="row">
        <div class="clock">${formatClock(state.timer.seconds)}</div>
        <div class="score-strip">
          <span class="team-name">${teamChip(state.teamA)}${esc(state.teamA.name)}</span>
          <span class="score">${state.teamA.score}</span>
          ${hex}
          <span class="score">${state.teamB.score}</span>
          <span class="team-name">${esc(state.teamB.name)}${teamChip(state.teamB)}</span>
        </div>
        ${extraBadge(state.timer.extra)}
      </div>
    `;
    return { main, penalty: penaltyBlock(state) };
  },
};

function render(state) {
  const renderer = renderers[state.style] || renderers.flags;
  const { main, penalty } = renderer(state);
  board.className = `board style-${state.style}`;
  board.style.setProperty('--neon-color', state.neonColor || '#c6f135');
  if (MODE === 'clock') {
    board.innerHTML = main;
  } else if (MODE === 'penalty') {
    board.innerHTML = penalty;
  } else {
    board.innerHTML = main + penalty;
  }
}

socket.on('state', render);
