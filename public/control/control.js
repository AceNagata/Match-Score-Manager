const socket = io();

document.getElementById('overlay-url').textContent = `${location.origin}/overlay/`;

const STYLES = ['classic', 'banner', 'badges', 'flags', 'neon', 'champions'];

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

function resizeImageFile(file, maxSize = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

  document.getElementById('logo-a-label').textContent = state.teamA.logo ? 'Change logo' : 'Upload logo';
  document.getElementById('logo-b-label').textContent = state.teamB.logo ? 'Change logo' : 'Upload logo';
  document.getElementById('logo-a-clear').hidden = !state.teamA.logo;
  document.getElementById('logo-b-clear').hidden = !state.teamB.logo;

  document.getElementById('comp-logo-label').textContent = state.competitionLogo ? 'Change logo' : 'Upload logo';
  document.getElementById('comp-logo-clear').hidden = !state.competitionLogo;

  document.getElementById('timer-display').textContent = formatClock(state.timer.seconds);
  document.getElementById('extra-value').textContent = state.timer.extra;

  STYLES.forEach((style) => {
    document.getElementById(`style-${style}`).classList.toggle('active', state.style === style);
  });

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

async function handleLogoUpload(input, onResult) {
  const file = input.files[0];
  if (!file) return;
  const dataUrl = await resizeImageFile(file);
  onResult(dataUrl);
  input.value = '';
}

document.getElementById('logo-a').addEventListener('change', (e) =>
  handleLogoUpload(e.target, (value) => send({ type: 'setLogo', team: 'teamA', value }))
);
document.getElementById('logo-b').addEventListener('change', (e) =>
  handleLogoUpload(e.target, (value) => send({ type: 'setLogo', team: 'teamB', value }))
);
document.getElementById('comp-logo').addEventListener('change', (e) =>
  handleLogoUpload(e.target, (value) => send({ type: 'setCompetitionLogo', value }))
);

document.getElementById('logo-a-clear').addEventListener('click', () => send({ type: 'setLogo', team: 'teamA', value: null }));
document.getElementById('logo-b-clear').addEventListener('click', () => send({ type: 'setLogo', team: 'teamB', value: null }));
document.getElementById('comp-logo-clear').addEventListener('click', () => send({ type: 'setCompetitionLogo', value: null }));

document.getElementById('timer-start').addEventListener('click', () => send({ type: 'timerStart' }));
document.getElementById('timer-pause').addEventListener('click', () => send({ type: 'timerPause' }));
document.getElementById('timer-reset').addEventListener('click', () => send({ type: 'timerReset' }));
document.getElementById('timer-minus10').addEventListener('click', () => send({ type: 'timerAdjust', delta: -10 }));
document.getElementById('timer-plus10').addEventListener('click', () => send({ type: 'timerAdjust', delta: 10 }));

document.getElementById('extra-minus').addEventListener('click', () => send({ type: 'extraAdjust', delta: -1 }));
document.getElementById('extra-plus').addEventListener('click', () => send({ type: 'extraAdjust', delta: 1 }));

STYLES.forEach((style) => {
  document.getElementById(`style-${style}`).addEventListener('click', () => send({ type: 'setStyle', value: style }));
});

document.getElementById('penalties-toggle').addEventListener('click', () => {
  send({ type: 'penaltiesToggle', value: !latestState.penalties.active });
});

document.getElementById('reset-match').addEventListener('click', () => {
  if (confirm('Reset the entire match? This clears scores, timer, logos, and penalties.')) {
    send({ type: 'resetMatch' });
  }
});
