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
  return `<div class="${classes.join(' ')}">${esc(team ? team.name : 'TBD')}</div>`;
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
}

socket.on('state', render);
