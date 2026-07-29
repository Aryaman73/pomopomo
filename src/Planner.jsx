import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { continueList, livePreview } from "./livePreview";
import { load, save } from "./storage";
import "./Planner.css";

const STARTER = `# Today

[] Try clicking this checkbox
[] Write down what you actually need to do
[x] Open pomopomo

## Later

[] Something for another day

Headings, **bold**, *italic* and \`code\` all work.
Put your cursor on a line to see the raw markdown behind it.
`;

const editorTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "15px" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "1.7",
      padding: "4px 0 40vh",
    },
    ".cm-content": { padding: "0", caretColor: "var(--cyan)" },
    ".cm-line": { padding: "0 4px" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "var(--cyan)" },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      background: "rgba(164, 121, 255, 0.32)",
    },
    ".cm-selectionBackground": { background: "rgba(164, 121, 255, 0.18)" },
    ".cm-placeholder": { color: "var(--text-faint)" },
  },
  { dark: true }
);

function countTasks(text) {
  let total = 0;
  let done = 0;
  for (const line of text.split("\n")) {
    const m = /^\s*(?:[-*+]\s+)?\[([ xX]?)\]/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1].toLowerCase() === "x") done += 1;
  }
  return { total, done };
}

export default function Planner() {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const saveTimer = useRef(null);
  const [counts, setCounts] = useState(() => countTasks(load("planner", STARTER)));

  useEffect(() => {
    const initial = load("planner", STARTER);

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          // continueList first so it wins the Enter key.
          keymap.of([continueList, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder("Start typing. `# heading` for sections, `[] thing` for a task."),
          livePreview,
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            setCounts(countTasks(text));
            // Debounced — the editor fires this on every keystroke and
            // localStorage writes are synchronous.
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => save("planner", text), 400);
          }),
        ],
      }),
    });

    viewRef.current = view;

    // A pending debounce would otherwise lose the last few keystrokes when the
    // tab closes.
    const flush = () => {
      clearTimeout(saveTimer.current);
      save("planner", view.state.doc.toString());
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return (
    <section className="panel planner-panel">
      <div className="panel-head">
        <h2 className="panel-title">Planner</h2>
        <span className="planner-count">
          {counts.done} / {counts.total} done
        </span>
      </div>
      <div className="planner-editor" ref={hostRef} />
    </section>
  );
}
