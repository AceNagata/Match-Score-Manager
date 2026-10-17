# Match Score Manager

A live football (soccer) match score, clock, and penalty-shootout manager with
a broadcast-ready overlay for OBS.

Two pages are served:

- **Control panel** (`/control/`) — edit team names/colors/logos, adjust the
  score, run the match clock (with an extra-time indicator), track a penalty
  shootout, and switch between the two overlay styles.
- **Overlay gallery** (`/overlay/`) — not an overlay itself: a page that
  shows a scaled live preview of every overlay with its URL and Copy / Open
  buttons, plus OBS and vMix setup steps. Previews default to sample data
  (each overlay page accepts `?demo=1`, and `&style=neon`) so empty overlays
  like the pop-ups still show something; switch to "Live match" to see the
  real state.
- **Overlays**, one page each, all transparent 1920×1080 pages you add as
  separate Browser Sources (OBS) or Web Browser inputs (vMix). They update
  live over WebSockets, so they can run on the same machine or another one
  on the network, and always stay in sync with each other:

  | URL | Shows |
  | --- | --- |
  | `/overlay/clock/` | Scoreboard: clock, names, score, extra-time bar |
  | `/overlay/goal/` | Animated GOAL banner when a goal is logged |
  | `/overlay/cards-subs/` | Card and substitution lower-thirds |
  | `/overlay/event-list/` | Running list of match events (when switched on) |
  | `/overlay/penalty/` | Penalty shootout panel (when switched on) |
  | `/overlay/bracket/` | Tournament bracket |

  There is deliberately no combined "everything" page: put each piece on its
  own source so it can be positioned and scene-switched independently.
- **Bracket Maker** (`/control/bracket/`) — build a 4/8/16-team single-
  elimination bracket. A **Team Roster** section at the top is where you
  create teams once — name, primary/secondary color, flag/logo — and each
  bracket slot is a dropdown you assign a roster team to, instead of typing
  a name into every slot. A team already placed in the bracket is excluded
  from every other slot's dropdown, so you can't accidentally put the same
  team in twice. Advance winners round by round and see the champion crowned.
  Each matchup has a score box per team: type the result in, or start the
  match from the bracket and let the scoreboard fill it in as goals go in.
  A "▶ Start This Match" button on any matchup (once both sides are known)
  loads that pairing's name/colors/logo straight into the main match
  scoreboard — clock and penalties reset for the new match, and the score
  picks up from the matchup's recorded score (0–0 the first time) — so you
  don't have to retype anything when a tournament match kicks off.
  A **Tournament** card at the very top saves everything — see "Saved
  tournaments" below.
- **Bracket overlay** (`/overlay/bracket/`) — the tournament bracket as a
  Browser Source: earlier rounds fan out left and right, converging on the
  final in the center with the champion showcased beneath it once decided.
  Each team's flag/logo (if it has one) is shown before its name, and each
  matchup that has a recorded score shows it beside the team names. Colors
  follow whichever of the two overlay styles is currently selected, same as
  the clock/penalty scenes. It auto-scales and centers on both axes to fill
  as much of the Browser Source as it can without distortion, regardless of
  whether it's a 4, 8, or 16-team bracket — see "Bracket overlay scaling"
  below.

## Overlay styles

Two styles ship, modeled on the reference designs in `References/`:

| Style | Look |
| --- | --- |
| `flags` | Dark card with colored team blocks and a "-" divider between scores |
| `neon` | Neon accent (color-customizable), team flags/logos, clock centered between the scores |

Styles that used to ship (`classic`, `banner`, `badges`, `champions`,
including the competition-logo upload that only `champions` used) were
removed to keep the style list to just these two — see git history if any of
that code is ever needed again.

Team logos are optional — upload an image per team from the control panel
and it appears on both `flags` and `neon` (main row and penalty panel);
teams with no logo just show their name, no broken image or placeholder box.
Uploaded images are resized client-side before they're sent over the socket,
so there's no meaningful payload-size concern.

Each team also has a **primary and secondary color**, used for the diagonal
two-tone stripe along the bottom of `flags`' team-color blocks. `neon`
doesn't use team colors at all — it shows each team's flag/logo instead, the
same identifier `flags` uses, just without a colored background block.
Bracket entrants (`/control/bracket/`) have the same primary/secondary
fields (used for `flags`), and carry over automatically when you "Start
This Match" from a bracket matchup.

`neon`'s accent color (the clock pill's background and the score digits —
lime green, `#c6f135`, by default) is a control-panel color picker
(`state.neonColor`), applied via the `--neon-color` CSS custom property set
on `.board` in `overlay.js`'s `render()`. `overlay.css`'s neon rules
reference `var(--neon-color, #c6f135)` instead of a hardcoded color, so
picking a new color repaints every neon-styled element instantly without a
page reload. The clock itself sits between the two score digits (where a
hexagon icon used to be) rather than as a separate box beside the team
names.

### Extra time

Setting the `Extra time` +/- count in the control panel does **not** show
anything on the overlay by itself — it only stages the number. A separate
"Show on overlay" toggle (`state.timer.extraActive`, same on/off pattern as
the penalty panel's "Show penalty panel on overlay") controls whether the
badge is actually visible, so you can set the number ahead of time and
reveal it on the overlay at whatever moment you choose, instead of it
popping up the instant you adjust the count.

When shown, a full-width bar drops down beneath the *entire* scoreboard row
(not just the clock), with the `+N` centered in it — like a drawer opening
under the whole bug. It's one shared `.extra-badge` CSS rule
(`position: absolute; top: 100%; left: 0; right: 0`) anchored to whichever
row-level container is `position: relative`: `.row` for `neon`,
`.flags-wrap` for `flags`. `flags` needed a wrapper element because its own
row has an `overflow` that would otherwise clip anything positioned outside
it — the badge lives one level up, alongside the row, instead of inside it.

### Ending a match

The "End Match" button (Match Clock card) sends `endMatch`, which clears
both team names (`state.teamA.name`/`teamB.name` become `''` — the overlay
just shows no name, not a "TEAM 1" placeholder), stops and zeroes the
clock, and clears extra time (both the count and the "Show on overlay"
toggle). It deliberately leaves scores, colors, logos, and penalties alone
— it's for clearing the identifying/time info between matches, not a full
reset. For a complete wipe back to defaults, use "Reset Entire Match" in
the footer instead.

### Match events, squads and pop-ups

The control panel has two more cards:

- **Squads** — each team's players (shirt number + optional name). Add them
  one at a time, or open "Paste a lineup" and paste one player per line
  (`10 Name`, `10. Name`, `10 - Name`, or just `10`). Numbers are unique per
  team; the list stays sorted by number.
- **Match Events** — pick an event (Goal, Penalty goal, Own goal, Yellow card,
  Red card, Substitution), pick the team, then tap the player's number. The
  event is logged at the current clock minute (`minute` = whole minutes
  played + 1, so 02:20 is `3'`), or at whatever you type in the Minute box
  first (`45+2`). A substitution takes two taps: the player going off, then
  the player coming on. For the three goal types there is also a **No
  player** button (handy when you don't know the scorer, or haven't entered
  squads): it logs the goal with just the team and the clock minute.

What each event does:

- Goals add 1 to the scoring team's score. An own goal is logged against the
  player's own team and counts for the other side. Deleting a goal event from
  the log takes the point back off.
- **The scoreboard's "+" button is a goal too.** It logs a goal with no
  player (team + clock minute), so the goal pop-up fires even when nobody
  picks a scorer; the splash then shows just the team, the time and the
  updated score, and the event list shows the team name in place of a
  player. "−" takes back that team's latest goal if it was logged this way
  (event and pop-up included); if the latest goal names a player it only
  lowers the number, as before. Only goals are allowed without a player —
  cards and substitutions still need one.
- A second yellow for the same player is logged as `secondYellow` and shown
  as a yellow + red card.
- Every new event pops up on the overlay: goals as a full-width animated
  **GOAL** splash in the scoring team's colors with the scorer, minute and
  the updated score; cards and substitutions as a lower-third in the bottom
  left. Pop-ups hide themselves (goal 9s, card 7s, sub 8s — `POPUP_DURATION`
  in `server.js`); "Hide pop-up now" clears one early, and "Show" on any
  logged event replays it.
- "Show event list on overlay" toggles a running list of the last 12 events
  (top left).

State: `state.teamA.squad` / `teamB.squad` (`{ id, number, name }`),
`state.events` (`{ id, type, team, minute, seconds, player, playerOn?,
scoreAfter? }`, with player data copied in so later squad edits don't change
history; `player` is `null` for a goal logged without a scorer), `state.popup` (`{ seq, eventId, kind }`, `seq` bumps on every show so
the overlay only restarts the animation for a new pop-up, not on every
clock tick) and `state.eventsListActive`. "Start This Match" from the
bracket clears squads and events for the new pairing; "End Match" leaves
them alone, like scores.

Goals render only on `/overlay/goal/`, cards and subs only on
`/overlay/cards-subs/`, and the list only on `/overlay/event-list/`.

## Setup

```bash
npm install
npm start
```

Then open:

- Control panel: `http://localhost:4000/control/`
- Overlay gallery (all overlay links): `http://localhost:4000/overlay/`

## Live deployment

The app is hosted on Firebase/Google Cloud:

- **Hosting URL** (use this day-to-day): https://match-score-manager.web.app
- **Control panel**: https://match-score-manager.web.app/control/
- **Overlay gallery**: https://match-score-manager.web.app/overlay/
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

**Important:** the live match state lives in one process's memory
(`server.js`), and the saved-tournament writes assume a single writer, so the
Cloud Run service is pinned to `--max-instances=1`. (Tournaments themselves
are in Firestore and survive restarts — see "Saved tournaments" — but the
scoreboard, clock and events are not.) If it
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
# (leave --set-env-vars off: the existing CONTROL_TOKEN carries over)

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

So a device that only has the URL can *see* everything (scoreboard, saved
tournaments, bracket) but can't change anything. When it tries, the server
replies to just that client with `control:rejected` and the page shows a red
"Your changes aren't going through" bar plus "Token not accepted" next to the
token field — before this, refused changes were dropped without a word and the
page looked frozen.

**Giving someone else control (e.g. a friend on a phone).** On a device that
already has the token, press **Copy phone link** next to the token field and
send them the link. It looks like `https://…/control/#token=<token>`: opening
it saves the token in their browser and removes it from the address bar, after
which everything works the same as on your device. The token is in the URL
*fragment*, which browsers never send to the server, so it isn't written to
Cloud Run's request logs or fetched by chat link previews. (A link pasted into
a page that's already open also works.) Anyone holding the link has full
control of the match, so only send it to people you trust, and
rotate the token (below) to cut someone off.

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
do; they'll see the red warning bar), and send a fresh phone link to anyone
who needs one. Locally (`npm start`), `CONTROL_TOKEN` is unset by default, so local dev
has no token gate — that's fine since it's bound to localhost only.

## Adding overlays to OBS or vMix

Open `/overlay/` and use **Copy link** on each overlay you want.

**OBS:** Sources → **+** → **Browser**, paste the URL, set 1920 × 1080, and
leave "Shutdown source when not visible" unchecked so it keeps receiving
live updates. Add one Browser Source per overlay, e.g. keep the scoreboard on
screen throughout and bring in the penalty panel only during a shootout.

**vMix:** **Add Input** → **Web Browser**, paste the URL, 1920 × 1080, and put
it on an Overlay channel to take it on and off air.

Overlay backgrounds are transparent, so they composite directly over your
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
Each overlay page (`public/overlay/<name>/index.html`) sets
`window.OVERLAY_MODE` — `'clock'`, `'penalty'`, `'goal'`, `'cardsSubs'` or
`'list'` — before loading the same `overlay.js`/`overlay.css`, so only that
piece renders. `public/overlay/index.html` is the gallery (`gallery.js` /
`gallery.css`); its list of overlays is the `OVERLAYS` array in `gallery.js`. Adding a new style
means adding one render function plus one CSS block; adding a new scene
means adding a new folder whose `index.html` sets `OVERLAY_MODE` and includes
the same shared JS/CSS, plus an entry in the gallery's `OVERLAYS` list — no
server changes needed either way.

The *live match* (names, score, clock, penalties, events, squads) lives in
memory only and resets when the server restarts. The *tournament* — team
roster, bracket, and every match score — is saved to a database and comes
back; see "Saved tournaments" below.

### Bracket

`state.teamRoster` is a flat array of reusable team profiles —
`{ id, name, color, secondaryColor, logo }` — created and edited from the
Team Roster section of the bracket maker (`rosterAddTeam`/`rosterSetName`/
`rosterSetColor`/`rosterSetSecondaryColor`/`rosterSetLogo`/`rosterRemoveTeam`).
It's independent of any one bracket, so the same roster survives a bracket
resize or reset.

`state.bracket` is `{ size, teams, picks, scores }`: `teams` is a flat array (one
entry per round-0 slot) of `{ name, color, secondaryColor, logo, rosterId }`
— a **snapshot** of a roster team's data at the moment it was assigned, plus
`rosterId` pointing back at which roster entry it came from. `picks[round][match]`
is `'A'`/`'B'` once that matchup's winner has been chosen, and
`scores[round][match]` is `{ A, B }` — the goals each side scored.
`computeBracketRounds` folds both into each match it returns
(`winner`, `scoreA`, `scoreB`), which is all the maker and overlay read.

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
and resets clock/penalties — it's the bridge between "who's playing next in
the tournament" and "what the scoreboard overlay currently shows."

**Scores follow the scoreboard.** Starting a match also sets
`state.liveMatch = { round, match }`, and from then on `afterPatch()` copies
the scoreboard's score into `bracket.scores` after *every* patch — so
`incrementScore`, goal events and removed goal events all reach the bracket
without each having to know about it. Typing a score for the live match in
the maker (`bracketSetScore`) goes the other way and updates the
scoreboard, so the two never disagree. "End Match" and "Reset Entire Match"
unlink it; the recorded score stays. Starting a matchup that already has a
score resumes from it instead of 0–0, which is how a match survives a
server restart (the clock does not).

The link is held as a *reference* to the two bracket team objects (`liveRefs`
in `server.js`), not as slot numbers: if either side stops being the same
team object — a slot was reassigned, an earlier winner changed, the bracket
was reset, another tournament was opened — the link drops by itself. The same
reasoning clears stale scores: a score only describes the two teams that
played it, so reassigning a slot or changing a winner clears that matchup's
score and the matchups it feeds into (`clearScoresFrom`), while leaving
unrelated matchups alone.

### Saved tournaments

A *tournament* is the team roster plus the bracket (picks and scores) under a
name — `state.tournament = { id, name }`. It is the one part of the state that
is stored outside memory, so it survives restarts and redeploys. The live
match is not saved.

- **Auto-save.** After every patch, `afterPatch()` compares a signature of
  `[name, roster, bracket]` with the previous one; if it changed, a write is
  queued 800 ms later (so typing a name isn't a write per keystroke). A change
  to anything else — a scoreboard-only goal, the clock — saves nothing. A
  tournament nobody has edited yet isn't written at all.
- **Resume.** On startup the server reads the "active" pointer, loads that
  tournament and only then starts listening, so no client ever sees a blank
  bracket flash up and then get replaced. `SIGTERM` flushes any pending write
  first, so a deploy can't lose the last edit.
- **Several tournaments.** The Tournament card at the top of the Bracket Maker
  renames the open one, starts a new one (`tournamentNew`), opens another
  saved one (`tournamentOpen`) or deletes one (`tournamentDelete`; the open
  tournament can't be deleted). Opening or creating one first flushes the
  current one, and refuses to proceed if that flush failed — unsaved work is
  never silently discarded.
- **Status.** `state.persist = { mode, status, savedAt, error }` drives the
  "✓ Saved 1:42 AM" / "Saving…" / "⚠ Not saved — …" chip. A failing store never
  stops the scoreboard: the server keeps running from memory, reports the
  problem, and retries every 15 s; the next successful save includes
  everything.

Storage is chosen by `STORE` (`store.js` — all backends share one interface):

| `STORE` | Where | Default when |
| --- | --- | --- |
| `firestore` | Cloud Firestore: collection `tournaments`, plus `settings/active` | running on Cloud Run (`K_SERVICE` is set) |
| `file` | JSON files in `DATA_DIR` (default `./.data`, git-ignored) | everywhere else — local `npm start` |
| `memory` | nothing saved; tournament switching is disabled | only when set explicitly |

Notes: a tournament is one Firestore document (1 MiB limit), and logos are
most of its size, so saves over ~900 KB are refused with a "too large" status —
the logo uploader already downsizes images, and 16 teams fit with room to
spare. Ids are validated before they touch a file path or document name.
Firestore is touched only by the server (with the Cloud Run service account),
never by browsers, so there are no Firestore security rules to maintain; every
write still goes through `CONTROL_TOKEN`.

One-time Firestore setup for a project (already done for `match-score-manager`):

```bash
gcloud services enable firestore.googleapis.com --project <project>
gcloud firestore databases create --location=us-central1 --project <project>
```

The Cloud Run service account needs Firestore access (`roles/datastore.user`,
or the project `roles/editor` it has by default).

### Bracket overlay scaling

A 4-team bracket and a 16-team bracket have very different natural
dimensions (a few hundred pixels wide vs. well over a thousand), so pure CSS
centering isn't enough to make both "fill the screen" — one would look tiny,
the other might overflow. `bracket-overlay.js`'s `fitAndCenter()` measures
the board's actual rendered size at `transform: none` (so the measurement
isn't affected by a previous scale), computes a single uniform scale factor
(`Math.min` of the width-fit and height-fit ratios, so it never distorts
the aspect ratio or overflows either dimension), then sets `left`/`top`/
`transform: scale(...)` so the scaled box is centered on both axes with a
small margin from the edges.

It's called after every render and on `window.resize`, but neither of those
alone was reliable enough in practice: on a fresh page load, the Oswald web
font can swap in (changing text metrics, and therefore the board's natural
size) at a moment that doesn't line up with any single one-shot hook —
`document.fonts.ready` resolving before the first render even has content,
a slow long-polling handshake delaying that first render past a fixed
timeout, etc. — chasing the exact race wasn't worth it. Instead, `fitAndCenter()`
also runs on a `setInterval(..., 1000)` for the life of the page. It's cheap
and idempotent (just a measure + three inline styles, no visible flash since
there's no paint between resetting and reapplying the transform), so
checking every second guarantees the overlay is correctly fit within a
second of *any* layout shift — web font swaps included — without needing to
know in advance what caused it or exactly when it'll happen.

### Bracket connector lines

The lines joining sibling match boxes into the next round are an SVG overlay
drawn by `drawConnectors()`, not a CSS border trick — the gap between columns
varies with the browser's font metrics and the scale factor, so the only way
to hit the actual box edges is to measure them. On every `fitAndCenter()`
pass (so after every render, resize, and font-swap correction described
above), it re-reads each match box's `getBoundingClientRect()` in the
board's *natural*, unscaled coordinate space, deletes the previous
`<svg class="connector-svg">`, and draws a fresh one as the last child of
`#board` — appending it there means it's carried along by the same
`transform: scale(...)` as everything else, so the lines always line up
with the boxes regardless of bracket size.

Two shapes get drawn: `connectMerge()` (two source boxes feeding one target
— the classic "two stubs meet a vertical bar, then one line continues into
the target" shape) for every round-to-round merge on each half, and
`connectSimple()` (a single straight stub) for the last box on each half
connecting into the center final box. Both work outward-in from whichever
side is farther from the center, so the line always leaves from the box's
inner edge.

The lines default to white but their color is a control-panel setting
(`state.connectorColor`, picker on `/control/bracket/`), applied the same
way as the neon accent color: `bracket-overlay.js`'s `render()` sets
`--connector-color` on `#board`, and `.connector-line` in
`bracket-overlay.css` reads `stroke: var(--connector-color, #ffffff)`.

With the default white color, the lines will look invisible in a plain
browser tab, because the page background is `transparent` and a normal tab
renders "transparent" as white — white lines on a white tab background
disappear. That's expected and not a bug: in OBS, the browser source's
background really is transparent, so the lines show up against whatever
video is behind them. (Confirmed this by temporarily forcing a dark `body`
background while testing locally — the lines were there the whole time.)
