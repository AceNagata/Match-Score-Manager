const socket = io();

document.getElementById('overlay-url').textContent = `${location.origin}/overlay/`;

let latestState = null;
let nameTimers = {};

function send(patch) {
  socket.emit('control:update', patch);
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderPenaltySlots(container, team, slots) {
  container.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = team === 'teamA' ? 'Team 1' : 'Team 2';
  container.appendChild(label);

  slots.forEach((value, index) => {
    const btn = document.createElement('button');
    btn.className = 'pen-slot';
    if (value === true) {
      btn.classList.add('scored');
      btn.textContent = '✓';
    } else if (value === false) {
      btn.classList.add('missed');
      btn.textContent = '✕';
    } else {
      btn.textContent = index + 1;
    }
    btn.addEventListener('click', () => send({ type: 'penaltyMark', team, index }));
    container.appendChild(btn);
  });
}

function render(state) {
  latestState = state;

  if (document.activeElement !== document.getElementById('name-a')) {
    document.getElementById('name-a').value = state.teamA.name;
  }
  if (document.activeElement !== document.getElementById('name-b')) {
    document.getElementById('name-b').value = state.teamB.name;
  }
  document.getElementById('color-a').value = state.teamA.color;
  document.getElementById('color-b').value = state.teamB.color;
  document.getElementById('score-a').textContent = state.teamA.score;
  document.getElementById('score-b').textContent = state.teamB.score;

  document.getElementById('timer-display').textContent = formatClock(state.timer.seconds);

  document.getElementById('style-classic').classList.toggle('active', state.style === 'classic');
  document.getElementById('style-banner').classList.toggle('active', state.style === 'banner');

  const penToggle = document.getElementById('penalties-toggle');
  penToggle.textContent = state.penalties.active ? 'On' : 'Off';
  penToggle.classList.toggle('active', state.penalties.active);

  renderPenaltySlots(document.getElementById('pen-row-a'), 'teamA', state.penalties.teamA);
  renderPenaltySlots(document.getElementById('pen-row-b'), 'teamB', state.penalties.teamB);
}

socket.on('state', render);

document.querySelectorAll('.score-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    send({ type: 'incrementScore', team: btn.dataset.team, delta: Number(btn.dataset.delta) });
  });
});

function debounceName(team, value) {
  clearTimeout(nameTimers[team]);
  nameTimers[team] = setTimeout(() => send({ type: 'setName', team, value }), 200);
}

document.getElementById('name-a').addEventListener('input', (e) => debounceName('teamA', e.target.value));
document.getElementById('name-b').addEventListener('input', (e) => debounceName('teamB', e.target.value));

document.getElementById('color-a').addEventListener('input', (e) => send({ type: 'setColor', team: 'teamA', value: e.target.value }));
document.getElementById('color-b').addEventListener('input', (e) => send({ type: 'setColor', team: 'teamB', value: e.target.value }));

document.getElementById('timer-start').addEventListener('click', () => send({ type: 'timerStart' }));
document.getElementById('timer-pause').addEventListener('click', () => send({ type: 'timerPause' }));
document.getElementById('timer-reset').addEventListener('click', () => send({ type: 'timerReset' }));
document.getElementById('timer-minus10').addEventListener('click', () => send({ type: 'timerAdjust', delta: -10 }));
document.getElementById('timer-plus10').addEventListener('click', () => send({ type: 'timerAdjust', delta: 10 }));

document.getElementById('style-classic').addEventListener('click', () => send({ type: 'setStyle', value: 'classic' }));
document.getElementById('style-banner').addEventListener('click', () => send({ type: 'setStyle', value: 'banner' }));

document.getElementById('penalties-toggle').addEventListener('click', () => {
  send({ type: 'penaltiesToggle', value: !latestState.penalties.active });
});

document.getElementById('reset-match').addEventListener('click', () => {
  if (confirm('Reset the entire match? This clears scores, timer, and penalties.')) {
    send({ type: 'resetMatch' });
  }
});
