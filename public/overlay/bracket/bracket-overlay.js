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

const SVG_NS = 'http://www.w3.org/2000/svg';

function matchesOf(col) {
  return Array.from(col.querySelectorAll(':scope > .round-matches > .match-box'));
}

function drawConnectors(boardRect) {
  const old = board.querySelector('.connector-svg');
  if (old) old.remove();

  const leftHalf = board.children[0];
  const centerCol = board.children[1];
  const rightHalf = board.children[2];
  if (!leftHalf || !centerCol || !rightHalf) return;

  const leftCols = Array.from(leftHalf.querySelectorAll(':scope > .round-col'));
  const rightCols = Array.from(rightHalf.querySelectorAll(':scope > .round-col'));
  const finalBox = centerCol.querySelector('.match-box.final-box');
  if (!leftCols.length || !rightCols.length || !finalBox) return;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'connector-svg');
  svg.setAttribute('width', boardRect.width);
  svg.setAttribute('height', boardRect.height);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.pointerEvents = 'none';
  svg.style.overflow = 'visible';

  function localRect(el) {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - boardRect.left,
      right: r.right - boardRect.left,
      centerY: r.top - boardRect.top + r.height / 2,
    };
  }

  function addLine(x1, y1, x2, y2) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'connector-line');
    svg.appendChild(line);
  }

  function connectMerge(sourceAEl, sourceBEl, targetEl) {
    const a = localRect(sourceAEl);
    const b = localRect(sourceBEl);
    const t = localRect(targetEl);
    const sourceLeftOfTarget = a.left < t.left;
    const sourceEdgeX = sourceLeftOfTarget ? a.right : a.left;
    const targetEdgeX = sourceLeftOfTarget ? t.left : t.right;
    const midX = (sourceEdgeX + targetEdgeX) / 2;
    addLine(sourceEdgeX, a.centerY, midX, a.centerY);
    addLine(sourceEdgeX, b.centerY, midX, b.centerY);
    addLine(midX, a.centerY, midX, b.centerY);
    addLine(midX, t.centerY, targetEdgeX, t.centerY);
  }

  function connectSimple(sourceEl, targetEl) {
    const s = localRect(sourceEl);
    const t = localRect(targetEl);
    const sourceLeftOfTarget = s.left < t.left;
    const sourceEdgeX = sourceLeftOfTarget ? s.right : s.left;
    const targetEdgeX = sourceLeftOfTarget ? t.left : t.right;
    addLine(sourceEdgeX, s.centerY, targetEdgeX, s.centerY);
  }

  for (let i = 0; i < leftCols.length - 1; i += 1) {
    const sources = matchesOf(leftCols[i]);
    const targets = matchesOf(leftCols[i + 1]);
    targets.forEach((target, m) => connectMerge(sources[2 * m], sources[2 * m + 1], target));
  }

  for (let i = rightCols.length - 1; i > 0; i -= 1) {
    const sources = matchesOf(rightCols[i]);
    const targets = matchesOf(rightCols[i - 1]);
    targets.forEach((target, m) => connectMerge(sources[2 * m], sources[2 * m + 1], target));
  }

  matchesOf(leftCols[leftCols.length - 1]).forEach((m) => connectSimple(m, finalBox));
  matchesOf(rightCols[0]).forEach((m) => connectSimple(m, finalBox));

  board.appendChild(svg);
}

function fitAndCenter() {
  if (!board.innerHTML.trim()) return;

  board.style.transform = 'none';
  board.style.left = '0px';
  board.style.top = '0px';

  const naturalWidth = board.offsetWidth;
  const naturalHeight = board.offsetHeight;
  if (!naturalWidth || !naturalHeight) return;

  drawConnectors(board.getBoundingClientRect());

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

// Safety net: fitAndCenter() is cheap and idempotent, so re-running it on an
// interval guarantees the board stays correctly fit/centered even if some
// async layout shift (e.g. the Oswald web font swapping in after first
// paint) happens at a moment none of the one-shot hooks (render, resize,
// fonts.ready) happen to catch.
setInterval(fitAndCenter, 1000);

socket.on('state', render);
