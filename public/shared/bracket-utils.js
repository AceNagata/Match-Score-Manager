function computeBracketRounds(bracket) {
  const roundCount = Math.log2(bracket.size);
  const rounds = [];
  let currentTeams = bracket.teams.slice(0, bracket.size);

  for (let r = 0; r < roundCount; r += 1) {
    const matches = [];
    for (let m = 0; m < currentTeams.length / 2; m += 1) {
      const teamA = currentTeams[2 * m] || null;
      const teamB = currentTeams[2 * m + 1] || null;
      const pick = (bracket.picks[r] && bracket.picks[r][m]) || null;
      matches.push({ teamA, teamB, winner: pick });
    }
    rounds.push(matches);
    currentTeams = matches.map((match) => {
      if (match.winner === 'A') return match.teamA;
      if (match.winner === 'B') return match.teamB;
      return null;
    });
  }

  return rounds;
}

function bracketRoundLabel(totalRounds, roundIndex) {
  const remaining = totalRounds - roundIndex;
  if (remaining === 1) return 'FINAL';
  if (remaining === 2) return 'SEMIFINALS';
  if (remaining === 3) return 'QUARTERFINALS';
  return `ROUND OF ${2 ** remaining}`;
}

function bracketChampion(rounds) {
  const finalMatch = rounds[rounds.length - 1][0];
  if (finalMatch.winner === 'A') return finalMatch.teamA;
  if (finalMatch.winner === 'B') return finalMatch.teamB;
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeBracketRounds, bracketRoundLabel, bracketChampion };
}
