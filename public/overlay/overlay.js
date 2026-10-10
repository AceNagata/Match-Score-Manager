const board = document.getElementById('board');
// Each overlay page sets window.OVERLAY_MODE: 'clock' (scoreboard), 'penalty',
// 'goal', 'cardsSubs' or 'list'. Add ?demo=1 to any of them to render sample
// data instead of the live match (used by the /overlay/ gallery previews).
const MODE = window.OVERLAY_MODE || 'clock';
const DEMO = new URLSearchParams(location.search).has('demo');

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

function extraBadge(timer) {
  return timer.extraActive ? `<span class="extra-badge">+${timer.extra}</span>` : '';
}

function logoImg(src, className) {
  return src ? `<img class="${className}" src="${src}" />` : '';
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
        ${extraBadge(state.timer)}
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true }) };
  },

  neon(state) {
    const main = `
      <div class="row">
        <div class="score-strip">
          <span class="team-name">${logoImg(state.teamA.logo, 'team-logo')}${esc(state.teamA.name)}</span>
          <span class="score">${state.teamA.score}</span>
          <div class="clock">${formatClock(state.timer.seconds)}</div>
          <span class="score">${state.teamB.score}</span>
          <span class="team-name">${esc(state.teamB.name)}${logoImg(state.teamB.logo, 'team-logo')}</span>
        </div>
        ${extraBadge(state.timer)}
      </div>
    `;
    return { main, penalty: penaltyBlock(state, { withLogos: true }) };
  },
};

// ---------- Event pop-ups and event list ----------

const stage = document.querySelector('.stage');
const POPUP_KINDS = { goal: ['goal'], cardsSubs: ['card', 'sub'] }[MODE] || null;
const SHOW_LIST = MODE === 'list';
const popupLayer = document.createElement('div');
const listLayer = document.createElement('div');
popupLayer.className = 'popup-layer';
listLayer.className = 'events-list-layer';
if (SHOW_LIST) stage.appendChild(listLayer);
if (POPUP_KINDS) stage.appendChild(popupLayer);

let shownPopupSeq = null;
let listKey = '';
const GOAL_TYPES = ['goal', 'penaltyGoal', 'ownGoal'];
const CARD_LABELS = { yellow: 'YELLOW CARD', red: 'RED CARD', secondYellow: 'SECOND YELLOW' };

function playerLabel(player) {
  if (!player) return '';
  const name = player.name ? ` ${esc(player.name)}` : '';
  return `<b>${player.number}</b>${name}`;
}

function cardIcon(type) {
  if (type === 'yellow') return '<span class="ev-card yellow"></span>';
  if (type === 'red') return '<span class="ev-card red"></span>';
  return '<span class="ev-card yellow"></span><span class="ev-card red second"></span>';
}

const BALL_SVG =
  '<svg class="ball" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5"/>' +
  '<path d="M12 7.2l4.6 3.3-1.8 5.4H9.2L7.4 10.5z"/><path d="M12 7.2V1.6M16.6 10.5l5.2-1.8M14.8 15.9l3.2 4.5M9.2 15.9 6 20.4M7.4 10.5 2.2 8.7"/></svg>';

function teamChip(team) {
  return `<span class="pop-team">${logoImg(team.logo, 'pop-logo')}<span>${esc(team.name)}</span></span>`;
}

function goalSplash(state, event) {
  const scorer = event.type === 'ownGoal' ? (event.team === 'teamA' ? 'teamB' : 'teamA') : event.team;
  const team = state[scorer];
  const tag = event.type === 'penaltyGoal' ? 'PENALTY' : event.type === 'ownGoal' ? 'OWN GOAL' : '';
  const score = event.scoreAfter || { teamA: state.teamA.score, teamB: state.teamB.score };
  const og = event.type === 'ownGoal' ? ' <span class="og">(OG)</span>' : '';
  return `
    <div class="goal-splash" style="--team:${team.color || '#64748b'};--team2:${team.secondaryColor || '#ffffff'}">
      <div class="gs-band">
        <div class="gs-word${tag ? ' has-tag' : ''}">${tag ? `<span class="gs-tag">${tag}</span>` : ''}GOAL</div>
        <div class="gs-info">
          ${teamChip(team)}
          <span class="gs-player">${BALL_SVG}${playerLabel(event.player)}${og}<span class="gs-min">${esc(event.minute)}</span></span>
        </div>
        <div class="gs-score">
          <span class="${scorer === 'teamA' ? 'hit' : ''}">${score.teamA}</span><span class="dash">-</span><span class="${scorer === 'teamB' ? 'hit' : ''}">${score.teamB}</span>
        </div>
      </div>
    </div>`;
}

function lowerThird(state, event) {
  const team = state[event.team];
  let icon;
  let label;
  let body;
  if (event.type === 'sub') {
    icon = '<span class="sub-arrows"><span class="on">▲</span><span class="off">▼</span></span>';
    label = 'SUBSTITUTION';
    body = `<span class="lt-subline on">${playerLabel(event.playerOn)}</span><span class="lt-subline off">${playerLabel(event.player)}</span>`;
  } else {
    icon = cardIcon(event.type);
    label = CARD_LABELS[event.type] || '';
    body = `<span class="lt-player">${playerLabel(event.player)}</span>`;
  }
  return `
    <div class="lower-third lt-${event.type}">
      <div class="lt-min">${esc(event.minute)}</div>
      <div class="lt-icon">${icon}</div>
      <div class="lt-body"><span class="lt-label">${label}</span>${body}</div>
      ${teamChip(team)}
    </div>`;
}

function renderPopup(state) {
  popupLayer.className = `popup-layer style-${state.style}`;
  popupLayer.style.setProperty('--neon-color', state.neonColor || '#c6f135');
  // Each pop-up page only shows its own kinds (goal page: goals; cards page: cards + subs).
  const popup = state.popup && POPUP_KINDS.includes(state.popup.kind) ? state.popup : null;
  const seq = popup ? popup.seq : null;
  if (seq === shownPopupSeq) return; // keep the running animation untouched
  shownPopupSeq = seq;

  const current = popupLayer.firstElementChild;
  if (current) {
    current.classList.add('leaving');
    setTimeout(() => current.remove(), 450);
  }
  if (!popup) return;
  const event = state.events.find((e) => e.id === popup.eventId);
  if (!event) return;
  const wrap = document.createElement('div');
  wrap.className = 'popup';
  wrap.innerHTML = GOAL_TYPES.includes(event.type) ? goalSplash(state, event) : lowerThird(state, event);
  popupLayer.appendChild(wrap);
}

function listIcon(type) {
  if (GOAL_TYPES.includes(type)) return BALL_SVG;
  if (type === 'sub') return '<span class="sub-arrows small"><span class="on">▲</span><span class="off">▼</span></span>';
  return cardIcon(type);
}

function renderEventList(state) {
  listLayer.className = `events-list-layer style-${state.style}`;
  listLayer.style.setProperty('--neon-color', state.neonColor || '#c6f135');
  const key = JSON.stringify([state.eventsListActive, state.events, state.teamA.name, state.teamB.name, state.teamA.color, state.teamB.color]);
  if (key === listKey) return;
  listKey = key;
  if (!state.eventsListActive || !state.events.length) {
    listLayer.innerHTML = '';
    return;
  }
  const rows = state.events
    .slice(-12)
    .map((event) => {
      const team = state[event.team];
      const who =
        event.type === 'sub'
          ? `${playerLabel(event.playerOn)} <span class="for">for</span> ${playerLabel(event.player)}`
          : playerLabel(event.player) + (event.type === 'ownGoal' ? ' <span class="og">(OG)</span>' : '');
      return `<div class="el-row"><span class="el-swatch" style="background:${team.color || '#64748b'}"></span><span class="el-min">${esc(event.minute)}</span><span class="el-icon">${listIcon(event.type)}</span><span class="el-who">${who}</span></div>`;
    })
    .join('');
  listLayer.innerHTML = `<div class="events-list"><h4>MATCH EVENTS</h4>${rows}</div>`;
}

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
    board.innerHTML = '';
  }
  if (POPUP_KINDS) renderPopup(state);
  if (SHOW_LIST) renderEventList(state);
}

// ---------- Sample data for gallery previews (?demo=1) ----------

function demoState() {
  const player = (number, name) => ({ number, name });
  const events = [
    { id: 'd1', type: 'goal', team: 'teamA', minute: "23'", player: player(10, 'Rebaz Aziz'), scoreAfter: { teamA: 1, teamB: 0 } },
    { id: 'd2', type: 'yellow', team: 'teamB', minute: "31'", player: player(4, 'Dara Omar') },
    { id: 'd3', type: 'sub', team: 'teamB', minute: "46'", player: player(9, 'Hemin Jalal'), playerOn: player(11, 'Shvan Kamal') },
    { id: 'd4', type: 'penaltyGoal', team: 'teamB', minute: "58'", player: player(11, 'Shvan Kamal'), scoreAfter: { teamA: 1, teamB: 1 } },
    { id: 'd5', type: 'secondYellow', team: 'teamB', minute: "67'", player: player(4, 'Dara Omar') },
    { id: 'd6', type: 'goal', team: 'teamA', minute: "90+2'", player: player(7, 'Karwan Ali'), scoreAfter: { teamA: 2, teamB: 1 } },
  ];
  return {
    teamA: { name: 'LIONS', score: 2, color: '#1d4ed8', secondaryColor: '#ffffff', logo: null },
    teamB: { name: 'FALCONS', score: 1, color: '#dc2626', secondaryColor: '#ffffff', logo: null },
    timer: { seconds: 67 * 60 + 12, running: true, extra: 3, extraActive: true },
    penalties: { active: true, teamA: [true, true, false, true, null], teamB: [true, false, true, null, null] },
    style: new URLSearchParams(location.search).get('style') === 'neon' ? 'neon' : 'flags',
    neonColor: '#c6f135',
    events,
    eventsListActive: true,
    popup: null,
  };
}

function runDemo() {
  const state = demoState();
  const goals = state.events.filter((e) => GOAL_TYPES.includes(e.type));
  const others = state.events.filter((e) => !GOAL_TYPES.includes(e.type));
  const cycle = MODE === 'goal' ? goals : others;
  let i = 0;
  let seq = 0;
  const showNext = () => {
    if (!cycle.length) return;
    const event = cycle[i % cycle.length];
    i += 1;
    seq += 1;
    state.popup = { seq, eventId: event.id, kind: GOAL_TYPES.includes(event.type) ? 'goal' : event.type === 'sub' ? 'sub' : 'card' };
    render(state);
  };
  render(state);
  if (POPUP_KINDS) {
    showNext();
    setInterval(showNext, 5000);
  }
  setInterval(() => {
    state.timer.seconds += 1;
    render(state);
  }, 1000);
}

if (DEMO) {
  runDemo();
} else {
  const socket = io();
  socket.on('state', render);
}
