# pomopomo

A pomodoro timer and a markdown planner, side by side.
**→ [aryamans.me/pomopomo](https://aryamans.me/pomopomo/)**

Everything runs in your browser. No account, and nothing sent anywhere — your
planner lives in `localStorage` and nowhere else. Unless you turn on **sync**,
which keeps your devices in step through a tiny server that only ever sees
encrypted data.

## What it does

**Timers**
- Pomodoro with configurable session / short break / long break (25 / 5 / 15 by
  default), cycling to a long break every 4th session
- A plain count-up stopwatch for work of unknown length
- On phase end: a chime, a browser notification, and a live countdown in the tab
  title
- Both timers keep running independently of which one is on screen, and survive
  a reload — the countdown is anchored to an absolute deadline, not to ticks, so
  a throttled background tab can't make it drift

**Session record**
- Every completed focus session and every logged count-up goes in the record.
  Breaks never do.
- Optional task name on either timer, so the record says what you were doing
- History under the timer, grouped by day with daily totals; individual sessions
  can be deleted
- Stats view: today / this week / all time, plus per-day and per-week bars
- Skipping out of a focus phase logs the time you actually did (flagged
  *partial*); Reset discards it. A pomodoro that finishes while the tab is
  closed is still recorded on next load.
- Left a count-up running through lunch? **adjust** sets the elapsed time by
  hand. Those sessions are flagged *adjusted*, so the record stays honest about
  which durations were measured and which were typed.

**Planner**
- Live-preview markdown: `# headings` render as headings, `[] task` renders as a
  real checkbox you can click, and the raw markdown reappears on whichever line
  your cursor is on
- `**bold**`, `*italic*`, `` `code` `` and `~~strike~~` too
- Enter continues the current list item; Enter on an empty one exits the list
- Autosaved as you type

**Archive**
- **clean** lifts every completed task out of the planner and files it in the
  archive, so the planner stays about what's left. Headings stay put.
- Each archived task keeps its completion time and the heading path it lived
  under. Searchable by either.
- Completion is stamped **when you tick the box**, not when you clean — cleaning
  is tidying up and can happen days later. Tasks that were already ticked before
  pomopomo saw them show their time with a `?`, because that one really is a
  guess.
- The clean is undoable, until you edit by hand.

**Dailies**
- A second markdown panel under the planner, for the things you do every day.
  Same editor, same syntax.
- No archive, no clean — the only thing that happens to it on its own is that
  the ticks clear when a new day starts.
- A new day starts at **4am** by default, not midnight, so a night that runs
  late doesn't get its list wiped out from under it. Click **resets 4 AM** in
  the header to move the hour.
- Only the ticks reset. The list you wrote stays exactly as you left it.
- **Dailies** in the history panel keeps the streak: consecutive days you
  ticked *anything*, alongside a total of the days you cleared the whole list,
  and a strip of the last 14 days — green for a full day, yellow for a start,
  and both keep the streak alive.
- An unfinished today doesn't break the streak, because the day isn't over. A
  day you never opened pomopomo does, and shows as a dashed cell rather than an
  empty one.

**Sizing**
- The planner and the dailies list are as tall as you drag them — grab the
  handle at the bottom edge of either. Arrow keys work too, once it's focused.
- Neither one resizes itself. Their content scrolls inside whatever height you
  gave them, and the height is remembered.

**Backups**
- **export** downloads everything — planner, dailies, archive, completion times,
  session log, timer settings — as a single JSON file.
- **import** validates the file, shows you what's in it, then asks: **Merge**
  (adds only sessions and archived tasks you don't already have, leaves your
  planner, dailies and settings alone) or **Replace everything**.
- Live timer state is deliberately not exported. A countdown's deadline is
  meaningless on another machine next week.

**Sync**
- Off by default. **sync settings** in the header turns it on: enter the
  access key and **Create a new code** on the first device, then on each other
  device enter the key and that code and press **Sync with this code** — or
  just open the link the first device gives you.
- While it's on, a **synced** button sits next to it: a dot for the state
  (green synced, amber waiting, pink failed), and a click to sync right now.
- The server only serves whoever knows its access key, so a public URL doesn't
  make it a public service. The link carries the key; you type it once.
- Carries the planner, dailies, session log, archive, completion times and
  timer settings. A running timer stays on the device it's running on.
- End-to-end encrypted. The code never leaves your devices; the key and the
  server's id for your data are both derived from it, and the server can't get
  from one to the other.
- Syncs before the page first draws, shortly after any change, on returning to
  the tab, and once a minute while it's open.
- Real merging, not last-write-wins: tick different dailies on two devices
  offline, add tasks on both, delete a session on one, and all of it lands.
  When the same lines were changed on both, the most recent edit wins and the
  other version is kept under **saved copies** in the sync panel.
- Another device's change never reloads the page out from under your typing —
  it waits until you pause.

## Running it

```bash
npm install && npm run dev
```

`npm run build` emits static files to `dist/`.

## Deploying

Pushing to `master` triggers `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. Because `aryaman73.github.io` carries the CNAME
`aryamans.me`, this project repo is served at `aryamans.me/pomopomo/` with no
extra DNS setup.

Sync needs a server: a Cloudflare Worker in `sync-server/`, free to run. Setup
is in [sync-server/README.md](sync-server/README.md) — set an access key and
deploy it once, then set its URL as the repo's `SYNC_URL` Actions variable.

Vite is configured with `base: "./"`, so the same build also works at a domain
root or any other sub-path.

## Stack

Vite + React 18, and CodeMirror 6 for the planner. Six runtime dependencies,
deliberately — sync added none: the crypto and compression are the
browser's own APIs, and the diff3 merge is written here.

See [PLAN.md](PLAN.md) for scope, design notes, and the feature backlog.
