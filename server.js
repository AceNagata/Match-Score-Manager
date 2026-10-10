const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { computeBracketRounds } = require('./public/shared/bracket-utils.js');
const { createStore, createMemoryStore, isValidId } = require('./store.js');

const PORT = process.env.PORT || 4000;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN || null;

// Never let a broken database client stop the scoreboard from starting.
function safeCreateStore() {
  try {
    return createStore();
  } catch (err) {
    console.error('Could not create the storage backend; running without saving:', err);
    return createMemoryStore();
  }
}
const store = safeCreateStore();
const SAVE_DEBOUNCE_MS = 800;
const SAVE_RETRY_MS = 15000;
// Firestore documents are capped at 1 MiB; stay well under it (logos are the bulk).
const MAX_DOC_BYTES = 900000;
const DEFAULT_TOURNAMENT_NAME = 'Untitled tournament';

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
    scores: {},
  };
}

function cleanTournamentName(value) {
  return String(value == null ? '' : value).trim().slice(0, 60) || DEFAULT_TOURNAMENT_NAME;
}

function newTournament(name) {
  return { id: crypto.randomUUID(), name: cleanTournamentName(name) };
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
    // The saved tournament (roster + bracket) being worked on, the list of saved ones,
    // and whether/where the working copy is stored.
    tournament: newTournament(),
    tournaments: [],
    persist: { mode: store.mode, status: 'idle', savedAt: null, error: null },
    // The bracket match currently on the scoreboard, whose score is kept in step with it.
    liveMatch: null,
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
  // A goal can be logged without naming the scorer; the overlay then shows just team and time.
  const noPlayer = GOAL_TYPES.includes(patch.eventType) && !patch.playerId;
  const player = noPlayer ? null : team.squad.find((p) => p.id === patch.playerId);
  if (!noPlayer && !player) return;
  const event = {
    id: crypto.randomUUID(),
    type: patch.eventType,
    team: patch.team,
    seconds: state.timer.seconds,
    minute: cleanMinute(patch.minute) || minuteFromSeconds(state.timer.seconds),
    player: snapshotPlayer(player),
    playerId: player ? player.id : null,
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

// ---------- Bracket scores and the live-match link ----------

// bracket.scores[round][match] = { A, B }. A score is only meaningful for the two teams
// that played it, so anything that changes a match's participants clears it (and the
// matches it feeds into).
function bracketRoundCount() {
  return Math.log2(state.bracket.size);
}

function scoreAt(round, match) {
  const inRound = state.bracket.scores && state.bracket.scores[round];
  return (inRound && inRound[match]) || null;
}

function writeScore(round, match, a, b) {
  if (!state.bracket.scores) state.bracket.scores = {};
  if (!state.bracket.scores[round]) state.bracket.scores[round] = {};
  state.bracket.scores[round][match] = { A: a, B: b };
}

function clearScoresFrom(round, match) {
  const scores = state.bracket.scores;
  if (!scores) return;
  let m = match;
  for (let r = round; r < bracketRoundCount(); r += 1) {
    if (scores[r]) delete scores[r][m];
    m = Math.floor(m / 2);
  }
}

// The two bracket team objects on the scoreboard. Comparing by reference notices every way
// the match can change underneath us (team reassigned, earlier winner changed, bracket
// replaced, tournament switched) without enumerating them.
let liveRefs = null;

function unlinkLiveMatch() {
  state.liveMatch = null;
  liveRefs = null;
}

function syncLiveMatch() {
  if (!state.liveMatch) return;
  const { round, match } = state.liveMatch;
  const rounds = computeBracketRounds(state.bracket);
  const m = rounds[round] && rounds[round][match];
  if (!m || !liveRefs || m.teamA !== liveRefs.a || m.teamB !== liveRefs.b) {
    unlinkLiveMatch();
    return;
  }
  const current = scoreAt(round, match);
  if (!current || current.A !== state.teamA.score || current.B !== state.teamB.score) {
    writeScore(round, match, state.teamA.score, state.teamB.score);
  }
}

// ---------- Saved tournaments ----------

const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function normalizeRoster(roster) {
  if (!Array.isArray(roster)) return [];
  return roster
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => ({
      id: t.id,
      name: String(t.name || 'NEW TEAM').slice(0, 24),
      color: typeof t.color === 'string' ? t.color : '#64748b',
      secondaryColor: typeof t.secondaryColor === 'string' ? t.secondaryColor : '#ffffff',
      logo: typeof t.logo === 'string' ? t.logo : null,
    }));
}

function normalizeBracket(bracket) {
  const size = bracket && VALID_BRACKET_SIZES.includes(bracket.size) ? bracket.size : 8;
  const blank = createInitialBracket(size);
  if (!bracket || !Array.isArray(bracket.teams)) return blank;
  const teams = blank.teams.map((slot, i) => {
    const t = bracket.teams[i];
    if (!t || typeof t !== 'object') return slot;
    return {
      name: String(t.name == null ? slot.name : t.name).slice(0, 24),
      color: typeof t.color === 'string' ? t.color : slot.color,
      secondaryColor: typeof t.secondaryColor === 'string' ? t.secondaryColor : '#ffffff',
      logo: typeof t.logo === 'string' ? t.logo : null,
      rosterId: typeof t.rosterId === 'string' ? t.rosterId : null,
    };
  });
  return { size, teams, picks: plainObject(bracket.picks), scores: plainObject(bracket.scores) };
}

const sortIndex = (list) => list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

// What gets saved. Comparing this string is how we know whether anything needs saving.
function persistSignature() {
  return JSON.stringify([state.tournament.name, state.teamRoster, state.bracket]);
}

// A tournament nobody has touched yet isn't worth a database row.
function isPristine() {
  return persistSignature() === JSON.stringify([DEFAULT_TOURNAMENT_NAME, [], createInitialBracket(state.bracket.size)]);
}

function describeStoreError(err) {
  const code = err && err.code;
  if (code === 5) return 'database not found';
  if (code === 7) return 'permission denied';
  if (code === 14 || code === 'ECONNREFUSED') return 'database unreachable';
  return 'save failed';
}

function setPersist(status, extra = {}) {
  state.persist = { mode: store.mode, status, savedAt: state.persist.savedAt, error: null, ...extra };
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let lastSig = '';          // signature after the most recent patch
let savedSig = null;       // signature known to be in the database (null: nothing saved yet)
let activeIdInDb = null;   // which tournament the database says to resume on startup
let indexStale = false;    // the saved-tournament list couldn't be read and needs refreshing
let saveTimer = null;
let retryTimer = null;
let saveInFlight = null;

function upsertIndex(doc) {
  const rest = state.tournaments.filter((t) => t.id !== doc.id);
  rest.push({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt });
  state.tournaments = sortIndex(rest);
}

function markPersistDirty() {
  if (store.mode === 'memory') return;
  setPersist('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), SAVE_DEBOUNCE_MS);
}

async function writeDoc(doc, sig) {
  try {
    if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) {
      const err = new Error('tournament too large');
      err.tooLarge = true;
      throw err;
    }
    await store.saveTournament(doc);
    if (activeIdInDb !== doc.id) {
      await store.setActiveId(doc.id);
      activeIdInDb = doc.id;
    }
    savedSig = sig;
    upsertIndex(doc);
    if (indexStale) {
      try {
        state.tournaments = sortIndex(await store.listTournaments());
        indexStale = false;
      } catch (err) {
        console.error('Refreshing the saved-tournament list failed:', err);
      }
    }
    // If the working copy moved on while this write was in flight, a newer save is already queued.
    setPersist(persistSignature() === sig ? 'saved' : 'saving', { savedAt: doc.updatedAt });
  } catch (err) {
    console.error('Saving the tournament failed:', err);
    setPersist('error', { error: err.tooLarge ? 'too large to save (use smaller logos)' : describeStoreError(err) });
    if (!err.tooLarge) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => flushSave(), SAVE_RETRY_MS);
    }
  }
  broadcastState();
}

// Writes the working copy now (without waiting for the debounce) if it differs from what is stored.
// Never rejects: failures are recorded in state.persist.
async function flushSave(force = false) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (store.mode === 'memory') return;
  while (saveInFlight) await saveInFlight;

  const sig = persistSignature();
  if (sig === savedSig || (!force && savedSig === null && isPristine())) {
    if (state.persist.status === 'saving') {
      setPersist(savedSig === null ? 'idle' : 'saved');
      broadcastState();
    }
    return;
  }
  const doc = JSON.parse(JSON.stringify({
    id: state.tournament.id,
    name: state.tournament.name,
    updatedAt: Date.now(),
    teamRoster: state.teamRoster,
    bracket: state.bracket,
  }));
  saveInFlight = writeDoc(doc, sig).finally(() => {
    saveInFlight = null;
  });
  await saveInFlight;
}

// Swap a stored tournament in as the working copy.
function applyTournamentDoc(doc) {
  clearTimeout(saveTimer);
  state.tournament = { id: doc.id, name: cleanTournamentName(doc.name) };
  state.teamRoster = normalizeRoster(doc.teamRoster);
  state.bracket = normalizeBracket(doc.bracket);
  unlinkLiveMatch();
  lastSig = savedSig = persistSignature();
  setPersist('saved', { savedAt: doc.updatedAt || null });
}

async function startNewTournament(name) {
  await flushSave();
  if (state.persist.status === 'error') return; // don't discard edits that aren't safely stored
  clearTimeout(saveTimer);
  state.tournament = newTournament(name);
  state.teamRoster = [];
  state.bracket = createInitialBracket(state.bracket.size);
  unlinkLiveMatch();
  savedSig = null;
  lastSig = persistSignature();
  setPersist('idle', { savedAt: null });
}

async function openTournament(id) {
  if (!isValidId(id) || id === state.tournament.id) return;
  await flushSave();
  if (state.persist.status === 'error') return;
  const doc = await store.loadTournament(id);
  if (!doc) {
    state.tournaments = state.tournaments.filter((t) => t.id !== id);
    return;
  }
  await flushSave(); // anything edited while the other tournament was being read
  if (state.persist.status === 'error') return;
  applyTournamentDoc(doc);
  await store.setActiveId(doc.id);
  activeIdInDb = doc.id;
}

async function deleteTournament(id) {
  if (!isValidId(id) || id === state.tournament.id) return; // the open one can't be deleted
  await store.deleteTournament(id);
  state.tournaments = state.tournaments.filter((t) => t.id !== id);
}

// Tournament operations touch the database, so they run one at a time, in order.
let tournamentQueue = Promise.resolve();
const ASYNC_TOURNAMENT_PATCHES = new Set(['tournamentNew', 'tournamentOpen', 'tournamentDelete']);

function runTournamentPatch(patch) {
  if (store.mode === 'memory') return;
  tournamentQueue = tournamentQueue
    .then(() => {
      if (patch.type === 'tournamentNew') return startNewTournament(patch.name);
      if (patch.type === 'tournamentOpen') return openTournament(patch.id);
      return deleteTournament(patch.id);
    })
    .catch((err) => {
      console.error('Tournament operation failed:', err);
      setPersist('error', { error: describeStoreError(err) });
    })
    .then(() => broadcastState());
}

async function initPersistence() {
  try {
    await withTimeout(
      (async () => {
        await store.init();
        state.tournaments = sortIndex(await store.listTournaments());
        activeIdInDb = await store.getActiveId();
        const doc = activeIdInDb ? await store.loadTournament(activeIdInDb) : null;
        if (doc) applyTournamentDoc(doc);
      })(),
      10000,
      'timed out reading saved tournaments'
    );
  } catch (err) {
    console.error('Saved tournaments are unavailable at startup:', err);
    indexStale = true;
    setPersist('error', { error: describeStoreError(err) });
  }
  lastSig = persistSignature();
}

async function shutdown() {
  try {
    await withTimeout(flushSave(), 8000, 'timed out saving on shutdown');
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

// After every patch: keep the live match's bracket score current, and queue a save if the
// roster/bracket/name changed.
function afterPatch() {
  syncLiveMatch();
  const sig = persistSignature();
  if (sig !== lastSig) {
    lastSig = sig;
    markPersistDirty();
  }
}

// The scoreboard's "-" button. If that team's latest goal was logged without a scorer (which is
// what "+" does), take the event back so the log and the pop-up stay honest; otherwise
// (the latest goal names a player, or there is none to take back) just lower the number.
function undoGoal(team) {
  const latest = [...state.events].reverse().find((e) => GOAL_TYPES.includes(e.type) && scoringTeam(e) === team);
  if (latest && !latest.player) removeEvent(latest.id);
  else state[team].score = Math.max(0, state[team].score - 1);
}

function applyPatch(patch) {
  switch (patch.type) {
    case 'setName':
      state[patch.team].name = String(patch.value).slice(0, 24);
      break;
    case 'incrementScore': {
      if (!TEAMS.includes(patch.team)) break;
      // "+" is a goal: it's logged as an event (team + clock minute, no scorer) so the goal
      // pop-up shows without anyone having to pick a player.
      const steps = Math.max(-20, Math.min(20, Math.trunc(Number(patch.delta)) || 0));
      for (let i = 0; i < Math.abs(steps); i += 1) {
        if (steps > 0) addEvent({ eventType: 'goal', team: patch.team });
        else undoGoal(patch.team);
      }
      break;
    }
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
      // The score stays recorded in the bracket; it just stops following the scoreboard.
      unlinkLiveMatch();
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
      unlinkLiveMatch();
      const { bracket, teamRoster, tournament, tournaments, persist } = state;
      state = createInitialState();
      Object.assign(state, { bracket, teamRoster, tournament, tournaments, persist });
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
          clearScoresFrom(0, Math.floor(i / 2));
        }
      });
      break;
    }
    case 'bracketAssignTeam': {
      const slotIndex = patch.index;
      if (state.bracket.teams[slotIndex] === undefined) break;
      if (!patch.teamId) {
        state.bracket.teams[slotIndex] = createBlankBracketSlot(slotIndex);
        clearScoresFrom(0, Math.floor(slotIndex / 2));
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
        clearScoresFrom(0, Math.floor(slotIndex / 2));
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
      // The winner who advances changed, so the match they advance into has new participants.
      if (Number.isInteger(round) && Number.isInteger(match)) clearScoresFrom(round + 1, Math.floor(match / 2));
      break;
    }
    case 'bracketSetScore': {
      const { round, match, side } = patch;
      if (!Number.isInteger(round) || !Number.isInteger(match) || (side !== 'A' && side !== 'B')) break;
      const rounds = computeBracketRounds(state.bracket);
      const m = rounds[round] && rounds[round][match];
      if (!m || !m.teamA || !m.teamB) break; // nothing to score until both teams are known
      const blank = patch.value === null || patch.value === '';
      const value = blank ? null : cleanNumber(patch.value);
      if (!blank && value === null) break; // not a valid score
      const next = { A: m.scoreA, B: m.scoreB, [side]: value };
      if (next.A === null && next.B === null) {
        if (state.bracket.scores && state.bracket.scores[round]) delete state.bracket.scores[round][match];
      } else {
        writeScore(round, match, next.A, next.B);
      }
      // Typing a score for the match that is on the scoreboard updates the scoreboard too.
      if (state.liveMatch && state.liveMatch.round === round && state.liveMatch.match === match && value !== null) {
        state[side === 'A' ? 'teamA' : 'teamB'].score = value;
      }
      break;
    }
    case 'tournamentRename':
      state.tournament.name = cleanTournamentName(patch.value);
      break;
    case 'bracketReset':
      state.bracket = createInitialBracket(state.bracket.size);
      break;
    case 'startMatchFromBracket': {
      const rounds = computeBracketRounds(state.bracket);
      const match = rounds[patch.round] && rounds[patch.round][patch.match];
      if (match && match.teamA && match.teamB) {
        pauseTimer();
        // A match that already has a recorded score picks up from it (e.g. after a restart).
        const startA = match.scoreA === null ? 0 : match.scoreA;
        const startB = match.scoreB === null ? 0 : match.scoreB;
        state.liveMatch = { round: patch.round, match: patch.match };
        liveRefs = { a: match.teamA, b: match.teamB };
        writeScore(patch.round, patch.match, startA, startB);
        state.teamA = {
          name: match.teamA.name,
          score: startA,
          color: match.teamA.color || '#1d4ed8',
          secondaryColor: match.teamA.secondaryColor || '#ffffff',
          logo: match.teamA.logo || null,
          squad: [],
        };
        state.teamB = {
          name: match.teamB.name,
          score: startB,
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
    if (ASYNC_TOURNAMENT_PATCHES.has(patch.type)) {
      runTournamentPatch(patch);
      return;
    }
    applyPatch(patch);
    afterPatch();
    broadcastState();
  });
});

// Saved tournaments are loaded before the first client can connect, so nobody sees a blank
// bracket flash up and then get replaced.
initPersistence().finally(() => {
  server.listen(PORT, () => {
    console.log(`Match Score Manager running on http://localhost:${PORT}`);
    console.log(`  Control panel : http://localhost:${PORT}/control/`);
    console.log(`  OBS overlay   : http://localhost:${PORT}/overlay/`);
    console.log(`  Saving to     : ${store.mode}`);
  });
});

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
