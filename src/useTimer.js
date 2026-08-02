import { useCallback, useEffect, useRef, useState } from "react";
import { load, save } from "./storage";
import {
  notify,
  playChime,
  requestNotificationPermission,
  unlockAudio,
} from "./alerts";
import {
  addSession,
  loadSessions,
  makeSession,
  MIN_PARTIAL_MS,
  saveSessions,
} from "./sessions";

const MIN = 60_000;

export const DEFAULT_SETTINGS = {
  work: 25,
  short: 5,
  long: 15,
  longEvery: 4, // a long break after every N work sessions
};

export const PHASE_LABEL = {
  work: "focus",
  short: "short break",
  long: "long break",
};

const phaseMinutes = (s, phase) =>
  phase === "work" ? s.work : phase === "short" ? s.short : s.long;

const phaseDuration = (s, phase) => phaseMinutes(s, phase) * MIN;

function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  };
  return {
    work: clamp(s.work, 1, 180, DEFAULT_SETTINGS.work),
    short: clamp(s.short, 1, 60, DEFAULT_SETTINGS.short),
    long: clamp(s.long, 1, 120, DEFAULT_SETTINGS.long),
    longEvery: clamp(s.longEvery, 2, 12, DEFAULT_SETTINGS.longEvery),
  };
}

// Move to the phase that follows `p`. Always lands paused — auto-start is a
// deliberate non-feature for v1, so a break never starts without you noticing.
function advance(p, settings) {
  if (p.phase === "work") {
    const round = p.round + 1;
    const phase = round % settings.longEvery === 0 ? "long" : "short";
    return {
      phase,
      round,
      running: false,
      deadline: null,
      remaining: phaseDuration(settings, phase),
      started: false,
      startedAt: null,
    };
  }
  return {
    phase: "work",
    round: p.round,
    running: false,
    deadline: null,
    remaining: phaseDuration(settings, "work"),
    started: false,
    startedAt: null,
  };
}

function loadTasks() {
  const raw = load("tasks", null);
  return {
    pomodoro: typeof raw?.pomodoro === "string" ? raw.pomodoro : "",
    countup: typeof raw?.countup === "string" ? raw.countup : "",
  };
}

// Returns the restored timer *and* any session that completed while the tab was
// closed. The recovery case matters more than it looks: a pomodoro finishing
// unattended is the normal case for anyone who starts one and walks away, and
// without this every such session would vanish from the record.
function restorePomo(settings) {
  const fresh = {
    phase: "work",
    round: 0,
    running: false,
    deadline: null,
    remaining: phaseDuration(settings, "work"),
    started: false,
    startedAt: null,
  };
  const saved = load("pomo", null);
  if (!saved || typeof saved.remaining !== "number") {
    return { pomo: fresh, recovered: null };
  }

  const restored = { ...fresh, ...saved };

  // A running timer's deadline is absolute, so it kept counting while the tab
  // was closed. If it already elapsed, come back on the *next* phase rather
  // than chiming for something that finished an hour ago.
  if (restored.running && restored.deadline) {
    if (Date.now() >= restored.deadline) {
      const ms = phaseDuration(settings, "work");
      const recovered =
        restored.phase === "work"
          ? makeSession({
              kind: "pomodoro",
              task: loadTasks().pomodoro,
              start: restored.startedAt || restored.deadline - ms,
              end: restored.deadline,
              ms,
            })
          : null;
      return { pomo: advance(restored, settings), recovered };
    }
    return {
      pomo: { ...restored, remaining: restored.deadline - Date.now() },
      recovered: null,
    };
  }
  return { pomo: { ...restored, running: false, deadline: null }, recovered: null };
}

// How long a gap still counts as "the page reloaded" rather than "I walked
// away". Under it, a running count-up resumes seamlessly; over it, the gap is
// discarded rather than silently billing you for the eight hours your laptop
// was shut. Either answer is defensible — folding the gap in *and* coming back
// paused is the one combination that isn't.
const COUNTUP_RESUME_GRACE = 5 * 60_000;

// A ceiling on a hand-set count-up. Anything past this is a typo, not a
// work session.
export const MAX_COUNTUP_MS = 24 * 60 * 60_000;

function initialCountup() {
  const saved = load("countup", null);
  const fresh = { running: false, base: 0, startedAt: null, adjusted: false };
  if (!saved || typeof saved.base !== "number") return fresh;

  const adjusted = !!saved.adjusted;
  if (saved.running && saved.startedAt) {
    const gap = Date.now() - saved.startedAt;
    if (gap <= COUNTUP_RESUME_GRACE) {
      // Keep the clock running; `startedAt` is absolute so the gap is included.
      return { running: true, base: saved.base, startedAt: saved.startedAt, adjusted };
    }
    return { running: false, base: saved.base, startedAt: null, adjusted };
  }
  return { ...fresh, base: saved.base, adjusted };
}

export function useTimer() {
  const [settings, setSettings] = useState(() =>
    sanitizeSettings(load("settings", null))
  );
  const [mode, setMode] = useState(() =>
    load("mode", "pomodoro") === "countup" ? "countup" : "pomodoro"
  );
  const [boot] = useState(() => restorePomo(sanitizeSettings(load("settings", null))));
  const [pomo, setPomo] = useState(boot.pomo);
  const [countup, setCountup] = useState(initialCountup);
  const [tasks, setTasks] = useState(loadTasks);
  const [sessions, setSessions] = useState(() => {
    const list = loadSessions();
    return boot.recovered ? addSession(list, boot.recovered) : list;
  });

  // Refs mirror state so the interval callback always sees current values
  // without needing to be torn down and rebuilt on every tick.
  const pomoRef = useRef(pomo);
  pomoRef.current = pomo;
  const countupRef = useRef(countup);
  countupRef.current = countup;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const logSession = useCallback((session) => {
    setSessions((list) => addSession(list, session));
  }, []);

  // `step` runs from both the interval and the visibilitychange handler, and
  // `pomoRef` only refreshes on render — so without this, a catch-up call can
  // land on the same expired deadline and advance (and log) the phase twice.
  const handledDeadline = useRef(null);

  // ── Ticking ─────────────────────────────────────────────────────────────
  // Display time is always derived from an absolute deadline, never from
  // accumulated ticks. Background tabs get throttled hard; a tick-counting
  // timer would silently lose minutes.
  // Note this is deliberately *not* gated on the visible mode. Switching to the
  // count-up to check something must not silently stop a running pomodoro from
  // alerting — you'd come back to a session that claims to be running and
  // finished twenty minutes ago. The two timers run independently; `mode` only
  // decides which one you're looking at.
  useEffect(() => {
    if (!pomo.running) return undefined;

    const step = () => {
      const p = pomoRef.current;
      if (!p.running || !p.deadline) return;
      const left = p.deadline - Date.now();
      if (left > 0) {
        setPomo({ ...p, remaining: left });
        return;
      }
      if (handledDeadline.current === p.deadline) return;
      handledDeadline.current = p.deadline;

      const ended = p.phase;

      // Only focus phases go in the record, and the session is stamped with the
      // scheduled deadline rather than `Date.now()` — a throttled tab can fire
      // this seconds late, and the session didn't run those extra seconds.
      if (ended === "work") {
        const ms = phaseDuration(settingsRef.current, "work");
        logSession(
          makeSession({
            kind: "pomodoro",
            task: tasksRef.current.pomodoro,
            start: p.startedAt || p.deadline - ms,
            end: p.deadline,
            ms,
          })
        );
      }

      const next = advance(p, settingsRef.current);
      setPomo(next);
      playChime(ended === "work" ? "work" : "break");
      notify(
        ended === "work" ? "Focus session done" : "Break's over",
        ended === "work"
          ? `Time for a ${PHASE_LABEL[next.phase]} — ${phaseMinutes(
              settingsRef.current,
              next.phase
            )} min.`
          : `Back to it — ${phaseMinutes(settingsRef.current, "work")} min of focus.`
      );
    };

    const id = setInterval(step, 250);
    // Throttled background tabs can fire the interval seconds late. Catch up
    // the moment the tab is looked at again.
    const onVisible = () => {
      if (document.visibilityState === "visible") step();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pomo.running]);

  // The count-up has nothing to fire, it just needs re-rendering. Its elapsed
  // time is derived from `startedAt`, so it stays correct even unrendered.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!countup.running) return undefined;
    const id = setInterval(() => bump((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [countup.running]);

  // ── Persistence ─────────────────────────────────────────────────────────
  useEffect(() => save("settings", settings), [settings]);
  useEffect(() => save("mode", mode), [mode]);

  // Deliberately not keyed on `remaining` — while running it changes 4x/sec and
  // is fully recoverable from `deadline`. While paused, the transition to
  // running:false fires this effect with the frozen value.
  useEffect(() => {
    save("pomo", pomoRef.current);
  }, [pomo.phase, pomo.round, pomo.running, pomo.deadline, pomo.started]);

  useEffect(() => {
    save("countup", countup);
  }, [countup]);

  useEffect(() => saveSessions(sessions), [sessions]);
  useEffect(() => save("tasks", tasks), [tasks]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const start = useCallback(() => {
    // Both of these need a user gesture, and this is the only one guaranteed to
    // happen before a phase ends unattended.
    unlockAudio();
    requestNotificationPermission();

    if (mode === "countup") {
      setCountup((c) => (c.running ? c : { ...c, running: true, startedAt: Date.now() }));
      return;
    }
    setPomo((p) => {
      if (p.running) return p;
      const remaining = p.remaining > 0 ? p.remaining : phaseDuration(settings, p.phase);
      return {
        ...p,
        running: true,
        started: true,
        // Set once per phase, so resuming from a pause doesn't restamp when the
        // session began.
        startedAt: p.startedAt || Date.now(),
        remaining,
        deadline: Date.now() + remaining,
      };
    });
  }, [mode, settings]);

  const pause = useCallback(() => {
    if (mode === "countup") {
      setCountup((c) =>
        c.running
          ? {
              ...c,
              running: false,
              base: c.base + (Date.now() - c.startedAt),
              startedAt: null,
            }
          : c
      );
      return;
    }
    setPomo((p) =>
      p.running
        ? {
            ...p,
            running: false,
            remaining: Math.max(0, p.deadline - Date.now()),
            deadline: null,
          }
        : p
    );
  }, [mode]);

  const toggle = useCallback(() => {
    const running = mode === "countup" ? countup.running : pomo.running;
    if (running) pause();
    else start();
  }, [mode, countup.running, pomo.running, pause, start]);

  // Reset is the escape hatch: it discards the current stretch rather than
  // logging it. If you want partial credit, use Skip.
  const reset = useCallback(() => {
    if (mode === "countup") {
      // A fresh timer, so it's no longer carrying a hand-set duration.
      setCountup({ running: false, base: 0, startedAt: null, adjusted: false });
      return;
    }
    setPomo((p) => ({
      ...p,
      running: false,
      deadline: null,
      started: false,
      startedAt: null,
      remaining: phaseDuration(settingsRef.current, p.phase),
    }));
  }, [mode]);

  // Jump to the next phase without chiming — this was the user's choice, they
  // don't need to be told about it. Bailing out of a focus phase still logs the
  // work actually done, so long as it was more than a mis-click's worth.
  // Reading through the ref rather than a functional updater keeps the logging
  // out of a state updater, which React is free to run twice.
  const skip = useCallback(() => {
    const p = pomoRef.current;
    if (p.phase === "work" && p.started) {
      const total = phaseDuration(settingsRef.current, "work");
      const left = p.running ? Math.max(0, p.deadline - Date.now()) : p.remaining;
      const done = total - left;
      if (done >= MIN_PARTIAL_MS) {
        const end = Date.now();
        logSession(
          makeSession({
            kind: "pomodoro",
            task: tasksRef.current.pomodoro,
            start: p.startedAt || end - done,
            end,
            ms: done,
            partial: true,
          })
        );
      }
    }
    setPomo(advance(p, settingsRef.current));
  }, [logSession]);

  // A count-up has no natural end, so logging it is an explicit act. Reset
  // stays a discard — without both, there'd be no way to say "that one didn't
  // count".
  const logCountup = useCallback(() => {
    const c = countupRef.current;
    const ms = c.running ? c.base + (Date.now() - c.startedAt) : c.base;
    if (ms < 1000) return;
    const end = Date.now();
    logSession(
      makeSession({
        kind: "countup",
        task: tasksRef.current.countup,
        // Approximate: pauses aren't subtracted from the span, but `ms` — the
        // number that actually counts — only ever includes running time.
        start: end - ms,
        end,
        ms,
        adjusted: c.adjusted,
      })
    );
    setCountup({ running: false, base: 0, startedAt: null, adjusted: false });
  }, [logSession]);

  /**
   * Set the count-up's elapsed time by hand. For the one case that actually
   * needs it: a timer left running through lunch, where the clock is now wrong
   * and the alternative is losing the session or logging a fiction.
   *
   * Every session logged from a hand-set timer is flagged, and the flag shows in
   * the history. That's deliberate — the point of the record is that it reflects
   * work that happened, so a number you typed shouldn't be indistinguishable
   * from one the clock measured.
   */
  const adjustCountup = useCallback((ms) => {
    const c = countupRef.current;
    const current = c.running ? c.base + (Date.now() - c.startedAt) : c.base;
    const next = Math.max(0, Math.min(Math.round(ms), MAX_COUNTUP_MS));
    setCountup({
      running: c.running,
      base: next,
      // Re-anchor a running timer so it carries on from the corrected total
      // instead of jumping back to the old one on the next tick.
      startedAt: c.running ? Date.now() : null,
      // Applying the value it already had isn't an adjustment.
      adjusted: c.adjusted || Math.abs(next - current) >= 1000,
    });
  }, []);

  const resetCycle = useCallback(() => {
    setPomo({
      phase: "work",
      round: 0,
      running: false,
      deadline: null,
      remaining: phaseDuration(settingsRef.current, "work"),
      started: false,
      startedAt: null,
    });
  }, []);

  const setTask = useCallback(
    (value) => setTasks((t) => ({ ...t, [mode]: value })),
    [mode]
  );

  const removeSession = useCallback(
    (id) => setSessions((list) => list.filter((s) => s.id !== id)),
    []
  );

  const clearSessions = useCallback(() => setSessions([]), []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = sanitizeSettings({ ...prev, ...patch });
      // Re-length the current phase only if it's sitting untouched at the
      // starting line. A session paused partway through keeps its remaining
      // time — silently discarding 12 minutes of a pause would be rude.
      setPomo((p) =>
        p.running || p.started ? p : { ...p, remaining: phaseDuration(next, p.phase) }
      );
      return next;
    });
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────
  const pomoRemaining = pomo.running
    ? Math.max(0, pomo.deadline - Date.now())
    : pomo.remaining;

  const countupElapsed = countup.running
    ? countup.base + (Date.now() - countup.startedAt)
    : countup.base;

  const total = phaseDuration(settings, pomo.phase);

  return {
    mode,
    setMode,
    settings,
    updateSettings,

    phase: pomo.phase,
    round: pomo.round,
    running: mode === "countup" ? countup.running : pomo.running,
    // The timer you're *not* looking at, if it's still going. Without surfacing
    // this, a background timer is completely invisible.
    otherRunning: mode === "countup" ? pomo.running : countup.running,
    remaining: pomoRemaining,
    elapsed: countupElapsed,
    countupAdjusted: countup.adjusted,
    progress: total > 0 ? 1 - pomoRemaining / total : 0,

    task: tasks[mode],
    setTask,

    sessions,
    removeSession,
    clearSessions,

    start,
    pause,
    toggle,
    reset,
    skip,
    logCountup,
    adjustCountup,
    resetCycle,
  };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
