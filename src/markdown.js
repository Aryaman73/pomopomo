// The small, fixed subset of markdown pomopomo understands. Both the editor's
// live-preview decorations and the archive parse against these, so the two can't
// drift into disagreeing about what counts as a task.

/** Optional indent and bullet, then `[]`, `[ ]`, `[x]` or `[X]`. */
export const TASK_RE = /^(\s*(?:[-*+]\s+)?)\[([ xX]?)\]/;

export const HEADING_RE = /^(#{1,6})(\s+)/;

export const HEADING_SEPARATOR = " › ";

export function parseTask(lineText) {
  const m = TASK_RE.exec(lineText);
  if (!m) return null;
  return {
    indent: m[1],
    checked: m[2].toLowerCase() === "x",
    markerEnd: m[0].length,
    text: lineText.slice(m[0].length).trim(),
  };
}

export function parseHeading(lineText) {
  const m = HEADING_RE.exec(lineText);
  if (!m) return null;
  return { level: m[1].length, text: lineText.slice(m[0].length).trim() };
}

/**
 * Every task line in the document, each carrying the heading path it sits under.
 * The path is a stack rather than just the nearest heading, so a task beneath
 * `# Today` → `## Morning` archives as "Today › Morning" instead of losing the
 * outer context that makes the inner heading meaningful.
 */
export function scanTasks(docText) {
  const stack = [];
  const out = [];

  docText.split("\n").forEach((lineText, line) => {
    const heading = parseHeading(lineText);
    if (heading) {
      while (stack.length && stack[stack.length - 1].level >= heading.level) {
        stack.pop();
      }
      stack.push(heading);
      return;
    }
    const task = parseTask(lineText);
    if (task) {
      out.push({
        ...task,
        line,
        heading: stack.map((h) => h.text).join(HEADING_SEPARATOR),
      });
    }
  });

  return out;
}

export function countTasks(docText) {
  let total = 0;
  let done = 0;
  for (const task of scanTasks(docText)) {
    total += 1;
    if (task.checked) done += 1;
  }
  return { total, done };
}
