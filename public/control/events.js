// Match Events + Squads cards. Loaded after control.js, so it shares its
// `socket`, `send()` and `latestState` globals.

const EVENT_LABELS = {
  goal: 'Goal',
  penaltyGoal: 'Penalty goal',
  ownGoal: 'Own goal',
  yellow: 'Yellow card',
  secondYellow: 'Second yellow',
  red: 'Red card',
  sub: 'Substitution',
};

const GOAL_EVENT_TYPES = ['goal', 'penaltyGoal', 'ownGoal'];
const evSelection = { type: null, team: 'teamA', offId: null };
let lastSquadKey = { teamA: '', teamB: '' };
let lastLogKey = '';

function teamLabel(state, team) {
  const name = state[team].name;
  return name || (team === 'teamA' ? 'Team 1' : 'Team 2');
}

function playerText(player) {
  if (!player) return '';
  return player.name ? `#${player.number} ${player.name}` : `#${player.number}`;
}

function eventIcon(type) {
  if (type === 'yellow') return '<span class="mini-card yellow"></span>';
  if (type === 'red') return '<span class="mini-card red"></span>';
  if (type === 'secondYellow') return '<span class="mini-card yellow"></span><span class="mini-card red stacked"></span>';
  if (type === 'sub') return '<span class="ev-sub-icon">⇄</span>';
  return '<span class="ev-goal-icon">G</span>';
}

function escHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- Event picker ----------

function renderPicker(state) {
  document.querySelectorAll('#ev-types button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === evSelection.type);
  });
  document.getElementById('ev-team-a').textContent = teamLabel(state, 'teamA');
  document.getElementById('ev-team-b').textContent = teamLabel(state, 'teamB');
  document.getElementById('ev-team-a').classList.toggle('active', evSelection.team === 'teamA');
  document.getElementById('ev-team-b').classList.toggle('active', evSelection.team === 'teamB');

  const squad = state[evSelection.team].squad || [];
  const playersEl = document.getElementById('ev-players');
  const label = document.getElementById('ev-player-label');
  const hint = document.getElementById('ev-hint');

  if (evSelection.type === 'sub') {
    label.textContent = evSelection.offId ? '3 · Player on' : '3 · Player off';
  } else {
    label.textContent = '3 · Player';
  }

  const key = JSON.stringify([squad, evSelection]);
  if (playersEl.dataset.key !== key) {
    playersEl.dataset.key = key;
    playersEl.innerHTML = '';
    if (GOAL_EVENT_TYPES.includes(evSelection.type)) {
      const none = document.createElement('button');
      none.className = 'ev-player ev-no-player';
      none.textContent = 'No player';
      none.title = 'Log the goal without a scorer: the pop-up shows just the team and the time';
      none.addEventListener('click', () => pickPlayer(null));
      playersEl.appendChild(none);
    }
    if (!squad.length) {
      const empty = document.createElement('span');
      empty.className = 'ev-empty';
      empty.textContent = 'No players yet. Add this team’s squad below.';
      playersEl.appendChild(empty);
    }
    squad.forEach((player) => {
      const btn = document.createElement('button');
      btn.className = 'ev-player';
      btn.disabled = !evSelection.type;
      if (player.id === evSelection.offId) btn.classList.add('off');
      btn.innerHTML = `<b>${player.number}</b><span>${escHtml(player.name || '')}</span>`;
      btn.addEventListener('click', () => pickPlayer(player));
      playersEl.appendChild(btn);
    });
  }

  if (!evSelection.type) {
    hint.textContent = 'Pick an event, then a team, then tap the player. It logs at the current clock minute and pops up on the overlay.';
  } else if (evSelection.type === 'ownGoal') {
    hint.textContent = 'Own goal: pick the team of the player who put it in their own net. The goal counts for the other side.';
  } else if (evSelection.type === 'sub') {
    hint.textContent = evSelection.offId ? 'Now tap the player coming on.' : 'Tap the player going off first.';
  } else if (GOAL_EVENT_TYPES.includes(evSelection.type)) {
    hint.textContent = `${EVENT_LABELS[evSelection.type]}: tap the player, or "No player" to pop up just the team and the time.`;
  } else {
    hint.textContent = `${EVENT_LABELS[evSelection.type]}: tap the player.`;
  }

  const minuteInput = document.getElementById('ev-minute');
  minuteInput.placeholder = `${Math.floor(state.timer.seconds / 60) + 1}' (auto)`;
}

function resetSelection() {
  evSelection.type = null;
  evSelection.offId = null;
  document.getElementById('ev-minute').value = '';
}

function pickPlayer(player) {
  if (!evSelection.type) return;
  const minute = document.getElementById('ev-minute').value.trim() || undefined;
  if (evSelection.type === 'sub') {
    if (!evSelection.offId) {
      evSelection.offId = player.id;
      renderPicker(latestState);
      return;
    }
    if (player.id === evSelection.offId) {
      evSelection.offId = null;
      renderPicker(latestState);
      return;
    }
    send({ type: 'eventAdd', eventType: 'sub', team: evSelection.team, playerId: evSelection.offId, playerOnId: player.id, minute });
  } else {
    send({ type: 'eventAdd', eventType: evSelection.type, team: evSelection.team, playerId: player ? player.id : null, minute });
  }
  resetSelection();
  renderPicker(latestState);
}

document.querySelectorAll('#ev-types button').forEach((btn) => {
  btn.addEventListener('click', () => {
    evSelection.type = evSelection.type === btn.dataset.type ? null : btn.dataset.type;
    evSelection.offId = null;
    renderPicker(latestState);
  });
});

document.querySelectorAll('.ev-teams button').forEach((btn) => {
  btn.addEventListener('click', () => {
    evSelection.team = btn.dataset.team;
    evSelection.offId = null;
    renderPicker(latestState);
  });
});

document.getElementById('events-list-toggle').addEventListener('click', () => {
  send({ type: 'eventsListToggle', value: !latestState.eventsListActive });
});

document.getElementById('popup-hide').addEventListener('click', () => send({ type: 'popupHide' }));

// ---------- Event log ----------

function renderLog(state) {
  const toggle = document.getElementById('events-list-toggle');
  toggle.textContent = state.eventsListActive ? 'On' : 'Off';
  toggle.classList.toggle('active', state.eventsListActive);
  document.getElementById('popup-hide').disabled = !state.popup;

  const key = JSON.stringify([state.events, state.teamA.name, state.teamB.name, state.popup && state.popup.eventId]);
  if (key === lastLogKey) return;
  lastLogKey = key;

  const log = document.getElementById('ev-log');
  log.innerHTML = '';
  if (!state.events.length) {
    log.innerHTML = '<li class="ev-empty">No events logged yet.</li>';
    return;
  }
  [...state.events].reverse().forEach((event) => {
    const li = document.createElement('li');
    li.className = 'ev-row';
    if (state.popup && state.popup.eventId === event.id) li.classList.add('on-air');
    const who =
      event.type === 'sub'
        ? `<span class="sub-off">▼ ${escHtml(playerText(event.player))}</span> <span class="sub-on">▲ ${escHtml(playerText(event.playerOn))}</span>`
        : (event.player ? escHtml(playerText(event.player)) : '<em class="ev-noplayer">no player</em>') +
          (event.type === 'ownGoal' ? ' <em>(OG)</em>' : '');
    li.innerHTML = `
      <span class="ev-min">${escHtml(event.minute)}</span>
      <span class="ev-icon">${eventIcon(event.type)}</span>
      <span class="ev-what"><span class="ev-type">${EVENT_LABELS[event.type]}</span>${who}</span>
      <span class="ev-team">${escHtml(teamLabel(state, event.team))}</span>
      <button class="ev-show">Show</button>
      <button class="ev-del ghost" title="Delete event">&times;</button>`;
    li.querySelector('.ev-show').addEventListener('click', () => send({ type: 'eventShow', id: event.id }));
    li.querySelector('.ev-del').addEventListener('click', () => {
      const isGoal = ['goal', 'penaltyGoal', 'ownGoal'].includes(event.type);
      const msg = isGoal ? 'Delete this goal? The score goes back down by one.' : 'Delete this event?';
      if (confirm(msg)) send({ type: 'eventRemove', id: event.id });
    });
    log.appendChild(li);
  });
}

// ---------- Squads ----------

function renderSquad(state, team) {
  const suffix = team === 'teamA' ? 'a' : 'b';
  document.getElementById(`squad-title-${suffix}`).textContent = teamLabel(state, team);
  const list = document.getElementById(`squad-list-${suffix}`);
  const squad = state[team].squad || [];
  const key = JSON.stringify(squad);
  // Don't rebuild while someone is typing in this list.
  if (key === lastSquadKey[team] || list.contains(document.activeElement)) return;
  lastSquadKey[team] = key;

  list.innerHTML = '';
  if (!squad.length) {
    list.innerHTML = '<span class="ev-empty">No players.</span>';
    return;
  }
  squad.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'squad-row';
    row.innerHTML = `
      <input type="number" min="0" max="99" class="squad-num" value="${player.number}" />
      <input type="text" maxlength="24" class="squad-name" value="${escHtml(player.name)}" placeholder="Name" />
      <button class="ghost" title="Remove player">&times;</button>`;
    row.querySelector('.squad-num').addEventListener('change', (e) =>
      send({ type: 'squadUpdate', team, id: player.id, number: e.target.value })
    );
    row.querySelector('.squad-name').addEventListener('change', (e) =>
      send({ type: 'squadUpdate', team, id: player.id, name: e.target.value })
    );
    row.querySelector('button').addEventListener('click', () => send({ type: 'squadRemove', team, id: player.id }));
    list.appendChild(row);
  });
}

document.querySelectorAll('.squad-add').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const [num, name] = form.querySelectorAll('input');
    const team = form.dataset.team;
    const number = Number(num.value);
    if ((latestState[team].squad || []).some((p) => p.number === number)) {
      num.setCustomValidity(`#${number} is already in this squad`);
      num.reportValidity();
      return;
    }
    send({ type: 'squadAdd', team, number: num.value, name: name.value });
    num.value = '';
    name.value = '';
    num.focus();
  });
  form.querySelector('input[type=number]').addEventListener('input', (e) => e.target.setCustomValidity(''));
});

document.querySelectorAll('.squad-paste-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const textarea = btn.parentElement.querySelector('textarea');
    if (!textarea.value.trim()) return;
    if (confirm('Replace this team’s whole squad with the pasted list?')) {
      send({ type: 'squadReplace', team: btn.dataset.team, text: textarea.value });
      textarea.value = '';
      btn.closest('details').open = false;
    }
  });
});

socket.on('state', (state) => {
  renderPicker(state);
  renderLog(state);
  renderSquad(state, 'teamA');
  renderSquad(state, 'teamB');
});
