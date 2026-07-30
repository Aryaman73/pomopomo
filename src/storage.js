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
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. Nothing useful to do — the app keeps
    // working in memory for this session.
  }
}

export function remove(key) {
  if (frozen) return;
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
