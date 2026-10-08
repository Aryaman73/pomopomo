// Tiny localStorage wrapper. Every read is defensive: a user can clear storage
// mid-session, Safari private mode throws on write, and a bad JSON blob from an
// older build should degrade to defaults rather than white-screen the app.

export const PREFIX = "pomopomo:";

// Set once an import has written its data and we're about to reload. The editor
// flushes its content on `beforeunload`, which would otherwise overwrite the
// planner we just imported with the document still on screen — a bug that would
// make importing a planner appear to silently do nothing.
let frozen = false;

export function freeze() {
  frozen = true;
}

// Sync needs to know when something it carries has changed, and every write in
// the app comes through here, so this is the one place to watch. Writes that
// change nothing don't count: the editors flush the same text on every blur,
// and treating that as an edit would push a sync each time.
const listeners = new Set();
let muted = 0;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Write without telling anyone — for sync putting merged data in place. */
export function quietly(fn) {
  muted += 1;
  try {
    return fn();
  } finally {
    muted -= 1;
  }
}

function notify(key) {
  if (muted) return;
  for (const fn of listeners) fn(key);
}

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  if (frozen) return;
  try {
    const json = JSON.stringify(value);
    if (localStorage.getItem(PREFIX + key) === json) return;
    localStorage.setItem(PREFIX + key, json);
  } catch {
    // Quota exceeded or storage disabled. Nothing useful to do — the app keeps
    // working in memory for this session.
    return;
  }
  notify(key);
}

export function remove(key) {
  if (frozen) return;
  try {
    if (localStorage.getItem(PREFIX + key) === null) return;
    localStorage.removeItem(PREFIX + key);
  } catch {
    return;
  }
  notify(key);
}
