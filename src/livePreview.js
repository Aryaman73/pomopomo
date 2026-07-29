// ── Markdown live preview for CodeMirror 6 ───────────────────────────────────
//
// The document is always plain markdown text. This extension only changes how
// it's *drawn*:
//
//   • `# Heading`   renders large; the `#` markers hide unless your cursor is
//                   on that line, so the text is always directly editable.
//   • `[] task`     the marker is replaced by a real checkbox you can click.
//                   Checkboxes stay visible even on the active line — they're
//                   the whole point of the planner, and hiding them the moment
//                   you click into a line would be maddening.
//   • `**bold**`, `*italic*`, `` `code` ``, `~~strike~~` — styled, markers hide
//                   off-cursor, same as headings.
//
// Parsing is a deliberate hand-rolled line scanner rather than a full markdown
// grammar. The supported syntax is small and fixed, and this keeps the bundle
// and the behavior both predictable.

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";

// Optional leading indent and bullet, then `[]`, `[ ]`, `[x]` or `[X]`.
const TASK_RE = /^(\s*(?:[-*+]\s+)?)\[([ xX]?)\]/;
const HEADING_RE = /^(#{1,6})(\s+)/;

/** Flip `[]` ⇄ `[x]` on the line containing `pos`. */
export function toggleTaskAt(view, pos) {
  const line = view.state.doc.lineAt(pos);
  const m = TASK_RE.exec(line.text);
  if (!m) return false;

  const from = line.from + m[1].length;
  const to = from + m[2].length + 2;
  const checked = m[2].toLowerCase() === "x";

  view.dispatch({
    changes: { from, to, insert: checked ? "[]" : "[x]" },
    // Don't yank the cursor to the checkbox the user just clicked.
    selection: view.state.selection,
    scrollIntoView: false,
  });
  return true;
}

class CheckboxWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }

  // Without this, CodeMirror rebuilds the DOM node on every redraw and the
  // checkbox loses focus mid-interaction.
  eq(other) {
    return other.checked === this.checked;
  }

  toDOM(view) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-checkbox";
    box.checked = this.checked;
    box.setAttribute(
      "aria-label",
      this.checked ? "Mark task as not done" : "Mark task as done"
    );
    box.addEventListener("mousedown", (event) => {
      // preventDefault keeps the editor from moving the caret into the widget
      // and stealing focus before we've applied the change.
      event.preventDefault();
      toggleTaskAt(view, view.posAtDOM(box));
    });
    return box;
  }

  ignoreEvent() {
    return false;
  }
}

// Bold before italic, so `**x**` isn't mistaken for an italic `*` pair.
const INLINE_RULES = [
  { re: /\*\*([^*\n]+)\*\*/g, cls: "cm-md-strong", marker: 2 },
  { re: /__([^_\n]+)__/g, cls: "cm-md-strong", marker: 2 },
  { re: /~~([^~\n]+)~~/g, cls: "cm-md-strike", marker: 2 },
  { re: /`([^`\n]+)`/g, cls: "cm-md-code", marker: 1 },
  { re: /\*([^*\n]+)\*/g, cls: "cm-md-em", marker: 1 },
  { re: /_([^_\n]+)_/g, cls: "cm-md-em", marker: 1 },
];

const HIDE = Decoration.replace({});

function decorateInline(out, line, startOffset, active) {
  const taken = [];
  const free = (from, to) => !taken.some(([a, b]) => from < b && to > a);

  for (const { re, cls, marker } of INLINE_RULES) {
    re.lastIndex = startOffset;
    let m;
    while ((m = re.exec(line.text)) !== null) {
      const from = m.index;
      const to = from + m[0].length;
      if (from < startOffset || !free(from, to)) {
        // Retry from the next character rather than from the end of the
        // rejected match. `*italic*` in `**bold**, *italic*` is only reachable
        // if we rewind — a greedy `*…*` swallows bold's closing marker and the
        // real italic pair sits inside the span we'd otherwise skip past.
        re.lastIndex = from + 1;
        continue;
      }
      taken.push([from, to]);

      const innerFrom = line.from + from + marker;
      const innerTo = line.from + to - marker;
      out.push({ from: innerFrom, to: innerTo, deco: Decoration.mark({ class: cls }) });

      if (!active) {
        out.push({ from: line.from + from, to: innerFrom, deco: HIDE });
        out.push({ from: innerTo, to: line.from + to, deco: HIDE });
      }
    }
  }
}

function decorateLine(out, line, active) {
  const text = line.text;

  const heading = HEADING_RE.exec(text);
  if (heading) {
    const level = heading[1].length;
    out.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: `cm-md-heading cm-md-h${level}` }),
    });
    if (active) {
      out.push({
        from: line.from,
        to: line.from + heading[1].length,
        deco: Decoration.mark({ class: "cm-md-marker" }),
      });
    } else {
      out.push({ from: line.from, to: line.from + heading[0].length, deco: HIDE });
    }
    decorateInline(out, line, heading[0].length, active);
    return;
  }

  const task = TASK_RE.exec(text);
  if (task) {
    const checked = task[2].toLowerCase() === "x";
    const markerFrom = line.from + task[1].length;
    const markerTo = markerFrom + task[2].length + 2;
    out.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({
        class: checked ? "cm-md-task cm-md-task-done" : "cm-md-task",
      }),
    });
    out.push({
      from: markerFrom,
      to: markerTo,
      deco: Decoration.replace({ widget: new CheckboxWidget(checked) }),
    });
    decorateInline(out, line, markerTo - line.from, active);
    return;
  }

  decorateInline(out, line, 0, active);
}

function buildDecorations(view) {
  const { state } = view;
  const out = [];

  // Every line touched by any selection range shows its raw markup — but only
  // while the editor has focus. Otherwise the caret's parking spot (line 1 on
  // first load) sits there exposing its `#` at rest, which reads as a bug.
  const activeLines = new Set();
  if (view.hasFocus) {
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let n = first; n <= last; n++) activeLines.add(n);
    }
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      decorateLine(out, line, activeLines.has(line.number));
      pos = line.to + 1;
    }
  }

  // Decoration.set sorts by CodeMirror's own comparator, which accounts for
  // decoration side as well as position. Hand-sorting into a RangeSetBuilder
  // gets the line-vs-mark ordering at a shared position wrong.
  return Decoration.set(
    out.map(({ from, to, deco }) => deco.range(from, to)),
    true
  );
}

export const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }

    update(update) {
      // Selection changes matter as much as edits here — moving the caret onto
      // a line is what reveals its markup.
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.focusChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // Treat hidden markup and checkboxes as single units, so arrowing or
    // backspacing across them doesn't strand the caret inside invisible text.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none),
  }
);

/**
 * Enter continues the current list item: a new `[] ` under a task, a new `- `
 * under a bullet. Pressing Enter on an empty item clears it instead, which is
 * how you get out of a list.
 */
export const continueList = {
  key: "Enter",
  run(view) {
    const { state } = view;
    const range = state.selection.main;
    if (!range.empty) return false;

    const line = state.doc.lineAt(range.head);
    const task = TASK_RE.exec(line.text);
    const bullet = /^(\s*)([-*+])(\s+)/.exec(line.text);
    if (!task && !bullet) return false;

    const prefixLength = task
      ? task[1].length + task[2].length + 2
      : bullet[0].length;
    const rest = line.text.slice(prefixLength).trim();

    // Empty item + Enter = leave the list.
    if (rest === "" && range.head >= line.from + prefixLength) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
        userEvent: "input",
      });
      return true;
    }

    const insert = task
      ? `\n${task[1]}[] `
      : `\n${bullet[1]}${bullet[2]}${bullet[3]}`;
    view.dispatch({
      changes: { from: range.head, insert },
      selection: { anchor: range.head + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  },
};
