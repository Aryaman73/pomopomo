// ── The dailies list ─────────────────────────────────────────────────────────
//
// A short markdown document of things you do every day. The list itself is
// permanent — the only thing that ever changes on its own is the ticks, which
// clear when a new day starts.
//
// A "day" starts at 4am by default, not midnight. Work that runs to 1am is
// still tonight, and having the checklist reset itself out from under you while
// you're still up is the whole reason not to use midnight. The hour is settable
// and is local wall clock, deliberately: this is about the user's day.
//
// Closing a day writes what the list looked like when it ended, which is what
// the streak in the history panel counts.

import { dayKey, dayKeyToTime } from "./datetime";
import { countTasks, TASK_RE } from "./markdown";
import { load, save } from "./storage";

export const DOC_KEY = "dailies";
export const DAY_KEY = "dailiesDay";
export const HOUR_KEY = "dailiesHour";
export const LOG_KEY = "dailiesLog";

export const DEFAULT_HOUR = 4;

// Roughly a year. The log is one small object per day, and a streak nobody can
// remember starting isn't worth unbounded storage.
export const MAX_LOG = 400;

export const STARTER = `[] Drink some water
[] Move for twenty minutes
[] Read a few pages

The ticks clear when a new day starts. The list itself stays put.
`;

// ── The day boundary ─────────────────────────────────────────────────────────

export function clampHour(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : DEFAULT_HOUR;
}

export function loadHour() {
  return clampHour(load(HOUR_KEY, DEFAULT_HOUR));
}

export function saveHour(hour) {
  save(HOUR_KEY, clampHour(hour));
}

/**
 * Which day a moment belongs to. Anything before the rollover hour counts as
 * the day before, so 1:30am Tuesday is still Monday's list.
 *
 * Computed on the local calendar rather than by shifting the timestamp, so the
 * two days a year that aren't 24 hours long still roll over at the stated hour.
 */
export function dailyKey(now = Date.now(), hour = DEFAULT_HOUR) {
  const d = new Date(now);
  if (d.getHours() < hour) d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** The next instant at which the ticks are due to clear. */
export function nextRollover(now = Date.now(), hour = DEFAULT_HOUR) {
  const d = new Date(now);
  if (d.getHours() >= hour) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/** The day before `key`, in the same `YYYY-MM-DD` form. */
export function previousDay(key) {
  const d = new Date(dayKeyToTime(key));
  d.setDate(d.getDate() - 1);
  return dayKey(d.getTime());
}

/** Untick every task line, leaving the text — and everything else — alone. */
export function uncheckAll(docText) {
  return docText
    .split("\n")
    .map((line) => {
      const m = TASK_RE.exec(line);
      if (!m || m[2].toLowerCase() !== "x") return line;
      return `${m[1]}[]${line.slice(m[0].length)}`;
    })
    .join("\n");
}

/**
 * Close out the day if it has turned since we last looked. Returns the cleared
 * text and a record of the day that just ended, or null when there's nothing to
 * do — which is the common case, since this runs on a timer and on every return
 * to the tab.
 *
 * Records the new day as a side effect. A browser that has never seen this list
 * adopts today silently: there's no evidence those ticks belong to a day that
 * has already ended, and wiping them would be guessing with the user's data.
 */
export function loadDay() {
  const seen = load(DAY_KEY, null);
  return typeof seen === "string" ? seen : null;
}

export function applyRollover(docText, hour, now = Date.now()) {
  const today = dailyKey(now, hour);
  const seen = load(DAY_KEY, null);

  if (typeof seen !== "string") {
    save(DAY_KEY, today);
    return null;
  }

  // Days only ever move forwards. Pushing the rollover hour later in the day
  // can put "now" back inside a day already closed, and closing it a second
  // time would clear ticks made since. That day just runs long, once.
  if (today <= seen) return null;

  save(DAY_KEY, today);
  return {
    text: uncheckAll(docText),
    today,
    closed: { day: seen, ...countTasks(docText) },
  };
}

// ── The day log ──────────────────────────────────────────────────────────────

function isDay(entry) {
  return (
    entry &&
    typeof entry.day === "string" &&
    Number.isFinite(entry.done) &&
    Number.isFinite(entry.total)
  );
}

// Keys are `YYYY-MM-DD`, so lexicographic order is chronological order.
const byDayDescending = (a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0);

export function cleanLog(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .filter((e) => {
      if (!isDay(e) || seen.has(e.day)) return false;
      seen.add(e.day);
      return true;
    })
    .map((e) => ({
      day: e.day,
      done: Math.max(0, Math.round(e.done)),
      total: Math.max(0, Math.round(e.total)),
    }))
    .sort(byDayDescending)
    .slice(0, MAX_LOG);
}

export function loadLog() {
  return cleanLog(load(LOG_KEY, []));
}

export function saveLog(list) {
  save(LOG_KEY, list.slice(0, MAX_LOG));
}

export function addDay(list, entry) {
  return [entry, ...list.filter((e) => e.day !== entry.day)]
    .sort(byDayDescending)
    .slice(0, MAX_LOG);
}

// ── Streaks ──────────────────────────────────────────────────────────────────

/** A day counts only if there was something on the list and all of it got done. */
export function isComplete(entry) {
  return !!entry && entry.total > 0 && entry.done >= entry.total;
}

function index(log, todayKey, today) {
  const map = new Map(log.map((e) => [e.day, e]));
  // Today isn't in the log — it hasn't ended — so it comes from the live list.
  map.set(todayKey, { day: todayKey, done: today.done, total: today.total });
  return map;
}

/**
 * Consecutive complete days ending now. An unfinished today doesn't break a
 * streak that ran through yesterday: the day isn't over, and a counter that
 * resets to zero every morning would be worse than useless.
 */
export function currentStreak(log, todayKey, today) {
  const days = index(log, todayKey, today);
  let key = todayKey;
  let count = 0;

  if (isComplete(days.get(key))) count += 1;
  key = previousDay(key);

  while (isComplete(days.get(key))) {
    count += 1;
    key = previousDay(key);
  }
  return count;
}

/** The longest run of complete days on record, today included. */
export function bestStreak(log, todayKey, today) {
  const days = index(log, todayKey, today);
  const complete = [...days.values()]
    .filter(isComplete)
    .map((e) => e.day)
    .sort();

  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of complete) {
    run = previous && previousDay(day) === previous ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

/** The last `count` days, oldest first, for the strip in the history panel. */
export function recentDays(log, todayKey, today, count) {
  const days = index(log, todayKey, today);
  const out = [];
  let key = todayKey;
  for (let i = 0; i < count; i++) {
    out.push(days.get(key) || { day: key, done: 0, total: 0, unknown: true });
    key = previousDay(key);
  }
  return out.reverse();
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * The document as it should be right now, the day its ticks belong to, and the
 * day it closed on the way in. Used at mount, before the editor exists, so the
 * list is never briefly on screen still ticked from yesterday.
 */
export function loadDailies(hour, now = Date.now()) {
  const stored = load(DOC_KEY, STARTER);
  const text = typeof stored === "string" ? stored : STARTER;

  const rolled = applyRollover(text, hour, now);
  // Written now rather than left to the editor's save debounce: the new day has
  // already been recorded, and a document that lost the race would stay ticked
  // for good, because the next check would see nothing to do.
  if (rolled && rolled.text !== text) save(DOC_KEY, rolled.text);

  return {
    text: rolled ? rolled.text : text,
    closed: rolled ? rolled.closed : null,
    // Always the stored marker, never a freshly computed key: this is the day
    // the ticks on screen are attributed to, and the two disagree for a while
    // after the rollover hour is moved later in the day.
    day: loadDay(),
  };
}
