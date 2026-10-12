// ── Merging two devices' data ────────────────────────────────────────────────
//
// Every merge is three-way: this device's data, the server's, and the *base* —
// what the two last agreed on, the last time this device synced. The base is
// what makes deletion work. Without it, a session deleted on the laptop is just
// a session the phone has and the laptop doesn't, and a plain union would bring
// it straight back. With it, "in the base, gone here" means deleted here.
//
// A device that has never synced has no base. That's joining, and joining
// takes the documents from the devices already syncing — see `mergeSnapshots`.
//
// Everything in here is pure: snapshots in, a snapshot out. Reading and writing
// storage, the network and the crypto all live in sync.js.

import { addDay, cleanLog, uncheckAll } from "./dailiesStore";
import { countTasks } from "./markdown";
import { MAX_SESSIONS } from "./sessions";
import { MAX_ARCHIVE } from "./archiveStore";

// Conflict copies are a safety net, not a history. A handful is plenty.
export const MAX_CONFLICTS = 20;

/** JSON with sorted keys, so equal data always compares equal as a string. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const same = (a, b) => stable(a) === stable(b);

// Newest first, as everywhere else in the app — and then by id, so records that
// share a timestamp still come out in one order on every device. Without the
// tie-break, two devices could each keep "correcting" the other's order and
// push the same data back and forth forever. Backfilled completion times share
// a timestamp routinely.
const newestFirst = (at) => (x, y) => at(y) - at(x) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
export const bySessionStart = newestFirst((s) => s.start);
export const byDoneAt = newestFirst((e) => e.doneAt);
export const byCopiedAt = newestFirst((c) => c.at);

// ── Text ─────────────────────────────────────────────────────────────────────
//
// diff3 over lines. The planner and the dailies list are the same document on
// every device, edited on whichever one is in hand, so most merges are one side
// changed and the other didn't. The interesting case is both: a tick on the
// phone while offline, a new task on the laptop.

// Past this, the line-matching table gets big enough to stall the page. A
// document that size merges as a conflict instead, which loses nothing.
const MAX_CELLS = 2_000_000;

/**
 * For each line of `base`, the index of the line it's matched with in `other`
 * by longest common subsequence, or -1. Common runs at either end are matched
 * up front, which in practice shrinks the table to the few lines that changed.
 */
function matchLines(base, other) {
  const match = new Array(base.length).fill(-1);

  let start = 0;
  while (start < base.length && start < other.length && base[start] === other[start]) {
    match[start] = start;
    start += 1;
  }

  let endB = base.length;
  let endO = other.length;
  while (endB > start && endO > start && base[endB - 1] === other[endO - 1]) {
    endB -= 1;
    endO -= 1;
    match[endB] = endO;
  }

  const rows = endB - start;
  const cols = endO - start;
  if (rows === 0 || cols === 0) return match;
  if (rows * cols > MAX_CELLS) return null;

  // lcs[i * w + j]: the longest common subsequence of base[start + i..endB) and
  // other[start + j..endO). Built backwards so the walk below can go forwards.
  const w = cols + 1;
  const lcs = new Uint32Array((rows + 1) * w);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lcs[i * w + j] =
        base[start + i] === other[start + j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (base[start + i] === other[start + j]) {
      match[start + i] = start + j;
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return match;
}

const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

/**
 * One region where the base, this device and the other one don't all agree.
 * Returns the lines to use, or null when the two sides really do clash.
 */
function mergeChunk(base, mine, theirs) {
  if (sameLines(mine, base)) return theirs;
  if (sameLines(theirs, base)) return mine;
  if (sameLines(mine, theirs)) return mine;

  // Both sides added lines at the same spot and neither removed anything. For a
  // task list that's two new tasks, and keeping both is obviously right.
  if (base.length === 0) return [...mine, ...theirs];

  // The same lines on both sides, changed differently — usually ticks on two
  // neighbouring tasks. Line by line, those don't clash at all.
  if (mine.length === base.length && theirs.length === base.length) {
    const out = [];
    for (let k = 0; k < base.length; k++) {
      if (mine[k] === base[k]) out.push(theirs[k]);
      else if (theirs[k] === base[k] || theirs[k] === mine[k]) out.push(mine[k]);
      else return null;
    }
    return out;
  }

  return null;
}

/**
 * Three-way merge of a document. Returns the merged text, or null when both
 * sides changed the same lines in different ways and there's no honest way to
 * pick — the caller keeps one whole and saves the other as a copy.
 */
export function mergeText(base, mine, theirs) {
  if (mine === theirs) return mine;
  if (mine === base) return theirs;
  if (theirs === base) return mine;

  const O = base.split("\n");
  const A = mine.split("\n");
  const B = theirs.split("\n");
  const mA = matchLines(O, A);
  const mB = matchLines(O, B);
  if (!mA || !mB) return null;

  const out = [];
  let i = 0;
  let a = 0;
  let b = 0;

  for (;;) {
    // A run all three agree on.
    while (i < O.length && mA[i] === a && mB[i] === b) {
      out.push(O[i]);
      i += 1;
      a += 1;
      b += 1;
    }
    if (i >= O.length && a >= A.length && b >= B.length) break;

    // The next base line both sides still have marks where they agree again.
    let j = i;
    while (j < O.length && (mA[j] < 0 || mB[j] < 0)) j += 1;
    const endA = j < O.length ? mA[j] : A.length;
    const endB = j < O.length ? mB[j] : B.length;

    const merged = mergeChunk(O.slice(i, j), A.slice(a, endA), B.slice(b, endB));
    if (!merged) return null;
    out.push(...merged);

    i = j;
    a = endA;
    b = endB;
  }

  return out.join("\n");
}

// ── Records ──────────────────────────────────────────────────────────────────

/**
 * Three-way merge of two keyed maps. Something removed on one side and left
 * alone on the other is gone; something removed on one side and changed on the
 * other survives, because the change is the more recent intent. Two different
 * changes to the same key go to `resolve`.
 */
export function mergeMaps(base, mine, theirs, resolve) {
  const out = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  for (const key of keys) {
    const o = base[key];
    const a = mine[key];
    const b = theirs[key];

    let value;
    if (same(a, b)) value = a;
    else if (same(a, o)) value = b;
    else if (same(b, o)) value = a;
    else if (a === undefined) value = b;
    else if (b === undefined) value = a;
    else value = resolve(a, b);

    if (value !== undefined) out[key] = value;
  }
  return out;
}

const keyed = (list, key) => Object.fromEntries(list.map((r) => [key(r), r]));

// Ids alone aren't quite enough: they're `${timestamp}-${sequence}` with the
// sequence restarting every page load, so two devices can in principle mint the
// same one. Folding in the content makes a collision a non-issue.
const sessionKey = (s) => `${s.id}|${s.kind}|${s.start}|${s.ms}|${s.task}`;
const archiveKey = (e) => `${e.id}|${e.doneAt}|${e.heading}|${e.text}`;

function mergeList(base, mine, theirs, key) {
  const merged = mergeMaps(
    keyed(base, key),
    keyed(mine, key),
    keyed(theirs, key),
    (a) => a
  );
  return Object.values(merged);
}

// An observed stamp was actually witnessed; a backfilled one is a guess. Prefer
// the real one, and the earlier of two that are equally trustworthy. The same
// rule an import uses.
function preferStamp(a, b) {
  if (a.observed !== b.observed) return a.observed ? a : b;
  return b.at < a.at ? b : a;
}

// Two devices that both closed the same day saw the list at different moments.
// The one that saw more ticks saw more of the day.
function preferDay(a, b) {
  if (a.done !== b.done) return a.done > b.done ? a : b;
  return a.total >= b.total ? a : b;
}

// ── Whole snapshots ──────────────────────────────────────────────────────────

const newer = (a, b) => (a || 0) >= (b || 0);

/** Small, stable string hash, so the same conflict copy is only ever kept once. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The dailies ticks belong to a day. When one side has moved on to a later day
 * than the other, the stale side's ticks are from a day that's over, and
 * merging them in would carry yesterday's ticks into today. So the stale side
 * is closed first, exactly as its own rollover would have — the day goes in its
 * log, the ticks clear — and then the two are merged like for like.
 */
function rollTo(snap, day, { log }) {
  if (!snap || !day || !snap.dailiesDay || snap.dailiesDay >= day) return snap;
  const rolled = { ...snap, dailies: uncheckAll(snap.dailies), dailiesDay: day };
  if (log && !snap.dailiesLog.some((e) => e.day === snap.dailiesDay)) {
    rolled.dailiesLog = addDay(snap.dailiesLog, {
      day: snap.dailiesDay,
      ...countTasks(snap.dailies),
    });
  }
  return rolled;
}

const maxDay = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Merge this device's snapshot with the server's. `base` is the last snapshot
 * the two agreed on, or null when this device is joining for the first time.
 *
 * `pristine` maps each document to the starter text a fresh install shows, so a
 * device that never wrote anything of its own doesn't leave a "conflict copy"
 * of the welcome text behind when it joins.
 *
 * Returns the merged snapshot and how many conflict copies it had to make.
 */
export function mergeSnapshots(base, mine, theirs, { now = Date.now(), pristine = {} } = {}) {
  const joining = base === null;
  const day = maxDay(mine.dailiesDay, theirs.dailiesDay);
  const O = rollTo(base, day, { log: false });
  const A = rollTo(mine, day, { log: true });
  const B = rollTo(theirs, day, { log: true });

  const edited = { ...A.edited };
  for (const [field, at] of Object.entries(B.edited)) {
    if (!newer(edited[field], at)) edited[field] = at;
  }

  const copies = [];

  function mergeDocument(field) {
    const a = A[field];
    const b = B[field];
    if (a === b) return a;

    if (!joining) {
      const merged = mergeText(O[field], a, b);
      if (merged !== null) return merged;
    }

    // A real clash. Joining takes the document the other devices already share;
    // otherwise the one edited most recently wins. Either way the other is kept.
    const keepMine = !joining && newer(A.edited[field], B.edited[field]);
    const loser = keepMine ? b : a;
    if (loser.trim() !== "" && loser !== pristine[field]) {
      copies.push({ id: `${field}-${hash(loser)}`, field, text: loser, at: now });
    }
    return keepMine ? a : b;
  }

  function value(field) {
    const a = A[field];
    const b = B[field];
    if (same(a, b)) return a;
    if (joining) return b ?? a;
    if (same(a, O[field])) return b;
    if (same(b, O[field])) return a;
    return newer(A.edited[field], B.edited[field]) ? a : b;
  }

  const planner = mergeDocument("planner");
  const dailies = mergeDocument("dailies");

  const sessions = mergeList(O?.sessions || [], A.sessions, B.sessions, sessionKey)
    .sort(bySessionStart)
    .slice(0, MAX_SESSIONS);

  const archive = mergeList(O?.archive || [], A.archive, B.archive, archiveKey)
    .sort(byDoneAt)
    .slice(0, MAX_ARCHIVE);

  const done = mergeMaps(O?.done || {}, A.done, B.done, preferStamp);

  const dailiesLog = cleanLog(
    Object.values(
      mergeMaps(
        keyed(O?.dailiesLog || [], (e) => e.day),
        keyed(A.dailiesLog, (e) => e.day),
        keyed(B.dailiesLog, (e) => e.day),
        preferDay
      )
    )
  );

  const conflicts = [
    ...copies,
    ...mergeList(O?.conflicts || [], A.conflicts, B.conflicts, (c) => c.id).filter(
      (c) => !copies.some((n) => n.id === c.id)
    ),
  ]
    .sort(byCopiedAt)
    .slice(0, MAX_CONFLICTS);

  return {
    snapshot: {
      planner,
      dailies,
      dailiesDay: day ?? null,
      dailiesHour: value("dailiesHour"),
      dailiesLog,
      settings: value("settings"),
      sessions,
      archive,
      done,
      conflicts,
      edited,
    },
    copies: copies.length,
  };
}
