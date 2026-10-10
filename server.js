const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { computeBracketRounds } = require('./public/shared/bracket-utils.js');

const PORT = process.env.PORT || 4000;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(path.join(__dirname, 'public')));

const VALID_STYLES = ['flags', 'neon'];
const VALID_BRACKET_SIZES = [4, 8, 16];
const VALID_EVENT_TYPES = ['goal', 'penaltyGoal', 'ownGoal', 'yellow', 'red', 'sub'];
const GOAL_TYPES = ['goal', 'penaltyGoal', 'ownGoal'];
const MAX_SQUAD = 40;
const MAX_EVENTS = 200;
// How long each pop-up stays on air before hiding itself (ms).
const POPUP_DURATION = { goal: 9000, card: 7000, sub: 8000 };
const DEFAULT_BRACKET_COLORS = [
  '#1d4ed8', '#dc2626', '#16a34a', '#d97706',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
];

function createBlankBracketSlot(index) {
  return {
    name: `TEAM ${index + 1}`,
    color: DEFAULT_BRACKET_COLORS[index % DEFAULT_BRACKET_COLORS.length],
    secondaryColor: '#ffffff',
    logo: null,
    rosterId: null,
  };
}

function createInitialBracket(size = 8) {
  return {
    size,
    teams: Array.from({ length: size }, (_, i) => createBlankBracketSlot(i)),
    picks: {},
  };
}

function createInitialState() {
  return {
    teamA: { name: 'TEAM 1', score: 0, color: '#1d4ed8', secondaryColor: '#ffffff', logo: null, squad: [] },
    teamB: { name: 'TEAM 2', score: 0, color: '#dc2626', secondaryColor: '#ffffff', logo: null, squad: [] },
    timer: { seconds: 0, running: false, extra: 0, extraActive: false },
    penalties: {
      active: false,
      teamA: [null, null, null, null, null],
      teamB: [null, null, null, null, null],
    },
    style: 'flags',
    neonColor: '#c6f135',
    connectorColor: '#ffffff',
    bracket: createInitialBracket(),
    teamRoster: [],
    events: [],
    eventsListActive: false,
    popup: null,
  };
}

let state = createInitialState();
let timerInterval = null;
let popupTimeout = null;
let popupSeq = 0;

function broadcastState() {
  io.emit('state', state);
}

function startTimer() {
  if (timerInterval) return;
  state.timer.running = true;
  timerInterval = setInterval(() => {
    state.timer.seconds += 1;
    broadcastState();
  }, 1000);
}

function pauseTimer() {
  state.timer.running = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function resetTimer() {
  pauseTimer();
  state.timer.seconds = 0;
}

const TEAMS = ['teamA', 'teamB'];
const otherTeam = (team) => (team === 'teamA' ? 'teamB' : 'teamA');

function cleanNumber(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
}

function cleanPlayerName(value) {
  return String(value == null ? '' : value).trim().slice(0, 24);
}

function sortSquad(squad) {
  squad.sort((a, b) => a.number - b.number);
}

// Accepts one player per line: "10 Name", "10. Name", "10 - Name", "10, Name" or just "10".
function parseSquadText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#?(\d{1,2})\s*[.,:\-–]?\s*(.*)$/))
    .filter(Boolean)
    .map((m) => ({ number: cleanNumber(m[1]), name: cleanPlayerName(m[2]) }))
    .filter((p) => p.number !== null);
}

function snapshotPlayer(player) {
  return player ? { number: player.number, name: player.name } : null;
}

// Match minute in broadcast style: 0:00–0:59 is 1'.
function minuteFromSeconds(seconds) {
  return `${Math.floor(seconds / 60) + 1}'`;
}

function cleanMinute(value) {
  const text = String(value == null ? '' : value).trim().replace(/['’]+$/, '');
  if (!/^\d{1,3}(\+\d{1,2})?$/.test(text)) return null;
  return `${text}'`;
}

function popupKind(type) {
  if (GOAL_TYPES.includes(type)) return 'goal';
  if (type === 'sub') return 'sub';
  return 'card';
}

function showPopup(event) {
  clearTimeout(popupTimeout);
  popupSeq += 1;
  const kind = popupKind(event.type);
  state.popup = { seq: popupSeq, eventId: event.id, kind };
  popupTimeout = setTimeout(() => {
    if (state.popup && state.popup.seq === popupSeq) {
      state.popup = null;
      broadcastState();
    }
  }, POPUP_DURATION[kind]);
}

function hidePopup() {
  clearTimeout(popupTimeout);
  state.popup = null;
}

// The team whose score a goal event changes (an own goal counts for the opponent).
function scoringTeam(event) {
  return event.type === 'ownGoal' ? otherTeam(event.team) : event.team;
}

function addEvent(patch) {
  if (!VALID_EVENT_TYPES.includes(patch.eventType) || !TEAMS.includes(patch.team)) return;
  const team = state[patch.team];
  const player = team.squad.find((p) => p.id === patch.playerId);
  if (!player) return;
  const event = {
    id: crypto.randomUUID(),
    type: patch.eventType,
    team: patch.team,
    seconds: state.timer.seconds,
    minute: cleanMinute(patch.minute) || minuteFromSeconds(state.timer.seconds),
    player: snapshotPlayer(player),
    playerId: player.id,
  };
  if (event.type === 'sub') {
    const on = team.squad.find((p) => p.id === patch.playerOnId);
    if (!on || on.id === player.id) return;
    event.playerOn = snapshotPlayer(on);
    event.playerOnId = on.id;
  }
  if (event.type === 'yellow') {
    const priorYellows = state.events.filter(
      (e) => e.team === event.team && e.playerId === player.id && e.type === 'yellow'
    ).length;
    if (priorYellows >= 1) event.type = 'secondYellow';
  }
  if (GOAL_TYPES.includes(event.type)) {
    state[scoringTeam(event)].score += 1;
    event.scoreAfter = { teamA: state.teamA.score, teamB: state.teamB.score };
  }
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) state.events.shift();
  showPopup(event);
}

function removeEvent(id) {
  const event = state.events.find((e) => e.id === id);
  if (!event) return;
  if (GOAL_TYPES.includes(event.type)) {
    const t = scoringTeam(event);
    state[t].score = Math.max(0, state[t].score - 1);
  }
  state.events = state.events.filter((e) => e.id !== id);
  if (state.popup && state.popup.eventId === id) hidePopup();
}

function applyPatch(patch) {
  switch (patch.type) {
    case 'setName':
      state[patch.team].name = String(patch.value).slice(0, 24);
      break;
    case 'incrementScore':
      state[patch.team].score = Math.max(0, state[patch.team].score + patch.delta);
      break;
    case 'setColor':
      state[patch.team].color = patch.value;
      break;
    case 'setSecondaryColor':
      state[patch.team].secondaryColor = patch.value;
      break;
    case 'setLogo':
      state[patch.team].logo = typeof patch.value === 'string' ? patch.value : null;
      break;
    case 'setNeonColor':
      state.neonColor = patch.value;
      break;
    case 'setConnectorColor':
      state.connectorColor = patch.value;
      break;
    case 'timerStart':
      startTimer();
      break;
    case 'timerPause':
      pauseTimer();
      break;
    case 'timerReset':
      resetTimer();
      break;
    case 'timerAdjust':
      state.timer.seconds = Math.max(0, state.timer.seconds + patch.delta);
      break;
    case 'extraAdjust':
      state.timer.extra = Math.max(0, Math.min(99, state.timer.extra + patch.delta));
      break;
    case 'extraActiveToggle':
      state.timer.extraActive = Boolean(patch.value);
      break;
    case 'endMatch':
      resetTimer();
      state.timer.extra = 0;
      state.timer.extraActive = false;
      state.teamA.name = '';
      state.teamB.name = '';
      break;
    case 'setStyle':
      if (VALID_STYLES.includes(patch.value)) state.style = patch.value;
      break;
    case 'penaltiesToggle':
      state.penalties.active = Boolean(patch.value);
      break;
    case 'penaltyMark': {
      const slots = state.penalties[patch.team];
      const current = slots[patch.index];
      slots[patch.index] = current === null ? true : current === true ? false : null;
      break;
    }
    case 'squadAdd': {
      if (!TEAMS.includes(patch.team)) break;
      const squad = state[patch.team].squad;
      const number = cleanNumber(patch.number);
      if (number === null || squad.length >= MAX_SQUAD) break;
      if (squad.some((p) => p.number === number)) break;
      squad.push({ id: crypto.randomUUID(), number, name: cleanPlayerName(patch.name) });
      sortSquad(squad);
      break;
    }
    case 'squadUpdate': {
      if (!TEAMS.includes(patch.team)) break;
      const squad = state[patch.team].squad;
      const player = squad.find((p) => p.id === patch.id);
      if (!player) break;
      if (patch.name !== undefined) player.name = cleanPlayerName(patch.name);
      if (patch.number !== undefined) {
        const number = cleanNumber(patch.number);
        if (number !== null && !squad.some((p) => p.number === number && p.id !== player.id)) {
          player.number = number;
          sortSquad(squad);
        }
      }
      break;
    }
    case 'squadRemove':
      if (TEAMS.includes(patch.team)) {
        state[patch.team].squad = state[patch.team].squad.filter((p) => p.id !== patch.id);
      }
      break;
    case 'squadReplace': {
      if (!TEAMS.includes(patch.team)) break;
      const seen = new Set();
      state[patch.team].squad = parseSquadText(patch.text)
        .filter((p) => !seen.has(p.number) && seen.add(p.number))
        .slice(0, MAX_SQUAD)
        .map((p) => ({ id: crypto.randomUUID(), ...p }));
      sortSquad(state[patch.team].squad);
      break;
    }
    case 'eventAdd':
      addEvent(patch);
      break;
    case 'eventRemove':
      removeEvent(patch.id);
      break;
    case 'eventShow': {
      const event = state.events.find((e) => e.id === patch.id);
      if (event) showPopup(event);
      break;
    }
    case 'popupHide':
      hidePopup();
      break;
    case 'eventsListToggle':
      state.eventsListActive = Boolean(patch.value);
      break;
    case 'eventsClear':
      state.events = [];
      hidePopup();
      break;
    case 'resetMatch': {
      pauseTimer();
      hidePopup();
      const bracket = state.bracket;
      const teamRoster = state.teamRoster;
      state = createInitialState();
      state.bracket = bracket;
      state.teamRoster = teamRoster;
      break;
    }
    case 'bracketSetSize':
      if (VALID_BRACKET_SIZES.includes(patch.value)) {
        state.bracket = createInitialBracket(patch.value);
      }
      break;
    case 'bracketSetTeamName':
      if (state.bracket.teams[patch.index]) {
        state.bracket.teams[patch.index].name = String(patch.value).slice(0, 24);
      }
      break;
    case 'bracketSetTeamColor':
      if (state.bracket.teams[patch.index]) {
        state.bracket.teams[patch.index].color = patch.value;
      }
      break;
    case 'bracketSetTeamSecondaryColor':
      if (state.bracket.teams[patch.index]) {
        state.bracket.teams[patch.index].secondaryColor = patch.value;
      }
      break;
    case 'bracketSetTeamLogo':
      if (state.bracket.teams[patch.index]) {
        state.bracket.teams[patch.index].logo = typeof patch.value === 'string' ? patch.value : null;
      }
      break;
    case 'rosterAddTeam': {
      state.teamRoster.push({
        id: crypto.randomUUID(),
        name: String(patch.name || 'NEW TEAM').slice(0, 24),
        color: patch.color || '#64748b',
        secondaryColor: patch.secondaryColor || '#ffffff',
        logo: null,
      });
      break;
    }
    case 'rosterSetName': {
      const t = state.teamRoster.find((r) => r.id === patch.id);
      if (t) t.name = String(patch.value).slice(0, 24);
      break;
    }
    case 'rosterSetColor': {
      const t = state.teamRoster.find((r) => r.id === patch.id);
      if (t) t.color = patch.value;
      break;
    }
    case 'rosterSetSecondaryColor': {
      const t = state.teamRoster.find((r) => r.id === patch.id);
      if (t) t.secondaryColor = patch.value;
      break;
    }
    case 'rosterSetLogo': {
      const t = state.teamRoster.find((r) => r.id === patch.id);
      if (t) t.logo = typeof patch.value === 'string' ? patch.value : null;
      break;
    }
    case 'rosterRemoveTeam': {
      state.teamRoster = state.teamRoster.filter((r) => r.id !== patch.id);
      state.bracket.teams.forEach((slot, i) => {
        if (slot.rosterId === patch.id) {
          state.bracket.teams[i] = createBlankBracketSlot(i);
        }
      });
      break;
    }
    case 'bracketAssignTeam': {
      const slotIndex = patch.index;
      if (state.bracket.teams[slotIndex] === undefined) break;
      if (!patch.teamId) {
        state.bracket.teams[slotIndex] = createBlankBracketSlot(slotIndex);
        break;
      }
      const rosterTeam = state.teamRoster.find((r) => r.id === patch.teamId);
      if (rosterTeam) {
        state.bracket.teams[slotIndex] = {
          name: rosterTeam.name,
          color: rosterTeam.color,
          secondaryColor: rosterTeam.secondaryColor,
          logo: rosterTeam.logo,
          rosterId: rosterTeam.id,
        };
      }
      break;
    }
    case 'bracketPickWinner': {
      const { round, match, side } = patch;
      if (!state.bracket.picks[round]) state.bracket.picks[round] = {};
      if (side === 'A' || side === 'B') {
        state.bracket.picks[round][match] = side;
      } else {
        delete state.bracket.picks[round][match];
      }
      const roundCount = Math.log2(state.bracket.size);
      for (let r = round + 1; r < roundCount; r += 1) {
        state.bracket.picks[r] = {};
      }
      break;
    }
    case 'bracketReset':
      state.bracket = createInitialBracket(state.bracket.size);
      break;
    case 'startMatchFromBracket': {
      const rounds = computeBracketRounds(state.bracket);
      const match = rounds[patch.round] && rounds[patch.round][patch.match];
      if (match && match.teamA && match.teamB) {
        pauseTimer();
        state.teamA = {
          name: match.teamA.name,
          score: 0,
          color: match.teamA.color || '#1d4ed8',
          secondaryColor: match.teamA.secondaryColor || '#ffffff',
          logo: match.teamA.logo || null,
          squad: [],
        };
        state.teamB = {
          name: match.teamB.name,
          score: 0,
          color: match.teamB.color || '#dc2626',
          secondaryColor: match.teamB.secondaryColor || '#ffffff',
          logo: match.teamB.logo || null,
          squad: [],
        };
        state.events = [];
        hidePopup();
        state.timer = { seconds: 0, running: false, extra: 0, extraActive: false };
        state.penalties = {
          active: false,
          teamA: [null, null, null, null, null],
          teamB: [null, null, null, null, null],
        };
      }
      break;
    }
    default:
      break;
  }
}

io.on('connection', (socket) => {
  socket.emit('state', state);

  socket.on('control:update', (patch) => {
    if (!patch || typeof patch.type !== 'string') return;
    if (CONTROL_TOKEN && patch.token !== CONTROL_TOKEN) return;
    applyPatch(patch);
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Match Score Manager running on http://localhost:${PORT}`);
  console.log(`  Control panel : http://localhost:${PORT}/control/`);
  console.log(`  OBS overlay   : http://localhost:${PORT}/overlay/`);
});
