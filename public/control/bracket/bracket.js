const socket = io();

document.getElementById('overlay-url').textContent = `${location.origin}/overlay/bracket/`;

const SIZES = [4, 8, 16];

let latestBracket = null;
let latestRoster = [];
let latestLive = null;

function getToken() {
  return localStorage.getItem('controlToken') || '';
}

function renderTokenStatus() {
  const status = document.getElementById('token-status');
  if (getToken()) {
    status.textContent = 'Saved on this device';
    status.className = 'token-status ok';
  } else {
    status.textContent = 'No token set — updates will be rejected if the server requires one';
    status.className = 'token-status missing';
  }
}

document.getElementById('access-token').value = getToken();
renderTokenStatus();

document.getElementById('token-save').addEventListener('click', () => {
  const value = document.getElementById('access-token').value.trim();
  localStorage.setItem('controlToken', value);
  renderTokenStatus();
});

function send(patch) {
  socket.emit('control:update', { ...patch, token: getToken() });
}

let pendingTimers = {};
let suppressRenderUntil = 0;

function debounceSend(key, delay, patch) {
  suppressRenderUntil = Date.now() + delay + 400;
  clearTimeout(pendingTimers[key]);
  pendingTimers[key] = setTimeout(() => send(patch), delay);
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function uploadLogoTo(input, onDataUrl) {
  const file = input.files[0];
  if (!file) return;
  const dataUrl = await resizeImageFile(file);
  onDataUrl(dataUrl);
  input.value = '';
}

/* ---------------- Team roster ---------------- */

function renderRoster(roster) {
  const container = document.getElementById('roster-list');
  container.innerHTML = '';
  roster.forEach((team) => container.appendChild(renderRosterCard(team)));
}

function renderRosterCard(team) {
  const card = document.createElement('div');
  card.className = 'roster-card';

  const logoLabel = document.createElement('label');
  logoLabel.className = 'roster-logo-btn';
  logoLabel.title = 'Upload flag/logo';
  if (team.logo) {
    const img = document.createElement('img');
    img.src = team.logo;
    img.className = 'roster-logo-preview';
    logoLabel.appendChild(img);
  } else {
    logoLabel.textContent = '➕';
  }
  const logoInput = document.createElement('input');
  logoInput.type = 'file';
  logoInput.accept = 'image/*';
  logoInput.hidden = true;
  logoInput.addEventListener('change', (e) =>
    uploadLogoTo(e.target, (value) => send({ type: 'rosterSetLogo', id: team.id, value }))
  );
  logoLabel.appendChild(logoInput);
  card.appendChild(logoLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.value = team.name;
  nameInput.placeholder = 'Team name';
  nameInput.dataset.focusKey = `roster-name-${team.id}`;
  nameInput.addEventListener('input', (e) => {
    debounceSend(`roster-name-${team.id}`, 200, { type: 'rosterSetName', id: team.id, value: e.target.value });
  });
  card.appendChild(nameInput);

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'bracket-color-input';
  colorInput.value = team.color || '#64748b';
  colorInput.title = 'Primary color';
  colorInput.dataset.focusKey = `roster-color-${team.id}`;
  colorInput.addEventListener('input', (e) => {
    debounceSend(`roster-color-${team.id}`, 100, { type: 'rosterSetColor', id: team.id, value: e.target.value });
  });
  card.appendChild(colorInput);

  const color2Input = document.createElement('input');
  color2Input.type = 'color';
  color2Input.className = 'bracket-color-input';
  color2Input.value = team.secondaryColor || '#ffffff';
  color2Input.title = 'Secondary color';
  color2Input.dataset.focusKey = `roster-color2-${team.id}`;
  color2Input.addEventListener('input', (e) => {
    debounceSend(`roster-color2-${team.id}`, 100, { type: 'rosterSetSecondaryColor', id: team.id, value: e.target.value });
  });
  card.appendChild(color2Input);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'roster-delete-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Remove team';
  deleteBtn.addEventListener('click', () => {
    if (confirm(`Remove "${team.name}" from the roster? This also clears it from any bracket slot using it.`)) {
      send({ type: 'rosterRemoveTeam', id: team.id });
    }
  });
  card.appendChild(deleteBtn);

  return card;
}

document.getElementById('roster-add').addEventListener('click', () => {
  send({
    type: 'rosterAddTeam',
    name: `TEAM ${latestRoster.length + 1}`,
    color: '#64748b',
    secondaryColor: '#ffffff',
  });
});

/* ---------------- Bracket ---------------- */

function buildColumn(label, matchesWithIndex, round) {
  const col = document.createElement('div');
  col.className = 'bracket-round';

  const heading = document.createElement('h3');
  heading.textContent = label;
  col.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'bracket-round-matches';
  matchesWithIndex.forEach(({ match, index }) => list.appendChild(renderMatch(match, round, index)));
  col.appendChild(list);

  return col;
}

function renderBracket(bracket) {
  latestBracket = bracket;

  SIZES.forEach((size) => {
    document.getElementById(`size-${size}`).classList.toggle('active', bracket.size === size);
  });

  const rounds = computeBracketRounds(bracket);
  const roundCount = rounds.length;
  const bracketRounds = rounds.slice(0, roundCount - 1);
  const finalMatches = rounds[roundCount - 1];

  const leftContainer = document.getElementById('bracket-left');
  const rightContainer = document.getElementById('bracket-right');
  const centerContainer = document.getElementById('bracket-center');
  leftContainer.innerHTML = '';
  rightContainer.innerHTML = '';
  centerContainer.innerHTML = '';

  bracketRounds.forEach((matches, r) => {
    const half = matches.length / 2;
    const leftMatches = matches.slice(0, half).map((match, i) => ({ match, index: i }));
    leftContainer.appendChild(buildColumn(bracketRoundLabel(roundCount, r), leftMatches, r));
  });

  for (let r = bracketRounds.length - 1; r >= 0; r -= 1) {
    const matches = bracketRounds[r];
    const half = matches.length / 2;
    const rightMatches = matches.slice(half).map((match, i) => ({ match, index: half + i }));
    rightContainer.appendChild(buildColumn(bracketRoundLabel(roundCount, r), rightMatches, r));
  }

  const finalHeading = document.createElement('h3');
  finalHeading.textContent = bracketRoundLabel(roundCount, roundCount - 1);
  centerContainer.appendChild(finalHeading);
  const finalList = document.createElement('div');
  finalList.className = 'bracket-round-matches';
  finalMatches.forEach((match, m) => finalList.appendChild(renderMatch(match, roundCount - 1, m)));
  centerContainer.appendChild(finalList);

  const championBanner = document.getElementById('champion-banner');
  const champion = bracketChampion(rounds);
  if (champion) {
    championBanner.hidden = false;
    championBanner.textContent = `🏆 CHAMPION: ${champion.name}`;
  } else {
    championBanner.hidden = true;
  }
}

function renderMatch(match, round, matchIndex) {
  const box = document.createElement('div');
  box.className = 'bracket-match';

  if (latestLive && latestLive.round === round && latestLive.match === matchIndex) {
    const badge = document.createElement('div');
    badge.className = 'bracket-live-badge';
    badge.textContent = '● Live on the scoreboard';
    box.appendChild(badge);
  }

  box.appendChild(renderSide(match, round, matchIndex, 'A'));
  box.appendChild(renderSide(match, round, matchIndex, 'B'));

  const startBtn = document.createElement('button');
  startBtn.className = 'bracket-start-btn';
  startBtn.textContent = '▶ Start This Match';
  const ready = Boolean(match.teamA && match.teamB);
  startBtn.disabled = !ready;
  startBtn.title = ready
    ? `Load ${match.teamA.name} vs ${match.teamB.name} into the match scoreboard`
    : 'Both teams need to be known first';
  startBtn.addEventListener('click', () => {
    send({ type: 'startMatchFromBracket', round, match: matchIndex });
  });
  box.appendChild(startBtn);

  return box;
}

function renderSide(match, round, matchIndex, side) {
  const team = side === 'A' ? match.teamA : match.teamB;
  const row = document.createElement('div');
  row.className = 'bracket-side';
  if (match.winner === side) row.classList.add('winner');

  if (team && team.logo) {
    const img = document.createElement('img');
    img.src = team.logo;
    img.className = 'bracket-side-logo';
    row.appendChild(img);
  }

  if (round === 0) {
    const index = matchIndex * 2 + (side === 'A' ? 0 : 1);

    const select = document.createElement('select');
    select.className = 'bracket-team-select';
    select.dataset.focusKey = `bracket-select-${index}`;

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— Select team —';
    select.appendChild(noneOpt);

    const usedElsewhere = new Set(
      latestBracket.teams
        .map((slot, i) => (i !== index && slot.rosterId ? slot.rosterId : null))
        .filter(Boolean)
    );

    latestRoster.forEach((rosterTeam) => {
      if (usedElsewhere.has(rosterTeam.id)) return;
      const opt = document.createElement('option');
      opt.value = rosterTeam.id;
      opt.textContent = rosterTeam.name;
      if (team && team.rosterId === rosterTeam.id) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
      send({ type: 'bracketAssignTeam', index, teamId: e.target.value || null });
    });

    row.appendChild(select);
  } else {
    const label = document.createElement('span');
    label.className = 'bracket-name-label' + (team ? '' : ' tbd');
    label.textContent = team ? team.name : 'TBD';
    row.appendChild(label);
  }

  if (match.teamA && match.teamB) {
    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.min = '0';
    scoreInput.max = '99';
    scoreInput.step = '1';
    scoreInput.className = 'bracket-score-input';
    scoreInput.placeholder = '-';
    const score = side === 'A' ? match.scoreA : match.scoreB;
    scoreInput.value = score === null ? '' : String(score);
    scoreInput.title = `${team.name} goals`;
    scoreInput.setAttribute('aria-label', `${team.name} goals`);
    scoreInput.dataset.focusKey = `bracket-score-${round}-${matchIndex}-${side}`;
    scoreInput.addEventListener('input', (e) => {
      const raw = e.target.value.trim();
      const n = Number(raw);
      if (raw !== '' && !Number.isFinite(n)) return;
      const value = raw === '' ? null : Math.max(0, Math.min(99, Math.trunc(n)));
      debounceSend(`score-${round}-${matchIndex}-${side}`, 250, {
        type: 'bracketSetScore',
        round,
        match: matchIndex,
        side,
        value,
      });
    });
    row.appendChild(scoreInput);
  }

  const pickBtn = document.createElement('button');
  pickBtn.className = 'bracket-pick-btn';
  pickBtn.textContent = '✓';
  pickBtn.disabled = !team;
  pickBtn.title = team ? `Advance ${team.name}` : 'Waiting for a team';
  pickBtn.addEventListener('click', () => {
    const nextSide = match.winner === side ? null : side;
    send({ type: 'bracketPickWinner', round, match: matchIndex, side: nextSide });
  });
  row.appendChild(pickBtn);

  return row;
}

let lastRosterJSON = null;
let lastBracketJSON = null;

function withFocusPreserved(renderFn) {
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.focusKey : null;
  const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

  renderFn();

  if (!focusKey) return;
  const next = document.querySelector(`[data-focus-key="${focusKey}"]`);
  if (!next) return;
  next.focus();
  if (selStart !== null && typeof next.setSelectionRange === 'function') {
    try {
      next.setSelectionRange(selStart, selEnd);
    } catch (e) {
      // Some input types (e.g. color) don't support text selection.
    }
  }
}

/* ---------------- Tournament (saving) ---------------- */

const tournamentNameInput = document.getElementById('tournament-name');
const persistStatusEl = document.getElementById('persist-status');
const tournamentSelect = document.getElementById('tournament-select');
const tournamentOpenBtn = document.getElementById('tournament-open');
const tournamentDeleteBtn = document.getElementById('tournament-delete');
const tournamentNewBtn = document.getElementById('tournament-new');

let lastTournamentListKey = null;
let latestPersist = { mode: 'file', status: 'idle' };

function persistLabel(persist) {
  const where = persist.mode === 'firestore' ? 'the database' : 'a file on this computer';
  if (persist.mode === 'memory') {
    return {
      text: 'Not saving (storage is off)',
      cls: 'error',
      title: 'This server is running without storage, so nothing is kept after a restart.',
    };
  }
  switch (persist.status) {
    case 'saving':
      return { text: 'Saving…', cls: '', title: `Saving to ${where}` };
    case 'saved': {
      const time = persist.savedAt
        ? new Date(persist.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
      return { text: `✓ Saved ${time}`.trim(), cls: 'ok', title: `Stored in ${where}` };
    }
    case 'error':
      return {
        text: `⚠ Not saved — ${persist.error || 'error'}`,
        cls: 'error',
        title: 'Your changes are kept in memory and the save is retried automatically.',
      };
    default:
      return { text: 'Nothing to save yet', cls: '', title: `Changes are saved to ${where}` };
  }
}

function updateTournamentButtons() {
  const blocked = latestPersist.mode === 'memory';
  const failing = latestPersist.status === 'error';
  tournamentNewBtn.disabled = blocked || failing;
  tournamentOpenBtn.disabled = blocked || failing || !tournamentSelect.value;
  tournamentDeleteBtn.disabled = blocked || !tournamentSelect.value;
  const why = failing ? "Fix the saving problem first so your current work isn't lost." : '';
  tournamentNewBtn.title = why;
  tournamentOpenBtn.title = why;
}

function renderTournament(state) {
  const tournament = state.tournament || { id: '', name: '' };
  latestPersist = state.persist || latestPersist;

  if (document.activeElement !== tournamentNameInput) tournamentNameInput.value = tournament.name;

  const label = persistLabel(latestPersist);
  persistStatusEl.textContent = label.text;
  persistStatusEl.className = `persist-status ${label.cls}`.trim();
  persistStatusEl.title = label.title;

  // Rebuilt only when the list actually changes: this runs on every broadcast (including the
  // match clock's once-a-second tick) and rebuilding would close an open dropdown.
  const saved = (state.tournaments || []).filter((t) => t.id !== tournament.id);
  const key = JSON.stringify(saved);
  if (key !== lastTournamentListKey) {
    lastTournamentListKey = key;
    const previous = tournamentSelect.value;
    tournamentSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = saved.length ? 'Open a saved tournament…' : 'No other saved tournaments';
    tournamentSelect.appendChild(placeholder);
    saved.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      tournamentSelect.appendChild(opt);
    });
    if (saved.some((t) => t.id === previous)) tournamentSelect.value = previous;
  }
  updateTournamentButtons();
}

tournamentNameInput.addEventListener('input', (e) => {
  debounceSend('tournament-name', 400, { type: 'tournamentRename', value: e.target.value });
});
tournamentSelect.addEventListener('change', updateTournamentButtons);
tournamentOpenBtn.addEventListener('click', () => {
  if (tournamentSelect.value) send({ type: 'tournamentOpen', id: tournamentSelect.value });
});
tournamentNewBtn.addEventListener('click', () => send({ type: 'tournamentNew', name: '' }));
tournamentDeleteBtn.addEventListener('click', () => {
  const option = tournamentSelect.selectedOptions[0];
  if (!option || !option.value) return;
  if (confirm(`Delete "${option.textContent}" permanently? Its roster, bracket and scores can't be recovered.`)) {
    send({ type: 'tournamentDelete', id: option.value });
  }
});

socket.on('state', (state) => {
  latestBracket = state.bracket;
  latestRoster = state.teamRoster || [];
  latestLive = state.liveMatch || null;
  document.getElementById('connector-color').value = state.connectorColor || '#ffffff';
  renderTournament(state);
  if (Date.now() < suppressRenderUntil) return;

  const rosterJSON = JSON.stringify(latestRoster);
  const rosterChanged = rosterJSON !== lastRosterJSON;
  if (rosterChanged) {
    lastRosterJSON = rosterJSON;
    withFocusPreserved(() => renderRoster(latestRoster));
  }

  // The live-match badge isn't part of the bracket data, so it's tracked alongside it.
  const bracketJSON = JSON.stringify([latestBracket, latestLive]);
  const bracketChanged = bracketJSON !== lastBracketJSON;
  // The round-0 dropdowns' option list/labels come from the roster, not the
  // bracket, so a roster-only change (e.g. renaming a team) still needs to
  // refresh the bracket to keep those labels in sync.
  if (rosterChanged || bracketChanged) {
    lastBracketJSON = bracketJSON;
    withFocusPreserved(() => renderBracket(latestBracket));
  }
});

document.getElementById('connector-color').addEventListener('input', (e) =>
  send({ type: 'setConnectorColor', value: e.target.value })
);

SIZES.forEach((size) => {
  document.getElementById(`size-${size}`).addEventListener('click', () => {
    if (confirm(`Switch to a ${size}-team bracket? This clears the current bracket.`)) {
      send({ type: 'bracketSetSize', value: size });
    }
  });
});

document.getElementById('reset-bracket').addEventListener('click', () => {
  if (confirm('Reset the bracket? This clears all slot assignments and picks (the roster is kept).')) {
    send({ type: 'bracketReset' });
  }
});
