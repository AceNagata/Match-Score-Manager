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

## Adding the overlay to OBS

1. In OBS, add a **Browser Source**.
2. Set the URL to the overlay URL — the live one above, or
   `http://localhost:4000/overlay/` when running locally.
3. Set the width/height to match your canvas (e.g. 1920x1080).
4. Leave "Shutdown source when not visible" unchecked so it keeps receiving
   live updates.

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
`overlay.css`. Adding a new style means adding one render function plus one
CSS block — no changes to the state shape or the control panel are needed
unless the style needs new data.

State lives in memory only and resets when the server restarts — there's no
database. That's a deliberate v1 boundary; if you need it to survive
restarts, the natural place to add persistence is a JSON file write on every
`broadcastState()` call, loaded back in on startup.
