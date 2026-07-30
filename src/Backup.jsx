import { useEffect, useState } from "react";
import {
  applyAndReload,
  downloadBackup,
  parseBackup,
  takeImportResult,
} from "./backupStore";
import { formatDayLabel } from "./datetime";
import "./Backup.css";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Summary({ summary }) {
  const oldest = summary.oldest ? formatDayLabel(summary.oldest) : null;
  const newest = summary.newest ? formatDayLabel(summary.newest) : null;
  // One session, or several on the same day, shouldn't read "Jul 24 → Jul 24".
  const range = oldest && newest ? (oldest === newest ? oldest : `${oldest} → ${newest}`) : null;

  return (
    <ul className="backup-summary">
      <li>
        <strong>{plural(summary.sessions, "session")}</strong>
        {range && <span> · {range}</span>}
      </li>
      <li>
        <strong>{plural(summary.archive, "archived task")}</strong>
      </li>
      <li>
        {summary.plannerChars === null ? (
          <span className="backup-muted">No planner document</span>
        ) : (
          <>
            <strong>Planner document</strong>
            <span> · {summary.plannerChars.toLocaleString()} characters</span>
          </>
        )}
      </li>
      {summary.hasSettings && (
        <li>
          <strong>Timer settings</strong>
        </li>
      )}
      {summary.exportedAt && (
        <li className="backup-muted">
          Exported {formatDayLabel(summary.exportedAt)}
        </li>
      )}
    </ul>
  );
}

export default function Backup() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // An import reloads the page, so the outcome is handed across in
  // sessionStorage and the panel reopens itself to report it.
  useEffect(() => {
    const outcome = takeImportResult();
    if (outcome) {
      setResult(outcome);
      setOpen(true);
    }
  }, []);

  const reset = () => {
    setPending(null);
    setError(null);
    setResult(null);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    // Clear the input so picking the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    reset();
    let text;
    try {
      text = await file.text();
    } catch {
      setError("That file couldn't be read.");
      return;
    }

    const parsed = parseBackup(text);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    setPending({ ...parsed, name: file.name });
  };

  return (
    <div className="backup">
      <div className="backup-actions">
        <button
          className="btn btn-ghost"
          onClick={() => {
            downloadBackup();
            reset();
          }}
          title="Download everything as a JSON file"
        >
          export
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (open) {
              setOpen(false);
              reset();
            } else {
              setOpen(true);
            }
          }}
          aria-expanded={open}
        >
          {open ? "close" : "import"}
        </button>
      </div>

      {open && (
        <div className="panel backup-panel">
          <div className="panel-body">
            <p className="backup-note">
              Everything in pomopomo lives in this browser and is never sent
              anywhere — which also means clearing your site data is the only
              copy gone. <strong>export</strong> writes it all to a file.
            </p>

            {result ? (
              <div className="backup-result">
                {result.mode === "replace" ? (
                  <p>
                    Replaced everything: {plural(result.sessions, "session")} and{" "}
                    {plural(result.archive, "archived task")}
                    {result.planner && ", plus the planner document"}.
                  </p>
                ) : (
                  <p>
                    Merged in {plural(result.sessions, "new session")} and{" "}
                    {plural(result.archive, "new archived task")}. Your planner
                    and settings were left as they were.
                  </p>
                )}
                <button className="btn btn-ghost btn-tiny" onClick={reset}>
                  ok
                </button>
              </div>
            ) : (
              <>
                <input
                  className="backup-file"
                  type="file"
                  accept="application/json,.json"
                  onChange={handleFile}
                  aria-label="Choose a backup file to import"
                />

                {error && <p className="backup-error">{error}</p>}

                {pending && (
                  <div className="backup-pending">
                    <p className="backup-filename">{pending.name}</p>
                    <Summary summary={pending.summary} />

                    <div className="backup-choices">
                      <button
                        className="btn"
                        onClick={() => applyAndReload(pending.data, "merge")}
                        title="Add anything you don't already have"
                      >
                        Merge
                      </button>
                      <button
                        className="btn backup-danger"
                        onClick={() => applyAndReload(pending.data, "replace")}
                        title="Overwrite everything currently in this browser"
                      >
                        Replace everything
                      </button>
                    </div>

                    <p className="backup-explain">
                      <strong>Merge</strong> only adds — sessions and archived
                      tasks you don't already have. Your planner and settings
                      stay as they are, since two markdown documents can't be
                      combined without losing one.
                      <br />
                      <strong>Replace</strong> overwrites the planner, settings,
                      session log and archive with the file's contents, and
                      resets any running timer.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
