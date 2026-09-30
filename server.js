const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { computeBracketRounds } = require('./public/shared/bracket-utils.js');

const PORT = process.env.PORT || 4000;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(path.join(__dirname, 'public')));

const VALID_STYLES = ['classic', 'banner', 'badges', 'flags', 'neon', 'champions'];
const VALID_BRACKET_SIZES = [4, 8, 16];
const DEFAULT_BRACKET_COLORS = [
  '#1d4ed8', '#dc2626', '#16a34a', '#d97706',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
];

function createInitialBracket(size = 8) {
  return {
    size,
    teams: Array.from({ length: size }, (_, i) => ({
      name: `TEAM ${i + 1}`,
      color: DEFAULT_BRACKET_COLORS[i % DEFAULT_BRACKET_COLORS.length],
      logo: null,
    })),
    picks: {},
  };
}

function createInitialState() {
  return {
    teamA: { name: 'TEAM 1', score: 0, color: '#1d4ed8', logo: null },
    teamB: { name: 'TEAM 2', score: 0, color: '#dc2626', logo: null },
    timer: { seconds: 0, running: false, extra: 0 },
    penalties: {
      active: false,
      teamA: [null, null, null, null, null],
      teamB: [null, null, null, null, null],
    },
    style: 'classic',
    competitionLogo: null,
    bracket: createInitialBracket(),
  };
}

let state = createInitialState();
let timerInterval = null;

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
    case 'setLogo':
      state[patch.team].logo = typeof patch.value === 'string' ? patch.value : null;
      break;
    case 'setCompetitionLogo':
      state.competitionLogo = typeof patch.value === 'string' ? patch.value : null;
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
    case 'resetMatch': {
      pauseTimer();
      const bracket = state.bracket;
      state = createInitialState();
      state.bracket = bracket;
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
    case 'bracketSetTeamLogo':
      if (state.bracket.teams[patch.index]) {
        state.bracket.teams[patch.index].logo = typeof patch.value === 'string' ? patch.value : null;
      }
      break;
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
          logo: match.teamA.logo || null,
        };
        state.teamB = {
          name: match.teamB.name,
          score: 0,
          color: match.teamB.color || '#dc2626',
          logo: match.teamB.logo || null,
        };
        state.timer = { seconds: 0, running: false, extra: 0 };
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
