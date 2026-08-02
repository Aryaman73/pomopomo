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
import { dayKey, startOfDay, startOfWeek } from "./datetime";

const KEY = "sessions";

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

export function makeSession({
  kind,
  task,
  start,
  end,
  ms,
  partial = false,
  adjusted = false,
}) {
  sequence += 1;
  return {
    id: `${end}-${sequence}`,
    kind, // "pomodoro" | "countup"
    task: (task || "").trim().slice(0, 200),
    start,
    end,
    ms: Math.max(0, Math.round(ms)),
    partial,
    // The duration was typed in rather than measured. Kept so the record can
    // say which numbers it actually observed.
    adjusted,
  };
}

export function addSession(list, session) {
  return [session, ...list].slice(0, MAX_SESSIONS);
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
