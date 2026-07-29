// ── The planner archive ──────────────────────────────────────────────────────
//
// "Clean planner" lifts every completed task out of the document and files it
// here, so the planner stays about what's left to do while the record of what
// got done survives.
//
// The interesting problem is *when* a task was finished. Markdown `[x]` carries
// no timestamp, and writing one into the document would clutter text the user
// owns. So completion times live in a side-car map, stamped the moment a box is
// ticked — not when the planner is cleaned. Cleaning is tidying up, which can
// happen days after the work; stamping then would make the archive answer the
// wrong question.

import { load, save } from "./storage";
import { scanTasks } from "./markdown";

const ARCHIVE_KEY = "archive";
const DONE_KEY = "done";

// Well beyond any realistic use, but the archive is append-mostly so it needs
// some ceiling.
const MAX_ARCHIVE = 5000;

/**
 * Identity for the completion side-car. Two identically worded tasks under the
 * same heading are indistinguishable, which at worst makes them share a
 * timestamp — the alternative, keying on line number, breaks the moment anything
 * above the task is edited.
 */
export function doneKey(task) {
  return `${task.heading}\u0000${task.text}`;
}

/**
 * A stamp is `{ at, observed }`. `observed` is the honest bit: true only when we
 * actually watched the box get ticked. A task that was already `[x]` the first
 * time we saw the document gets a stamp too — there's nothing better to use —
 * but flagged so the archive can present it as a guess instead of a fact.
 */
function normalizeStamp(value) {
  if (typeof value === "number") return { at: value, observed: false };
  if (value && typeof value.at === "number") {
    return { at: value.at, observed: !!value.observed };
  }
  return null;
}

export function loadDoneMap() {
  const raw = load(DONE_KEY, {});
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const stamp = normalizeStamp(value);
    if (stamp) out[key] = stamp;
  }
  return out;
}

export function saveDoneMap(map) {
  save(DONE_KEY, map);
}

/**
 * Reconcile the side-car against the document: newly ticked tasks get stamped,
 * un-ticked or deleted ones lose their stamp. Returns the *same object* when
 * nothing changed, so callers can cheaply skip a write — this runs on every
 * keystroke.
 *
 * Pass `observed: false` when backfilling a document we're seeing for the first
 * time, rather than reacting to a live edit.
 */
export function syncDoneMap(
  docText,
  current,
  { observed = true, now = Date.now() } = {}
) {
  const next = {};
  for (const task of scanTasks(docText)) {
    if (!task.checked) continue;
    const key = doneKey(task);
    next[key] = current[key] || { at: now, observed };
  }

  const keys = Object.keys(next);
  const unchanged =
    keys.length === Object.keys(current).length &&
    keys.every((key) => current[key] === next[key]);

  return unchanged ? current : next;
}

let sequence = 0;

function makeEntry({ text, heading, doneAt, estimated }) {
  sequence += 1;
  return {
    id: `${doneAt}-${sequence}`,
    text,
    heading,
    doneAt,
    archivedAt: Date.now(),
    estimated,
  };
}

/**
 * Strip every completed task out of `docText`. Returns the rewritten document
 * and the entries to archive, or null if there was nothing to clean.
 *
 * Headings are always left in place, even when every task under one is removed:
 * they're the user's structure, not a by-product of the tasks beneath them.
 */
export function cleanDocument(docText, doneMap, now = Date.now()) {
  const completed = scanTasks(docText).filter((t) => t.checked);
  if (completed.length === 0) return null;

  const drop = new Set(completed.map((t) => t.line));
  const text = docText
    .split("\n")
    .filter((_, line) => !drop.has(line))
    .join("\n");

  const entries = completed.map((task) => {
    const stamp = doneMap[doneKey(task)];
    return makeEntry({
      text: task.text,
      heading: task.heading,
      doneAt: stamp ? stamp.at : now,
      // Either there's no stamp at all, or there is one but we never actually
      // saw the box get ticked. Both are guesses, and the archive says so
      // rather than presenting a made-up time as though it were observed.
      estimated: !stamp || !stamp.observed,
    });
  });

  return { text, entries, removed: completed.length };
}

// ── Storage ──────────────────────────────────────────────────────────────────

function isEntry(e) {
  return e && typeof e.id === "string" && typeof e.doneAt === "number";
}

export function loadArchive() {
  const raw = load(ARCHIVE_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEntry).sort((a, b) => b.doneAt - a.doneAt);
}

export function saveArchive(list) {
  save(ARCHIVE_KEY, list.slice(0, MAX_ARCHIVE));
}

export function addEntries(list, entries) {
  return [...entries, ...list]
    .sort((a, b) => b.doneAt - a.doneAt)
    .slice(0, MAX_ARCHIVE);
}
