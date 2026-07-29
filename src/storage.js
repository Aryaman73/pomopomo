// Tiny localStorage wrapper. Every read is defensive: a user can clear storage
// mid-session, Safari private mode throws on write, and a bad JSON blob from an
// older build should degrade to defaults rather than white-screen the app.

const PREFIX = "pomopomo:";

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
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. Nothing useful to do — the app keeps
    // working in memory for this session.
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
