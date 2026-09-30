const socket = io();

document.getElementById('overlay-url').textContent = `${location.origin}/overlay/bracket/`;

const SIZES = [4, 8, 16];

let latestBracket = null;
let latestRoster = [];

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
  nameInput.addEventListener('input', (e) => {
    debounceSend(`roster-name-${team.id}`, 200, { type: 'rosterSetName', id: team.id, value: e.target.value });
  });
  card.appendChild(nameInput);

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'bracket-color-input';
  colorInput.value = team.color || '#64748b';
  colorInput.title = 'Primary color';
  colorInput.addEventListener('input', (e) => {
    debounceSend(`roster-color-${team.id}`, 100, { type: 'rosterSetColor', id: team.id, value: e.target.value });
  });
  card.appendChild(colorInput);

  const color2Input = document.createElement('input');
  color2Input.type = 'color';
  color2Input.className = 'bracket-color-input';
  color2Input.value = team.secondaryColor || '#ffffff';
  color2Input.title = 'Secondary color';
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

socket.on('state', (state) => {
  latestBracket = state.bracket;
  latestRoster = state.teamRoster || [];
  if (Date.now() < suppressRenderUntil) return;
  renderRoster(latestRoster);
  renderBracket(state.bracket);
});

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
