import { useEffect, useState } from "react";
import ResizeHandle, { usePanelHeight } from "./ResizeHandle";
import { countTasks } from "./markdown";
import { useMarkdownEditor } from "./markdownEditor";
import { DOC_KEY, clampHour, nextRollover } from "./dailiesStore";
import { formatHour } from "./datetime";
import { save } from "./storage";
import "./Dailies.css";

export const MIN_HEIGHT = 140;
// Tall enough that the starter list fits without scrolling.
const DEFAULT_HEIGHT = 264;

function HourPanel({ hour, setHour, onClose }) {
  // Mirrors the timer's settings panel: the field can go empty while you type,
  // and settles on blur rather than snapping back mid-keystroke.
  const [draft, setDraft] = useState(String(hour));

  const commit = (value) => {
    setDraft(value);
    if (value !== "") setHour(value);
  };

  return (
    <div className="settings dailies-settings">
      <label className="settings-row">
        <span>New day starts at</span>
        <span className="settings-input">
          <input
            type="number"
            min="0"
            max="23"
            value={draft}
            onChange={(e) => commit(e.target.value)}
            onBlur={() => setDraft(String(clampHour(draft === "" ? hour : draft)))}
            aria-label="Hour at which the dailies reset"
          />
          <em>{formatHour(hour)}</em>
        </span>
      </label>

      <p className="dailies-settings-note">
        The ticks clear at this hour. 4am by default — late enough that a long
        night keeps the list it started with.
      </p>

      <button className="btn btn-ghost settings-close" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

export default function Dailies({ dailies }) {
  const { hour, setHour, counts, setCounts, rollOver, initialDoc } = dailies;
  const [height, setHeight] = usePanelHeight("dailiesHeight", DEFAULT_HEIGHT, MIN_HEIGHT);
  const [showHour, setShowHour] = useState(false);

  const { hostRef, viewRef, rewrite } = useMarkdownEditor({
    storageKey: DOC_KEY,
    initialDoc: () => initialDoc,
    hint: "One line per daily habit. `[] thing` for a task.",
    // A short panel doesn't want the planner's screenful of slack underneath.
    scrollerPadding: "4px 0 14px",
    onChange: (text) => setCounts(countTasks(text)),
  });

  // The day can turn with the tab open, and it can turn while the machine is
  // asleep and no timer fires at all — hence a scheduled check *and* one on
  // every return to the tab. Re-runs when the hour moves, which both
  // reschedules and re-checks against the new boundary.
  useEffect(() => {
    let timer;

    const check = () => {
      const editor = viewRef.current;
      if (editor) {
        const text = editor.state.doc.toString();
        const next = rollOver(text);
        if (next !== null && next !== text) {
          rewrite(next);
          // Written now rather than left to the editor's debounce: the new day
          // has already been recorded, and a document that lost the race would
          // stay ticked for good — the next check would see nothing to do.
          save(DOC_KEY, next);
        }
      }
      schedule();
    };

    const schedule = () => {
      clearTimeout(timer);
      // Never zero: a timer that fires a hair early would otherwise spin.
      timer = setTimeout(check, Math.max(1000, nextRollover(Date.now(), hour) - Date.now()));
    };

    check();
    // Unconditional rather than gated on `document.hidden`: the check is a
    // string comparison, and an embedded view that reports itself as
    // permanently hidden would otherwise never roll over at all.
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [hour, rollOver, rewrite, viewRef]);

  return (
    // The hour panel is taller than the slack in a small list, so while it's
    // open the panel grows around it rather than squeezing the editor to
    // nothing. The chosen height becomes the floor.
    <section
      className="panel dailies-panel"
      style={showHour ? { minHeight: height } : { height }}
    >
      <div className="panel-head">
        <h2 className="panel-title">Dailies</h2>

        <div className="dailies-head-right">
          <button
            className="btn btn-ghost dailies-reset"
            onClick={() => setShowHour((s) => !s)}
            aria-expanded={showHour}
            title="Change when the ticks clear"
          >
            resets {formatHour(hour)}
          </button>
          <span className="panel-count">
            {counts.done} / {counts.total} done
          </span>
        </div>
      </div>

      {showHour && (
        <HourPanel hour={hour} setHour={setHour} onClose={() => setShowHour(false)} />
      )}

      <div className="md-editor dailies-editor" ref={hostRef} />

      <ResizeHandle
        height={height}
        setHeight={setHeight}
        min={MIN_HEIGHT}
        label="Resize the dailies list"
      />
    </section>
  );
}
