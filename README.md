# Match Score Manager

A live football (soccer) match score, clock, and penalty-shootout manager with
a broadcast-ready overlay for OBS.

Two pages are served:

- **Control panel** (`/control/`) — edit team names/colors/logos, adjust the
  score, run the match clock (with an extra-time indicator), track a penalty
  shootout, upload a competition logo, and switch between six overlay styles.
- **Overlay** (`/overlay/`) — a transparent-background page you add as a
  Browser Source in OBS. It updates live over WebSockets whenever something
  changes in the control panel, so it can run on the same machine or a
  separate one on the same network.
- **Overlay scenes** (`/overlay/clock/`, `/overlay/penalty/`) — the same
  overlay split into just the clock/score/names, or just the penalty panel,
  as separate Browser Sources. Useful if you want to position or scene-switch
  them independently in OBS instead of moving the combined `/overlay/` as one
  block. All three (plus any future scene) render from the same live state,
  so they're always in sync with each other and with the control panel.
- **Bracket Maker** (`/control/bracket/`) — build a 4/8/16-team single-
  elimination bracket. A **Team Roster** section at the top is where you
  create teams once — name, primary/secondary color, flag/logo — and each
  bracket slot is a dropdown you assign a roster team to, instead of typing
  a name into every slot. A team already placed in the bracket is excluded
  from every other slot's dropdown, so you can't accidentally put the same
  team in twice. Advance winners round by round and see the champion crowned.
  A "▶ Start This Match" button on any matchup (once both sides are known)
  loads that pairing's name/colors/logo straight into the main match
  scoreboard — score, clock, and penalties all reset for the new match — so
  you don't have to retype anything when a tournament match kicks off.
- **Bracket overlay** (`/overlay/bracket/`) — the tournament bracket as a
  Browser Source: earlier rounds fan out left and right, converging on the
  final in the center with the champion showcased beneath it once decided.
  Each team's flag/logo (if it has one) is shown before its name. Colors
  follow whichever of the six overlay styles is currently selected, same as
  the clock/penalty scenes.

## Overlay styles

Six styles ship out of the box, modeled on the reference designs in
`References/`:

| Style | Look |
| --- | --- |
| `classic` | White clock box + black score strip, white penalty card |
| `banner` | Angled team-color banners around a white score block |
| `badges` | Navy bar with team logos beside each name |
| `flags` | Dark card with colored team blocks and a "VS" divider |
| `neon` | Neon-green accent with a hexagon score separator |
| `champions` | Navy bar, orange/green bracket separators, competition logo |

Team logos and the competition logo are optional — upload an image per team
(or a competition badge) from the control panel and it appears on every style
that shows one (`badges`, `flags`, `champions`); styles that don't use logos
simply ignore them. Uploaded images are resized client-side before they're
sent over the socket, so there's no meaningful payload-size concern.

Each team also has a **primary and secondary color**. In `classic`/`badges`/
`neon`/`champions` (styles that don't already use the team color as a
background), both colors show as a small diagonal two-tone chip next to the
team's name. In `banner`/`flags` (styles where the team color already fills
a block), the secondary color shows as a stripe along the bottom of that
block instead, so it reads as a two-tone flag rather than a redundant swatch.
Bracket entrants (`/control/bracket/`) have the same primary/secondary
fields, and both carry over automatically when you "Start This Match" from
a bracket matchup.

### Extra time

When extra time is set (`Extra time` +/- in the control panel), a full-width
bar drops down beneath the *entire* scoreboard row (not just the clock),
with the `+N` centered in it — like a drawer opening under the whole bug.
It's one shared `.extra-badge` CSS rule (`position: absolute; top: 100%;
left: 0; right: 0`) anchored to whichever row-level container is
`position: relative`: `.row` for `classic`/`badges`/`neon`/`champions`,
`.banner-wrap` for `banner`, `.flags-wrap` for `flags`. `banner` and `flags`
needed a wrapper element because their own row has a `filter`/`overflow`
that would otherwise clip anything positioned outside it — the badge lives
one level up, alongside the row, instead of inside it.

## Setup

```bash
npm install
npm start
```

Then open:

- Control panel: `http://localhost:4000/control/`
- Overlay: `http://localhost:4000/overlay/`

## Live deployment

The app is hosted on Firebase/Google Cloud:

- **Hosting URL** (use this day-to-day): https://match-score-manager.web.app
- **Control panel**: https://match-score-manager.web.app/control/
- **Overlay**: https://match-score-manager.web.app/overlay/
- **Direct Cloud Run URL** (same app, no Hosting proxy in front — use this if
  you want a true WebSocket connection instead of Socket.IO's long-polling
  fallback): https://match-score-manager-979888735377.us-central1.run.app

Firebase Hosting can only serve static files on its own — it can't run a
persistent Node/Socket.IO process. So the actual server runs on **Cloud Run**
(project `match-score-manager`, region `us-central1`), and Firebase Hosting
sits in front of it as a `"**"` rewrite (see `firebase.json`) purely for the
`.web.app` domain and TLS. Firebase Hosting's proxy doesn't pass the
WebSocket `Upgrade` through to Cloud Run, so Socket.IO automatically falls
back to HTTP long-polling on the Hosting URL — updates still land in about a
second, which is fine for this use case. Hitting the Cloud Run URL directly
gets you a real WebSocket with no proxy in between, since Cloud Run supports
WebSockets natively.

**Important:** match state lives in one process's memory (`server.js`), not
a database, so the Cloud Run service is pinned to `--max-instances=1`. If it
were allowed to scale to multiple instances, the control panel and overlay
could land on different instances with different state and silently drift
out of sync (this happened during initial setup — the default max-instances
lets Cloud Run scale out during any burst of traffic). Always redeploy with
`--max-instances=1` as below rather than a bare `gcloud run deploy`.

### Redeploying

```bash
# after changing server.js / public/*
gcloud run deploy match-score-manager --source . --region us-central1 \
  --allow-unauthenticated --project match-score-manager --max-instances=1

# after changing firebase.json/hosting/ only
firebase deploy --only hosting --project match-score-manager
```

Both commands need the `gcloud` and `firebase` CLIs authenticated against the
Google account that owns the `match-score-manager` project. The project is on
the pay-as-you-go **Blaze** plan (required for Cloud Run) — usage at this
scale should stay within the free tier of both Cloud Run and Firebase
Hosting, but it's not the free Spark plan.

### Access control

The live deployment is public with no login (`--allow-unauthenticated`), so
writes to match state are gated by a shared secret instead: the server only
applies a `control:update` event if it carries the right `token`, set via the
`CONTROL_TOKEN` environment variable on the Cloud Run service. The control
panel has a small "Access token" field (top of the page) that saves the token
to that browser's `localStorage` and attaches it to every update it sends.
The overlay pages don't need a token — they only ever read state, never
write it.

**This matters in practice, not just in theory:** within a few minutes of
the first `--allow-unauthenticated` deploy (before this token gate existed),
something external had already connected and started changing the score,
timer, and penalties — almost certainly an automated scanner that found the
freshly-issued `.web.app` TLS certificate via Certificate Transparency log
monitoring, which is common within minutes of any new HTTPS domain going
live. Without the token, anyone with the URL (or anyone who just opens the
overlay page's browser console and calls `socket.emit('control:update', ...)`
directly, bypassing the control panel's UI entirely) can hijack a live
broadcast's scoreboard. Never redeploy without `CONTROL_TOKEN` set once this
is public.

To rotate the token:

```bash
gcloud run services update match-score-manager --region us-central1 \
  --project match-score-manager --update-env-vars CONTROL_TOKEN=<new-token>
```

Then update the token in the control panel's "Access token" field on every
device/browser that uses it (old sessions won't be able to write until you
do). Locally (`npm start`), `CONTROL_TOKEN` is unset by default, so local dev
has no token gate — that's fine since it's bound to localhost only.

## Adding the overlay to OBS

1. In OBS, add a **Browser Source**.
2. Set the URL to one of the overlay URLs — the combined `/overlay/`, or the
   split `/overlay/clock/` / `/overlay/penalty/` scenes — live above, or
   `http://localhost:4000/overlay/...` when running locally.
3. Set the width/height to match your canvas (e.g. 1920x1080).
4. Leave "Shutdown source when not visible" unchecked so it keeps receiving
   live updates.
5. If you're using the split scenes, add `/overlay/clock/` and
   `/overlay/penalty/` as two separate Browser Sources so you can position,
   scale, or scene-switch them independently — e.g. keep the clock on screen
   throughout but only bring in the penalty panel as its own scene during a
   shootout.

The overlay background is transparent, so it composites directly over your
camera/game capture.

## Architecture

A single Node process (`server.js`) runs Express (static file serving) and
Socket.IO. It holds one in-memory match state object — team names/colors/logos,
score, clock (plus extra time), penalty shootout, competition logo, and the
selected style — and broadcasts it to every connected client whenever the
control panel sends an update. Multiple overlay tabs (or a control panel +
overlay on different machines on the same LAN) all stay in sync because they
all render from the same server-pushed state.

The overlay (`public/overlay/overlay.js`) is style-driven: one `<div id="board">`
gets its `innerHTML` replaced by whichever style's render function runs for
the current state, with matching CSS scoped under `.board.style-<name>` in
`overlay.css`. Each style's render function returns `{ main, penalty }` —
the clock/team/score markup and the penalty-panel markup as separate pieces.
`public/overlay/index.html` renders both (the combined view);
`public/overlay/clock/index.html` and `public/overlay/penalty/index.html`
set `window.OVERLAY_MODE` to `'clock'` or `'penalty'` before loading the same
`overlay.js`/`overlay.css`, so only that piece renders. Adding a new style
means adding one render function plus one CSS block; adding a new scene
means adding a new folder whose `index.html` sets `OVERLAY_MODE` and includes
the same shared JS/CSS — no server changes needed either way.

State lives in memory only and resets when the server restarts — there's no
database. That's a deliberate v1 boundary; if you need it to survive
restarts, the natural place to add persistence is a JSON file write on every
`broadcastState()` call, loaded back in on startup.

### Bracket

`state.teamRoster` is a flat array of reusable team profiles —
`{ id, name, color, secondaryColor, logo }` — created and edited from the
Team Roster section of the bracket maker (`rosterAddTeam`/`rosterSetName`/
`rosterSetColor`/`rosterSetSecondaryColor`/`rosterSetLogo`/`rosterRemoveTeam`).
It's independent of any one bracket, so the same roster survives a bracket
resize or reset.

`state.bracket` is `{ size, teams, picks }`: `teams` is a flat array (one
entry per round-0 slot) of `{ name, color, secondaryColor, logo, rosterId }`
— a **snapshot** of a roster team's data at the moment it was assigned, plus
`rosterId` pointing back at which roster entry it came from. `picks[round][match]`
is `'A'`/`'B'` once that matchup's winner has been chosen.

Assigning a slot (`bracketAssignTeam { index, teamId }`) copies the roster
team's current name/colors/logo into that slot and records its id — editing
the roster team later does *not* retroactively update slots that already
copied it; re-select it to pull the update in. `bracket.js` (the maker)
builds each round-0 slot's `<select>` by excluding any roster id that's
already the `rosterId` of a *different* slot, so a team can only occupy one
slot in the bracket at a time; removing a team from the roster
(`rosterRemoveTeam`) resets any slot still pointing at that id back to a
blank default rather than leaving a dangling reference.

`public/shared/bracket-utils.js` derives the full round-by-round view —
`computeBracketRounds` walks forward from `teams`, resolving each round's
matches and carrying the winning team's whole snapshot object into the next
round, so a later round always knows the original entrant's identity, not
just its name. That file has no DOM dependency and is loaded two ways: as a
browser `<script>` (bracket maker, bracket overlay) and via `require()` from
`server.js` (so `startMatchFromBracket` can resolve "who's actually in this
matchup" using the exact same logic, instead of a second implementation
drifting out of sync with the client's).

Picking a winner (`bracketPickWinner`) clears every pick in later rounds —
otherwise changing an earlier result could leave a later round pointing at a
team that's no longer actually there. `startMatchFromBracket { round, match }`
looks up that matchup via `computeBracketRounds` and, if both sides are
resolved, overwrites `state.teamA`/`state.teamB` with their name/colors/logo
and resets score/clock/penalties — it's the bridge between "who's playing
next in the tournament" and "what the scoreboard overlay currently shows."
