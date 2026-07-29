# pomopomo — Plan

A pomodoro timer + markdown planner, for me and for anyone else who wants it.
Lives at **https://aryamans.me/pomopomo/**.

Everything stays client-side. No accounts, no backend, no analytics. Your data
is in your browser and nowhere else.

---

## Hosting

`aryaman73.github.io` carries the CNAME `aryamans.me`, so a project repo named
`pomopomo` with Pages enabled is served at `aryamans.me/pomopomo/` with no extra
DNS work. Same pipeline as [noize](https://github.com/Aryaman73/noize): GitHub
Actions builds with Vite and publishes `dist/` to Pages on push to `master`.

`vite.config.js` uses `base: "./"` so the bundle works at a sub-path, at the
root, or behind any domain without a rebuild.

---

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Build | Vite 6 | Matches noize. Fast, clean static output. |
| UI | React 18 | Matches noize. |
| Editor | CodeMirror 6 | See "Planner" below — this is a real decision, not a default. |
| State | React state + `localStorage` | No store library needed at this size. |
| Deps | 6 runtime packages total | Deliberately small. |

### Why CodeMirror for the planner

The planner is meant to feel like Obsidian's live preview: you type
`## Monday` and it *becomes* a heading, you type `[] ship it` and it *becomes* a
checkbox you can click — but the raw markdown comes back on whichever line your
cursor is on, so it's always plain text you're editing.

Three ways to build that:

1. **Textarea + rendered preview pane.** Trivial, but not what was asked for.
2. **Hand-rolled `contenteditable`.** Looks close in a demo, then you spend the
   rest of the project fighting cursor placement, undo history, IME input,
   selection across styled nodes, and paste. Known trap.
3. **CodeMirror 6.** Purpose-built for exactly this: per-line decorations,
   atomic widget replacement (a real `<input type=checkbox>` swapped in for the
   `[]` text), and decorations that can be conditioned on cursor position.
   It's what Obsidian itself uses.

Going with 3. Costs ~200KB gzipped and four `@codemirror/*` packages. Buys the
requested behavior with none of the class of bugs option 2 guarantees.

---

## Design direction

Vaporwave / Y2K, dark only — but **legibility wins every tie**. The aesthetic
lives in color, chrome, and framing; it does not live in the parts you have to
read for 25 minutes at a stretch.

- Dark base (`#0d0221`-ish), neon cyan + magenta accents, a hint of chrome
  gradient on the big numerals.
- Faint perspective grid in the backdrop, low enough contrast to ignore.
- The timer numerals are the loudest thing on screen. Everything else recedes.
- Planner text is a normal, comfortable monospace at a normal size. No neon
  glow on body copy, no scanlines over text.
- No CRT flicker, no auto-playing anything, no animation that runs forever in
  your peripheral vision while you're trying to work.
- `prefers-reduced-motion` respected.

Light mode is explicitly out of scope for now (per request).

---

## MVP (v1) — shipped

- [x] **Pomodoro timer**
  - 25 / 5 / 15 defaults for session, short break, long break — all configurable
  - Start, pause, reset, skip phase
  - Cycles work → short break → work → … → long break every 4th session
  - Manual start between phases (auto-start is a v4 setting)
- [x] **Count-up timer**
  - Open-ended stopwatch for work of unknown length
  - Start, pause, reset
- [x] **Alerts on phase end**
  - Synthesized chime via Web Audio (no asset files, no autoplay problems)
  - Browser notification, behind a one-time permission prompt
  - Live countdown in the tab title
- [x] **Markdown planner**
  - Live-preview editing (see above)
  - Any heading structure the user wants — `#`, `##`, `###`
  - Todos written as `[] task`, `[x] done`; checkbox is clickable and writes
    back to the underlying markdown text
  - Autosaved to `localStorage`, restored on load

### Correctness notes for v1

- Timers derive remaining time from a wall-clock deadline (`Date.now()`), not
  from accumulated `setInterval` ticks. Background tabs get throttled to ~1Hz
  or worse, and tick-accumulating timers silently lose minutes. Reloading or
  backgrounding the tab must not change when the timer ends.
- Timer state is persisted, so a refresh mid-session resumes where you were.
- Both timers tick regardless of which one is on screen. Gating the pomodoro's
  interval on the visible mode meant switching to the count-up left a session
  flagged as running but silently no longer alerting — caught in testing.
- A count-up restores as still-running only if the gap since the last save is
  under 5 minutes (a reload). A longer gap restores it paused at the time it
  had, rather than billing you for the hours your laptop was shut.
- `localStorage` writes from the editor are debounced, and flushed on unload so
  the last few keystrokes aren't lost.

---

## v2 — session record and stats (shipped)

- [x] **Every stretch of work is logged** — completed focus phases and count-up
      sessions. Breaks are never recorded.
- [x] **Optional task name** on both timers, kept separately per mode since the
      two timers run independently
- [x] **History list** under the timer: grouped by day with a daily total,
      scrollable, newest first, individual sessions deletable
- [x] **Stats view**: today / this week / all-time tiles, plus per-day (last 14)
      and per-week (last 8) bars

### Recording rules

These are judgment calls, so they're written down rather than left implicit:

| Event | Logged? |
| --- | --- |
| Focus phase runs to completion | Yes — the full configured duration |
| Focus phase completes while the tab is closed | Yes, on next load, stamped at its scheduled end |
| **Skip** during focus | Yes, the time actually worked, flagged `partial` — but only if ≥ 1 min, so a mis-click doesn't litter the record |
| **Reset** during focus | No. Reset is the "never mind" escape hatch |
| Any break | Never |
| Count-up **Log** | Yes, whatever elapsed. The count-up has no natural end, so logging it is an explicit act |
| Count-up **Reset** | No — discards |

A session is filed under the day it *started*, in local time, so a stretch that
crosses midnight counts toward the evening it belongs to.

The phase-end handler is guarded against double-firing: it runs from both the
interval and the visibility-change catch-up, and `pomoRef` only refreshes on
render, so without the guard a catch-up call could advance and log the same
phase twice.

## Backlog — everything else discussed, nothing dropped

### v2.5 — planner maturity
- [ ] **Clean planner** — one button that removes all completed (`[x]`) tasks
      from the active document and files them into an archive
- [ ] **Archive** — completed tasks stored with a completion timestamp, plus the
      heading they lived under, so "what did I do on the 14th" is answerable
- [ ] Archive browser UI — group by day/week, search, restore a task back into
      the planner
- [ ] Undo for "clean planner" (destructive-feeling actions need an escape hatch)

### v3 — timer ↔ planner integration
- [x] ~~Daily/weekly stats: sessions completed, focus time~~ — shipped in v2
- [ ] Pick the timer's task from the planner's todos instead of retyping it
- [ ] Roll up total time per task name, so "how long did X actually take" is
      answerable across many sessions
- [ ] Carry pomodoro counts into the planner archive

### v4 — settings & quality of life
- [x] ~~Configurable long-break interval~~ — shipped in v1 (`longEvery`)
- [ ] Auto-start next phase (opt-in setting)
- [ ] Chime picker / volume / mute
- [ ] Keyboard shortcuts (space = start-pause, and friends)
- [ ] Export & import planner + session log as a `.md` / `.json` file — the real
      answer to "what if I clear my browser data". Now that there's a session
      history worth months of data, this matters more than it did at v1.
- [ ] Edit a logged session (fix a task name, correct a duration)
- [ ] PWA / offline support (`vite-plugin-pwa`)
- [ ] Light mode

### Ideas, unscheduled
- [ ] Multiple named planners / documents
- [ ] Ambient sound, or just a link across to noize
- [ ] Shareable planner via URL hash (still no backend)
- [ ] Markdown niceties: nested tasks, due dates, `@tags`

---

## Known risks

| Risk | Handling |
| --- | --- |
| `localStorage` is the only copy of the user's data | Export/import in v4; say so plainly in the UI. Now more pressing — the session log accumulates months of history that can't be reconstructed |
| Session log growing without bound | Capped at 2000 records (~years of heavy use), oldest dropped first |
| Browser notification permission is a hostile prompt if fired on load | Only request it when the user first starts a timer |
| Web Audio needs a user gesture before it can play | First `start` click unlocks the audio context |
| CodeMirror bundle size | Import only the modules used; no `codemirror` meta-package |
| Custom domain + sub-path asset paths | `base: "./"`, verified against a production build |

---

## Status

**Live at https://aryamans.me/pomopomo/.** Repo: `Aryaman73/pomopomo`, Pages
source set to GitHub Actions, custom domain inherited from
`aryaman73.github.io`.

- v1 — timers and planner (2026-07-29)
- v2 — session record, task names, history and stats (2026-07-29)

Next up is the clean-planner and archive block, which is the largest piece of
the original request still outstanding.
