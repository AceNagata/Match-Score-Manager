# Match Score Manager

A live football (soccer) match score, clock, and penalty-shootout manager with
a broadcast-ready overlay for OBS.

Two pages are served:

- **Control panel** (`/control/`) — edit team names/colors, adjust the score,
  run the match clock, track a penalty shootout, and switch overlay styles.
- **Overlay** (`/overlay/`) — a transparent-background page you add as a
  Browser Source in OBS. It updates live over WebSockets whenever something
  changes in the control panel, so it can run on the same machine or a
  separate one on the same network.

## Setup

```bash
npm install
npm start
```

Then open:

- Control panel: `http://localhost:4000/control/`
- Overlay: `http://localhost:4000/overlay/`

## Adding the overlay to OBS

1. In OBS, add a **Browser Source**.
2. Set the URL to `http://localhost:4000/overlay/`.
3. Set the width/height to match your canvas (e.g. 1920x1080).
4. Leave "Shutdown source when not visible" unchecked so it keeps receiving
   live updates.

The overlay background is transparent, so it composites directly over your
camera/game capture.

## Architecture

A single Node process (`server.js`) runs Express (static file serving) and
Socket.IO. It holds one in-memory match state object — team names/colors,
score, clock, and penalty shootout — and broadcasts it to every connected
client whenever the control panel sends an update. Multiple overlay tabs (or
a control panel + overlay on different machines on the same LAN) all stay in
sync because they all render from the same server-pushed state.

Two overlay styles are included (`classic` and `banner`, switchable live from
the control panel), inspired by the reference designs in `References/`.
Adding a new style means adding a new `.board` block in
`public/overlay/index.html` plus matching CSS/JS branches — the state shape
doesn't need to change.
