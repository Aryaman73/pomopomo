// Local-calendar helpers and display formatting, shared by the session log and
// the planner archive. Everything here is deliberately timezone-local: these
// values are only ever shown to the person whose clock produced them.

const DAY_MS = 86_400_000;
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

/** A stable local-calendar key. Not an ISO instant. */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Group records already sorted newest-first into consecutive day buckets.
 * `at` picks the timestamp that decides which day a record belongs to.
 */
export function groupByDay(records, at) {
  const groups = [];
  let current = null;
  for (const record of records) {
    const ts = at(record);
    const key = dayKey(ts);
    if (!current || current.key !== key) {
      current = { key, at: startOfDay(ts), items: [] };
      groups.push(current);
    }
    current.items.push(record);
  }
  return groups;
}

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

/** Compact axis label for the day chart. */
export function formatDayTick(at) {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
  });
}

/** Compact axis label for the week chart. */
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
