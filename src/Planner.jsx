import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import Archive from "./Archive";
import { continueList, livePreview } from "./livePreview";
import { countTasks } from "./markdown";
import {
  addEntries,
  cleanDocument,
  loadArchive,
  loadDoneMap,
  saveArchive,
  saveDoneMap,
  syncDoneMap,
} from "./archiveStore";
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

export default function Planner() {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const saveTimer = useRef(null);

  // Completion times for ticked tasks. Kept in a ref rather than state because
  // nothing renders from it directly and it changes on keystrokes.
  const doneRef = useRef(loadDoneMap());

  const [counts, setCounts] = useState(() => countTasks(load("planner", STARTER)));
  const [archive, setArchive] = useState(loadArchive);
  const [view, setView] = useState("planner");
  const [undo, setUndo] = useState(null);

  // Mirrors so the editor's update listener can read current values without
  // being rebuilt.
  const undoRef = useRef(undo);
  undoRef.current = undo;

  // Set while we rewrite the document ourselves, so the listener can tell our
  // own clean/undo edits apart from the user typing.
  const programmatic = useRef(false);

  useEffect(() => {
    const initial = load("planner", STARTER);
    // Backfill anything already ticked. `observed: false` is the important part:
    // we didn't see these happen, so the archive will mark their times as
    // guesses rather than claiming they were finished the moment the page loaded.
    doneRef.current = syncDoneMap(initial, doneRef.current, { observed: false });
    saveDoneMap(doneRef.current);

    const editor = new EditorView({
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

            // This is the whole point of the side-car: the stamp lands when the
            // box is ticked, not when the planner is later cleaned.
            const next = syncDoneMap(text, doneRef.current);
            if (next !== doneRef.current) {
              doneRef.current = next;
              saveDoneMap(next);
            }

            // Any hand edit after a clean invalidates the undo — restoring the
            // pre-clean text would silently throw that edit away.
            if (!programmatic.current && undoRef.current) setUndo(null);

            // Debounced; the editor fires this on every keystroke and
            // localStorage writes are synchronous.
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => save("planner", text), 400);
          }),
        ],
      }),
    });

    viewRef.current = editor;

    // A pending debounce would otherwise lose the last few keystrokes when the
    // tab closes.
    const flush = () => {
      clearTimeout(saveTimer.current);
      save("planner", editor.state.doc.toString());
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
      editor.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => saveArchive(archive), [archive]);

  /** Replace the whole document without tripping the undo invalidation. */
  const rewrite = (editor, text) => {
    programmatic.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
    programmatic.current = false;
  };

  const handleClean = () => {
    const editor = viewRef.current;
    if (!editor) return;

    const before = editor.state.doc.toString();
    const snapshot = doneRef.current;
    const result = cleanDocument(before, snapshot);
    if (!result) return;

    rewrite(editor, result.text);
    setArchive((list) => addEntries(list, result.entries));
    setUndo({
      text: before,
      doneSnapshot: snapshot,
      ids: new Set(result.entries.map((e) => e.id)),
      count: result.removed,
    });
  };

  const handleUndo = () => {
    const editor = viewRef.current;
    if (!editor || !undo) return;

    // Restore the stamps *before* the text, or the returning `[x]` tasks would
    // look newly ticked and be re-stamped with now.
    doneRef.current = undo.doneSnapshot;
    saveDoneMap(undo.doneSnapshot);

    rewrite(editor, undo.text);
    setArchive((list) => list.filter((e) => !undo.ids.has(e.id)));
    setUndo(null);
  };

  const showPlanner = view === "planner";

  const switchTo = (next) => {
    setView(next);
    // CodeMirror measures lazily and a hidden editor measures as zero, so it
    // needs a nudge once it's on screen again.
    if (next === "planner" && viewRef.current) {
      requestAnimationFrame(() => viewRef.current?.requestMeasure());
    }
  };

  return (
    <section className="panel planner-panel">
      <div className="panel-head">
        <div
          className="segmented segmented-compact"
          role="group"
          aria-label="Planner view"
        >
          <button aria-pressed={showPlanner} onClick={() => switchTo("planner")}>
            Planner
          </button>
          <button aria-pressed={!showPlanner} onClick={() => switchTo("archive")}>
            Archive
          </button>
        </div>

        {/* Grouped so that a header too narrow for one row drops `clean` and the
            count together, rather than stranding the count on its own line. */}
        <div className="planner-head-right">
          {showPlanner && (
            <button
              className="btn btn-ghost"
              onClick={handleClean}
              disabled={counts.done === 0}
              title="Move completed tasks into the archive"
            >
              clean{counts.done > 0 ? ` (${counts.done})` : ""}
            </button>
          )}

          <span className="planner-count">
            {showPlanner
              ? `${counts.done} / ${counts.total} done`
              : `${archive.length} archived`}
          </span>
        </div>
      </div>

      {undo && showPlanner && (
        <div className="planner-undo">
          <span>
            Archived {undo.count} task{undo.count === 1 ? "" : "s"}.
          </span>
          <span className="planner-undo-actions">
            <button className="btn btn-ghost" onClick={handleUndo}>
              undo
            </button>
            {/* Dismissing only hides the banner — the tasks stay archived. It
                drops the undo, which is why it's a separate control from it. */}
            <button
              className="planner-undo-close"
              onClick={() => setUndo(null)}
              aria-label="Dismiss, keeping the tasks archived"
              title="Dismiss"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {/* The editor stays mounted while the archive is showing — unmounting it
          would throw away undo history and the cursor position. */}
      <div
        className="planner-editor"
        ref={hostRef}
        style={showPlanner ? undefined : { display: "none" }}
      />

      {!showPlanner && (
        <Archive
          entries={archive}
          removeEntry={(id) =>
            setArchive((list) => list.filter((e) => e.id !== id))
          }
        />
      )}
    </section>
  );
}
