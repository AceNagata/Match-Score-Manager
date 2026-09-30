const socket = io();

document.getElementById('overlay-url').textContent = `${location.origin}/overlay/bracket/`;

const SIZES = [4, 8, 16];

let latestBracket = null;

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

async function handleLogoUpload(input, index) {
  const file = input.files[0];
  if (!file) return;
  const dataUrl = await resizeImageFile(file);
  send({ type: 'bracketSetTeamLogo', index, value: dataUrl });
  input.value = '';
}

function renderBracket(bracket) {
  latestBracket = bracket;

  SIZES.forEach((size) => {
    document.getElementById(`size-${size}`).classList.toggle('active', bracket.size === size);
  });

  const rounds = computeBracketRounds(bracket);
  const roundCount = rounds.length;
  const container = document.getElementById('bracket-rounds');
  container.innerHTML = '';

  rounds.forEach((matches, r) => {
    const col = document.createElement('div');
    col.className = 'bracket-round';

    const heading = document.createElement('h3');
    heading.textContent = bracketRoundLabel(roundCount, r);
    col.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'bracket-round-matches';

    matches.forEach((match, m) => {
      list.appendChild(renderMatch(match, r, m));
    });

    col.appendChild(list);
    container.appendChild(col);
  });

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

  if (round === 0) {
    const index = matchIndex * 2 + (side === 'A' ? 0 : 1);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 24;
    input.value = team ? team.name : '';
    input.placeholder = `Team ${index + 1}`;
    input.addEventListener('input', (e) => {
      debounceSend(`name-${index}`, 200, { type: 'bracketSetTeamName', index, value: e.target.value });
    });
    row.appendChild(input);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'bracket-color-input';
    colorInput.value = (team && team.color) || '#64748b';
    colorInput.title = 'Team color';
    colorInput.addEventListener('input', (e) => {
      debounceSend(`color-${index}`, 100, { type: 'bracketSetTeamColor', index, value: e.target.value });
    });
    row.appendChild(colorInput);

    const logoLabel = document.createElement('label');
    logoLabel.className = 'bracket-logo-btn';
    logoLabel.title = 'Upload logo';
    logoLabel.textContent = team && team.logo ? '🖼' : '➕';
    const logoInput = document.createElement('input');
    logoInput.type = 'file';
    logoInput.accept = 'image/*';
    logoInput.hidden = true;
    logoInput.addEventListener('change', (e) => handleLogoUpload(e.target, index));
    logoLabel.appendChild(logoInput);
    row.appendChild(logoLabel);
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
  if (Date.now() < suppressRenderUntil) return;
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
  if (confirm('Reset the bracket? This clears all team names and picks.')) {
    send({ type: 'bracketReset' });
  }
});
