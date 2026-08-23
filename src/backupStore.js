// ── Export / import ──────────────────────────────────────────────────────────
//
// localStorage is the only copy of anything in pomopomo. Between the session log
// and the planner archive there is history here that exists nowhere else and
// can't be reconstructed, so being able to get it out as a file is not a
// nice-to-have.
//
// What travels: the planner document, the dailies list with its rollover hour,
// the day it last reset and its day log, the archive, completion stamps, the
// session log, and the timer's phase lengths. What doesn't: anything about what's happening *right now* — which
// timer is showing, a running countdown's deadline, the task name in the input.
// A deadline is meaningless on another machine a week later, and restoring one
// would resurrect a "running" timer that finished long ago.

import { freeze, load, remove, save } from "./storage";
import {
  DAY_KEY,
  DOC_KEY,
  HOUR_KEY,
  clampHour,
  cleanLog,
  loadHour,
  loadLog,
  saveLog,
} from "./dailiesStore";
import { loadSessions, saveSessions } from "./sessions";
import { loadArchive, loadDoneMap, saveArchive, saveDoneMap } from "./archiveStore";

export const FORMAT = "pomopomo-backup";
export const VERSION = 2;

const RESULT_KEY = "pomopomo:importResult";

// ── Export ───────────────────────────────────────────────────────────────────

export function buildBackup() {
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      planner: load("planner", ""),
      dailies: load(DOC_KEY, ""),
      // The day the dailies last reset travels too, so a backup restored a week
      // later clears its ticks instead of adopting them as today's.
      dailiesDay: load(DAY_KEY, null),
      dailiesHour: loadHour(),
      dailiesLog: loadLog(),
      settings: load("settings", null),
      sessions: loadSessions(),
      archive: loadArchive(),
      done: loadDoneMap(),
    },
  };
}

export function backupFilename(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `pomopomo-backup-${stamp}.json`;
}

export function downloadBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFilename();
  // Firefox needs the anchor in the document for a programmatic click to count.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return json.length;
}

// ── Import: parsing and validation ───────────────────────────────────────────

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function cleanSessions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        isFiniteNumber(s.start) &&
        isFiniteNumber(s.ms) &&
        s.ms > 0
    )
    .map((s) => ({
      id: s.id,
      kind: s.kind === "countup" ? "countup" : "pomodoro",
      task: typeof s.task === "string" ? s.task.slice(0, 200) : "",
      start: s.start,
      end: isFiniteNumber(s.end) ? s.end : s.start + s.ms,
      ms: Math.round(s.ms),
      partial: !!s.partial,
      adjusted: !!s.adjusted,
    }));
}

function cleanArchive(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e.id === "string" && isFiniteNumber(e.doneAt))
    .map((e) => ({
      id: e.id,
      text: typeof e.text === "string" ? e.text : "",
      heading: typeof e.heading === "string" ? e.heading : "",
      doneAt: e.doneAt,
      archivedAt: isFiniteNumber(e.archivedAt) ? e.archivedAt : e.doneAt,
      estimated: !!e.estimated,
    }));
}

function cleanDone(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isFiniteNumber(value)) {
      out[key] = { at: value, observed: false };
    } else if (value && isFiniteNumber(value.at)) {
      out[key] = { at: value.at, observed: !!value.observed };
    }
  }
  return out;
}

function cleanSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // useTimer sanitizes and clamps these on load, so passing them through as
  // numbers is enough here.
  const out = {};
  for (const key of ["work", "short", "long", "longEvery"]) {
    if (isFiniteNumber(raw[key])) out[key] = raw[key];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Validate a backup file's text. Returns `{ error }` or `{ data, summary }`.
 * Deliberately tolerant of missing sections and strict about the envelope: a
 * file that isn't ours shouldn't get as far as overwriting anything.
 */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "That file isn't valid JSON." };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "That file doesn't contain a backup object." };
  }
  if (raw.format !== FORMAT) {
    return {
      error:
        "That doesn't look like a pomopomo backup. Expected a file exported from this app.",
    };
  }
  if (!isFiniteNumber(raw.version) || raw.version > VERSION) {
    return {
      error: `That backup was made by a newer version of pomopomo (format ${raw.version}). Update the page and try again.`,
    };
  }
  if (!raw.data || typeof raw.data !== "object") {
    return { error: "That backup has no data in it." };
  }

  const data = {
    planner: typeof raw.data.planner === "string" ? raw.data.planner : null,
    dailies: typeof raw.data.dailies === "string" ? raw.data.dailies : null,
    dailiesDay:
      typeof raw.data.dailiesDay === "string" ? raw.data.dailiesDay : null,
    dailiesHour: isFiniteNumber(raw.data.dailiesHour)
      ? clampHour(raw.data.dailiesHour)
      : null,
    dailiesLog: cleanLog(raw.data.dailiesLog),
    settings: cleanSettings(raw.data.settings),
    sessions: cleanSessions(raw.data.sessions),
    archive: cleanArchive(raw.data.archive),
    done: cleanDone(raw.data.done),
  };

  const empty =
    data.planner === null &&
    data.dailies === null &&
    !data.settings &&
    data.sessions.length === 0 &&
    data.archive.length === 0;
  if (empty) {
    return { error: "That backup is empty — nothing in it to import." };
  }

  const starts = data.sessions.map((s) => s.start);
  return {
    data,
    summary: {
      exportedAt: isFiniteNumber(Date.parse(raw.exportedAt))
        ? Date.parse(raw.exportedAt)
        : null,
      sessions: data.sessions.length,
      archive: data.archive.length,
      plannerChars: data.planner === null ? null : data.planner.length,
      dailiesChars: data.dailies === null ? null : data.dailies.length,
      dailiesDays: data.dailiesLog.length,
      hasSettings: !!data.settings,
      oldest: starts.length ? Math.min(...starts) : null,
      newest: starts.length ? Math.max(...starts) : null,
    },
  };
}

// ── Import: applying ─────────────────────────────────────────────────────────

// Ids are `${timestamp}-${sequence}` and the sequence restarts every page load,
// so two devices can in principle mint the same id. Merging also compares a
// content signature, which is what actually makes a record the same record.
const sessionSignature = (s) => `${s.kind}|${s.start}|${s.ms}|${s.task}`;
const archiveSignature = (e) => `${e.doneAt}|${e.heading}|${e.text}`;

function mergeRecords(existing, incoming, signature) {
  const ids = new Set(existing.map((r) => r.id));
  const signatures = new Set(existing.map(signature));
  const added = [];
  for (const record of incoming) {
    if (ids.has(record.id) || signatures.has(signature(record))) continue;
    ids.add(record.id);
    signatures.add(signature(record));
    added.push(record);
  }
  return { merged: [...existing, ...added], added: added.length };
}

function mergeDone(current, incoming) {
  const out = { ...current };
  for (const [key, stamp] of Object.entries(incoming)) {
    const have = out[key];
    if (!have) {
      out[key] = stamp;
      continue;
    }
    // An observed stamp was actually witnessed; a backfilled one is a guess.
    // Prefer the real one, and the earlier of two that are equally trustworthy.
    if (!have.observed && stamp.observed) out[key] = stamp;
    else if (have.observed === stamp.observed && stamp.at < have.at) {
      out[key] = stamp;
    }
  }
  return out;
}

/**
 * Write an imported backup. `mode` is "merge" or "replace".
 *
 * Merge only ever adds: it unions the session log, the archive and the dailies
 * day log, and leaves the planner, the dailies list and settings alone, because
 * a markdown document can't be merged with another one and silently picking a
 * winner would lose work.
 *
 * Replace overwrites all of it, and also clears live timer state — a running
 * countdown belonging to data that no longer exists would otherwise keep going
 * and log a session against the imported history.
 */
export function applyBackup(data, mode) {
  if (mode === "replace") {
    if (data.planner !== null) save("planner", data.planner);
    if (data.dailies !== null) {
      save(DOC_KEY, data.dailies);
      // No day in the file means an older backup that predates the dailies.
      // Clearing the marker makes the list adopt today rather than inherit a
      // day it never had, which would wipe the ticks that came with it.
      if (data.dailiesDay) save(DAY_KEY, data.dailiesDay);
      else remove(DAY_KEY);
    }
    if (data.dailiesHour !== null) save(HOUR_KEY, data.dailiesHour);
    saveLog(data.dailiesLog);
    if (data.settings) save("settings", data.settings);
    saveSessions(data.sessions);
    saveArchive(data.archive);
    saveDoneMap(data.done);
    remove("pomo");
    remove("countup");
    remove("tasks");
    return {
      mode,
      sessions: data.sessions.length,
      archive: data.archive.length,
      planner: data.planner !== null,
      dailies: data.dailies !== null,
      dailyDays: data.dailiesLog.length,
    };
  }

  const sessions = mergeRecords(loadSessions(), data.sessions, sessionSignature);
  const archive = mergeRecords(loadArchive(), data.archive, archiveSignature);
  // Days this browser has no record of. A day it *does* have a record of stays
  // as it is: this browser watched that day end, and the file's copy of it is
  // no better informed.
  const existing = loadLog();
  const days = new Set(existing.map((e) => e.day));
  const addedDays = data.dailiesLog.filter((e) => !days.has(e.day));
  saveLog(cleanLog([...existing, ...addedDays]));

  saveSessions(sessions.merged.sort((a, b) => b.start - a.start));
  saveArchive(archive.merged.sort((a, b) => b.doneAt - a.doneAt));
  saveDoneMap(mergeDone(loadDoneMap(), data.done));

  return {
    mode,
    sessions: sessions.added,
    archive: archive.added,
    planner: false,
    dailies: false,
    dailyDays: addedDays.length,
  };
}

/**
 * Apply, then reload. The reload is what makes this simple: every component
 * seeds its state from storage on mount, so re-reading it all at once avoids
 * threading an import through half a dozen `useState`s. Freezing storage first
 * stops the editor's unload flush from writing the old planner back over the
 * imported one.
 */
export function applyAndReload(data, mode) {
  const outcome = applyBackup(data, mode);
  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(outcome));
  } catch {
    /* the import still worked; we just won't be able to report on it */
  }
  freeze();
  window.location.reload();
}

/** Read and clear the one-shot result left for us across the reload. */
export function takeImportResult() {
  try {
    const raw = sessionStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RESULT_KEY);
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
