const socket = io();

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderPenaltyRow(container, teamLabel, slots) {
  container.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'team-label';
  label.textContent = teamLabel;
  container.appendChild(label);

  let made = 0;
  slots.forEach((value) => {
    const dot = document.createElement('span');
    dot.className = 'pen-dot';
    if (value === true) {
      dot.classList.add('scored');
      dot.textContent = '✓';
      made += 1;
    } else if (value === false) {
      dot.classList.add('missed');
      dot.textContent = '✕';
    } else {
      dot.textContent = '';
    }
    container.appendChild(dot);
  });

  const total = document.createElement('span');
  total.className = 'pen-total';
  total.textContent = String(made);
  container.appendChild(total);
}

function render(state) {
  const clockText = formatClock(state.timer.seconds);

  document.getElementById('board-classic').classList.toggle('visible', state.style === 'classic');
  document.getElementById('board-banner').classList.toggle('visible', state.style === 'banner');

  document.getElementById('classic-clock').textContent = clockText;
  document.getElementById('classic-name-a').textContent = state.teamA.name;
  document.getElementById('classic-name-b').textContent = state.teamB.name;
  document.getElementById('classic-score-a').textContent = state.teamA.score;
  document.getElementById('classic-score-b').textContent = state.teamB.score;
  document.getElementById('classic-penalties').style.display = state.penalties.active ? 'block' : 'none';
  renderPenaltyRow(document.getElementById('classic-pen-a'), state.teamA.name, state.penalties.teamA);
  renderPenaltyRow(document.getElementById('classic-pen-b'), state.teamB.name, state.penalties.teamB);

  document.getElementById('banner-clock').textContent = clockText;
  document.getElementById('banner-name-a').textContent = state.teamA.name;
  document.getElementById('banner-name-b').textContent = state.teamB.name;
  document.getElementById('banner-score-a').textContent = state.teamA.score;
  document.getElementById('banner-score-b').textContent = state.teamB.score;
  document.getElementById('banner-name-a').style.background = state.teamA.color;
  document.getElementById('banner-name-b').style.background = state.teamB.color;
  document.getElementById('banner-penalties').style.display = state.penalties.active ? 'block' : 'none';
  renderPenaltyRow(document.getElementById('banner-pen-a'), state.teamA.name, state.penalties.teamA);
  renderPenaltyRow(document.getElementById('banner-pen-b'), state.teamB.name, state.penalties.teamB);
}

socket.on('state', render);
