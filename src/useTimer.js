import { useCallback, useEffect, useRef, useState } from "react";
import { load, save } from "./storage";
import {
  notify,
  playChime,
  requestNotificationPermission,
  unlockAudio,
} from "./alerts";

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
    };
  }
  return {
    phase: "work",
    round: p.round,
    running: false,
    deadline: null,
    remaining: phaseDuration(settings, "work"),
    started: false,
  };
}

function initialPomo(settings) {
  const fresh = {
    phase: "work",
    round: 0,
    running: false,
    deadline: null,
    remaining: phaseDuration(settings, "work"),
    started: false,
  };
  const saved = load("pomo", null);
  if (!saved || typeof saved.remaining !== "number") return fresh;

  const restored = { ...fresh, ...saved };

  // A running timer's deadline is absolute, so it kept counting while the tab
  // was closed. If it already elapsed, come back on the *next* phase rather
  // than chiming for something that finished an hour ago.
  if (restored.running && restored.deadline) {
    if (Date.now() >= restored.deadline) return advance(restored, settings);
    return { ...restored, remaining: restored.deadline - Date.now() };
  }
  return { ...restored, running: false, deadline: null };
}

// How long a gap still counts as "the page reloaded" rather than "I walked
// away". Under it, a running count-up resumes seamlessly; over it, the gap is
// discarded rather than silently billing you for the eight hours your laptop
// was shut. Either answer is defensible — folding the gap in *and* coming back
// paused is the one combination that isn't.
const COUNTUP_RESUME_GRACE = 5 * 60_000;

function initialCountup() {
  const saved = load("countup", null);
  const fresh = { running: false, base: 0, startedAt: null };
  if (!saved || typeof saved.base !== "number") return fresh;

  if (saved.running && saved.startedAt) {
    const gap = Date.now() - saved.startedAt;
    if (gap <= COUNTUP_RESUME_GRACE) {
      // Keep the clock running; `startedAt` is absolute so the gap is included.
      return { running: true, base: saved.base, startedAt: saved.startedAt };
    }
    return { running: false, base: saved.base, startedAt: null };
  }
  return { ...fresh, base: saved.base };
}

export function useTimer() {
  const [settings, setSettings] = useState(() =>
    sanitizeSettings(load("settings", null))
  );
  const [mode, setMode] = useState(() =>
    load("mode", "pomodoro") === "countup" ? "countup" : "pomodoro"
  );
  const [pomo, setPomo] = useState(() => initialPomo(sanitizeSettings(load("settings", null))));
  const [countup, setCountup] = useState(initialCountup);

  // Refs mirror state so the interval callback always sees current values
  // without needing to be torn down and rebuilt on every tick.
  const pomoRef = useRef(pomo);
  pomoRef.current = pomo;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
      const ended = p.phase;
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
      return { ...p, running: true, started: true, remaining, deadline: Date.now() + remaining };
    });
  }, [mode, settings]);

  const pause = useCallback(() => {
    if (mode === "countup") {
      setCountup((c) =>
        c.running
          ? { running: false, base: c.base + (Date.now() - c.startedAt), startedAt: null }
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

  const reset = useCallback(() => {
    if (mode === "countup") {
      setCountup({ running: false, base: 0, startedAt: null });
      return;
    }
    setPomo((p) => ({
      ...p,
      running: false,
      deadline: null,
      started: false,
      remaining: phaseDuration(settingsRef.current, p.phase),
    }));
  }, [mode]);

  // Jump to the next phase without chiming — this was the user's choice, they
  // don't need to be told about it.
  const skip = useCallback(() => {
    setPomo((p) => advance(p, settingsRef.current));
  }, []);

  const resetCycle = useCallback(() => {
    setPomo({
      phase: "work",
      round: 0,
      running: false,
      deadline: null,
      remaining: phaseDuration(settingsRef.current, "work"),
      started: false,
    });
  }, []);

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
    progress: total > 0 ? 1 - pomoRemaining / total : 0,

    start,
    pause,
    toggle,
    reset,
    skip,
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
