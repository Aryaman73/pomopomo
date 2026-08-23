import { useEffect, useRef, useState } from "react";
import Archive from "./Archive";
import ResizeHandle, { usePanelHeight } from "./ResizeHandle";
import { countTasks } from "./markdown";
import { useMarkdownEditor } from "./markdownEditor";
import {
  addEntries,
  cleanDocument,
  loadArchive,
  loadDoneMap,
  saveArchive,
  saveDoneMap,
  syncDoneMap,
} from "./archiveStore";
import { load } from "./storage";
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

const MIN_HEIGHT = 220;
const DEFAULT_HEIGHT = 560;

export default function Planner() {
  const [height, setHeight] = usePanelHeight("plannerHeight", DEFAULT_HEIGHT, MIN_HEIGHT);

  // Completion times for ticked tasks. Kept in a ref rather than state because
  // nothing renders from it directly and it changes on keystrokes.
  const doneRef = useRef(loadDoneMap());

  const [counts, setCounts] = useState(() => countTasks(load("planner", STARTER)));
  const [archive, setArchive] = useState(loadArchive);
  const [view, setView] = useState("planner");
  const [undo, setUndo] = useState(null);

  // Mirror so the editor's change handler can read the current value without
  // being rebuilt.
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const { hostRef, viewRef, rewrite } = useMarkdownEditor({
    storageKey: "planner",
    hint: "Start typing. `# heading` for sections, `[] thing` for a task.",

    initialDoc: () => {
      const initial = load("planner", STARTER);
      // Backfill anything already ticked. `observed: false` is the important
      // part: we didn't see these happen, so the archive will mark their times
      // as guesses rather than claiming they were finished the moment the page
      // loaded.
      doneRef.current = syncDoneMap(initial, doneRef.current, { observed: false });
      saveDoneMap(doneRef.current);
      return initial;
    },

    onChange: (text, { programmatic }) => {
      setCounts(countTasks(text));

      // This is the whole point of the side-car: the stamp lands when the box
      // is ticked, not when the planner is later cleaned.
      const next = syncDoneMap(text, doneRef.current);
      if (next !== doneRef.current) {
        doneRef.current = next;
        saveDoneMap(next);
      }

      // Any hand edit after a clean invalidates the undo — restoring the
      // pre-clean text would silently throw that edit away.
      if (!programmatic && undoRef.current) setUndo(null);
    },
  });

  useEffect(() => saveArchive(archive), [archive]);

  const handleClean = () => {
    const editor = viewRef.current;
    if (!editor) return;

    const before = editor.state.doc.toString();
    const snapshot = doneRef.current;
    const result = cleanDocument(before, snapshot);
    if (!result) return;

    rewrite(result.text);
    setArchive((list) => addEntries(list, result.entries));
    setUndo({
      text: before,
      doneSnapshot: snapshot,
      ids: new Set(result.entries.map((e) => e.id)),
      count: result.removed,
    });
  };

  const handleUndo = () => {
    if (!viewRef.current || !undo) return;

    // Restore the stamps *before* the text, or the returning `[x]` tasks would
    // look newly ticked and be re-stamped with now.
    doneRef.current = undo.doneSnapshot;
    saveDoneMap(undo.doneSnapshot);

    rewrite(undo.text);
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
    <section className="panel planner-panel" style={{ height }}>
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

          <span className="panel-count">
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
        className="md-editor planner-editor"
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

      <ResizeHandle
        height={height}
        setHeight={setHeight}
        min={MIN_HEIGHT}
        label="Resize the planner"
      />
    </section>
  );
}
