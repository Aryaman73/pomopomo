# pomopomo

A pomodoro timer and a markdown planner, side by side.
**→ [aryamans.me/pomopomo](https://aryamans.me/pomopomo/)**

Everything runs in your browser. No account, no server, nothing sent anywhere —
your planner lives in `localStorage` and nowhere else.

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

**Planner**
- Live-preview markdown: `# headings` render as headings, `[] task` renders as a
  real checkbox you can click, and the raw markdown reappears on whichever line
  your cursor is on
- `**bold**`, `*italic*`, `` `code` `` and `~~strike~~` too
- Enter continues the current list item; Enter on an empty one exits the list
- Autosaved as you type

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

Vite is configured with `base: "./"`, so the same build also works at a domain
root or any other sub-path.

## Stack

Vite + React 18, and CodeMirror 6 for the planner. Six runtime dependencies,
deliberately.

See [PLAN.md](PLAN.md) for scope, design notes, and the feature backlog.
