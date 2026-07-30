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
| Count-up **Finish** | Yes, whatever elapsed. The count-up has no natural end, so logging it is an explicit act |
| Count-up **Reset** | No — discards |

A session is filed under the day it *started*, in local time, so a stretch that
crosses midnight counts toward the evening it belongs to.

The phase-end handler is guarded against double-firing: it runs from both the
interval and the visibility-change catch-up, and `pomoRef` only refreshes on
render, so without the guard a catch-up call could advance and log the same
phase twice.

## v3 — clean planner and archive (shipped)

- [x] **Clean planner** — one button lifts every completed (`[x]`) task out of
      the document and files it in the archive
- [x] **Archive** — each task stored with its completion time and the heading
      path it lived under, so "what did I do on the 14th" is answerable
- [x] **Archive browser** — a tab in the planner panel: grouped by day, with a
      search box over both task text and heading
- [x] **Undo** — the clean is reversible, restoring both the document and the
      archive. Editing by hand afterwards invalidates it, since restoring the
      pre-clean text would silently throw that edit away.
- [x] Individual archived tasks can be deleted

### When was a task actually finished?

The interesting problem in this block. Markdown `[x]` carries no timestamp, and
writing one into the document would clutter text the user owns. So completion
times live in a side-car map (`pomopomo:done`), keyed on heading + task text and
**stamped the moment the box is ticked** — not when the planner is later cleaned.
Cleaning is tidying up and can happen days after the work; stamping then would
make the archive answer the wrong question.

Each stamp records `{ at, observed }`. `observed` is the honest bit:

- **true** — we watched the box get ticked. A real completion time.
- **false** — the task was already `[x]` the first time we saw the document
  (pre-existing planner, another browser). There's nothing better to use than
  "now", so that's stored, but the archive renders these with a `?` in amber
  rather than presenting a guess as a fact.

The first cut of this stamped the backfill as observed, which quietly defeated
the whole point of the flag — caught in testing.

Keying on text rather than line number means two identically worded tasks under
the same heading share a stamp. That's the accepted cost; keying on position
breaks the moment anything above the task is edited.

## v4 — export and import (shipped)

- [x] **export** downloads everything as `pomopomo-backup-YYYY-MM-DD.json`
- [x] **import** validates the file, shows what's in it, then offers two
      explicit choices rather than silently picking one
- [x] The privacy/durability notice removed with the footer now lives in the
      import panel, where it's actually relevant

### What travels, and what doesn't

In: the planner document, the archive, completion stamps, the session log, and
the timer's phase lengths.

Out: anything about what's happening *right now* — which timer is showing, a
running countdown's deadline, the task name in the input. A deadline is
meaningless on another machine a week later, and restoring one would resurrect a
"running" timer that finished long ago.

### Merge vs replace

Two modes, both named plainly, because neither is right for every case:

- **Merge** only ever adds: it unions the session log and archive and leaves the
  planner and settings alone. Two markdown documents can't be combined without
  losing one, so it doesn't try.
- **Replace** overwrites planner, settings, log and archive, and clears live
  timer state — a countdown belonging to data that no longer exists would
  otherwise keep running and log a session against the imported history.

Merge dedupes on record id *and* a content signature. Ids are
`${timestamp}-${sequence}` with the sequence restarting each page load, so two
devices can in principle mint the same id; the signature is what actually
establishes that two records are the same record.

Merging completion stamps prefers an `observed` stamp over a backfilled guess,
then the earlier of two equally trustworthy ones.

### The reload, and the flush that fights it

Importing writes to `localStorage` and reloads, because every component seeds its
state from storage on mount — re-reading it all at once beats threading an import
through a dozen `useState`s.

That collides with the editor's `beforeunload` flush, which would write the
document still on screen back over the planner just imported, making a planner
import look like it silently did nothing. `storage.freeze()` is called after the
import writes and before the reload, turning `save`/`remove` into no-ops so
nothing can overwrite the imported data on the way out.

## Backlog — everything else discussed, nothing dropped

### Archive follow-ups
- [ ] Restore an archived task back into the planner
- [ ] Group the archive by week as well as day
- [ ] Archive stats — tasks closed per day/week, alongside the focus-time chart

### v4 — timer ↔ planner integration
- [x] ~~Daily/weekly stats: sessions completed, focus time~~ — shipped in v2
- [ ] Pick the timer's task from the planner's todos instead of retyping it
- [ ] Roll up total time per task name, so "how long did X actually take" is
      answerable across many sessions
- [ ] Carry pomodoro counts into the planner archive

### v5 — settings & quality of life
- [x] ~~Configurable long-break interval~~ — shipped in v1 (`longEvery`)
- [ ] Auto-start next phase (opt-in setting)
- [ ] Chime picker / volume / mute
- [ ] Keyboard shortcuts (space = start-pause, and friends)
- [x] ~~Export & import~~ — shipped in v4
- [ ] Plain-markdown export of the planner alone, for reading outside pomopomo
      (the JSON backup is for round-tripping, not for reading)
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
| `localStorage` is the only copy of the user's data | Addressed in v4: **export** writes everything to a file, and the import panel says plainly that this browser holds the only copy. Backups are still manual — nothing prompts you to take one |
| Session log growing without bound | Capped at 2000 records (~years of heavy use), oldest dropped first |
| Archive growing without bound | Capped at 5000 entries, oldest dropped first |
| Two identically worded tasks under one heading share a completion stamp | Accepted; the alternative (keying on line number) breaks on any edit above the task |
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
- v3 — clean planner and archive (2026-07-29)
- v4 — export and import (2026-07-30)

Everything in the original request is shipped, and the data is no longer trapped
in one browser. What's left is polish: keyboard shortcuts, auto-start, editing a
logged session, PWA/offline, light mode.
