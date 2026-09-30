const socket = io();
const board = document.getElementById('board');

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sideHtml(match, side) {
  const team = side === 'A' ? match.teamA : match.teamB;
  const classes = ['match-side'];
  if (!team) classes.push('tbd');
  if (match.winner === side) classes.push('winner');
  const logo = team && team.logo ? `<img class="match-logo" src="${team.logo}" />` : '';
  return `<div class="${classes.join(' ')}">${logo}<span>${esc(team ? team.name : 'TBD')}</span></div>`;
}

function matchBoxHtml(match) {
  return `<div class="match-box">${sideHtml(match, 'A')}${sideHtml(match, 'B')}</div>`;
}

function columnHtml(label, matches) {
  const matchesHtml = matches.map(matchBoxHtml).join('');
  return `<div class="round-col"><h3>${label}</h3><div class="round-matches">${matchesHtml}</div></div>`;
}

function render(state) {
  const bracket = state.bracket;
  board.className = `bracket-board style-${state.style}`;
  const rounds = computeBracketRounds(bracket);
  const roundCount = rounds.length;
  const bracketRounds = rounds.slice(0, roundCount - 1);
  const finalMatch = rounds[roundCount - 1][0];

  const leftHtml = bracketRounds
    .map((matches, r) => columnHtml(bracketRoundLabel(roundCount, r), matches.slice(0, matches.length / 2)))
    .join('');

  const rightHtml = bracketRounds
    .map((matches, r) => columnHtml(bracketRoundLabel(roundCount, r), matches.slice(matches.length / 2)))
    .reverse()
    .join('');

  const champion = bracketChampion(rounds);
  const championHtml = champion
    ? `<div class="champion-box"><div class="label">CHAMPION</div><div class="name">${esc(champion.name)}</div></div>`
    : '';

  const centerHtml = `
    <div class="center-col">
      <h3>${bracketRoundLabel(roundCount, roundCount - 1)}</h3>
      <div class="match-box final-box">${sideHtml(finalMatch, 'A')}${sideHtml(finalMatch, 'B')}</div>
      ${championHtml}
    </div>
  `;

  board.innerHTML = `
    <div class="bracket-half">${leftHtml}</div>
    ${centerHtml}
    <div class="bracket-half">${rightHtml}</div>
  `;

  fitAndCenter();
}

function fitAndCenter() {
  if (!board.innerHTML.trim()) return;

  board.style.transform = 'none';
  board.style.left = '0px';
  board.style.top = '0px';

  const naturalWidth = board.offsetWidth;
  const naturalHeight = board.offsetHeight;
  if (!naturalWidth || !naturalHeight) return;

  const margin = 0.94;
  const scale = Math.min(
    (window.innerWidth * margin) / naturalWidth,
    (window.innerHeight * margin) / naturalHeight
  );

  const left = (window.innerWidth - naturalWidth * scale) / 2;
  const top = (window.innerHeight - naturalHeight * scale) / 2;

  board.style.transformOrigin = 'top left';
  board.style.left = `${left}px`;
  board.style.top = `${top}px`;
  board.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitAndCenter);

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(fitAndCenter);
}

socket.on('state', render);
