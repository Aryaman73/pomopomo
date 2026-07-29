// ── The session log ──────────────────────────────────────────────────────────
//
// One record per stretch of *work*. Breaks are never recorded — the question
// this data answers is "how much did I actually do", and a break isn't part of
// that answer.
//
// All bucketing is in the viewer's local timezone, and a session is filed under
// the day it *started*. A session that runs across midnight counts toward the
// evening it belongs to, which is what anyone looking at their own day expects.

import { load, save } from "./storage";

const KEY = "sessions";
const DAY_MS = 86_400_000;

// Bound the log. A record is ~110 bytes, so this is a rounding error against
// any localStorage quota, and 2000 sessions is several years of heavy use.
export const MAX_SESSIONS = 2000;

// Skipping out of a focus phase still logs the work you did, but only if it was
// long enough to be real rather than a mis-click.
export const MIN_PARTIAL_MS = 60_000;

function isSession(s) {
  return (
    s &&
    typeof s.id === "string" &&
    typeof s.start === "number" &&
    typeof s.ms === "number" &&
    s.ms > 0
  );
}

export function loadSessions() {
  const raw = load(KEY, []);
  if (!Array.isArray(raw)) return [];
  // Newest first, which is both how the list renders and how trimming to
  // MAX_SESSIONS should drop the oldest.
  return raw.filter(isSession).sort((a, b) => b.start - a.start);
}

export function saveSessions(list) {
  save(KEY, list.slice(0, MAX_SESSIONS));
}

let sequence = 0;

export function makeSession({ kind, task, start, end, ms, partial = false }) {
  sequence += 1;
  return {
    id: `${end}-${sequence}`,
    kind, // "pomodoro" | "countup"
    task: (task || "").trim().slice(0, 200),
    start,
    end,
    ms: Math.max(0, Math.round(ms)),
    partial,
  };
}

export function addSession(list, session) {
  return [session, ...list].slice(0, MAX_SESSIONS);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Weeks run Monday → Sunday. */
export function startOfWeek(ts) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** A stable local-calendar key. Not an ISO instant — deliberately timezone-local. */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function emptyBuckets(anchors) {
  const buckets = anchors.map((at) => ({ key: dayKey(at), at, ms: 0, count: 0 }));
  return { buckets, index: new Map(buckets.map((b) => [b.key, b])) };
}

export function bucketsByDay(sessions, days) {
  const today = startOfDay(Date.now());
  const anchors = [];
  for (let i = days - 1; i >= 0; i--) {
    // Step by calendar date rather than subtracting 24h, so DST changes don't
    // shift a bucket onto the wrong day.
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    anchors.push(d.getTime());
  }
  const { buckets, index } = emptyBuckets(anchors);
  for (const s of sessions) {
    const b = index.get(dayKey(s.start));
    if (b) {
      b.ms += s.ms;
      b.count += 1;
    }
  }
  return buckets;
}

export function bucketsByWeek(sessions, weeks) {
  const thisWeek = startOfWeek(Date.now());
  const anchors = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - i * 7);
    anchors.push(d.getTime());
  }
  const { buckets, index } = emptyBuckets(anchors);
  for (const s of sessions) {
    const b = index.get(dayKey(startOfWeek(s.start)));
    if (b) {
      b.ms += s.ms;
      b.count += 1;
    }
  }
  return buckets;
}

export function totalSince(sessions, from) {
  let ms = 0;
  let count = 0;
  for (const s of sessions) {
    if (s.start >= from) {
      ms += s.ms;
      count += 1;
    }
  }
  return { ms, count };
}

export function totalAll(sessions) {
  let ms = 0;
  for (const s of sessions) ms += s.ms;
  return { ms, count: sessions.length };
}

/** Sessions (newest first) split into consecutive day groups for the list view. */
export function groupByDay(sessions) {
  const groups = [];
  let current = null;
  for (const s of sessions) {
    const key = dayKey(s.start);
    if (!current || current.key !== key) {
      current = { key, at: startOfDay(s.start), ms: 0, items: [] };
      groups.push(current);
    }
    current.items.push(s);
    current.ms += s.ms;
  }
  return groups;
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatDuration(ms) {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDayLabel(at) {
  const diff = Math.round((startOfDay(Date.now()) - startOfDay(at)) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Compact axis label for the day chart — "Mon 28". */
export function formatDayTick(at) {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
  });
}

/** Compact axis label for the week chart — "28 Jul". */
export function formatWeekTick(at) {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function formatTimeOfDay(ts) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
