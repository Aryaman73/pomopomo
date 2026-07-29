import { useMemo, useState } from "react";
import { formatDayLabel, formatTimeOfDay, groupByDay } from "./datetime";

export default function Archive({ entries, removeEntry }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? entries.filter(
          (e) =>
            e.text.toLowerCase().includes(q) ||
            e.heading.toLowerCase().includes(q)
        )
      : entries;
    return groupByDay(matched, (e) => e.doneAt);
  }, [entries, query]);

  if (entries.length === 0) {
    return (
      <div className="archive">
        <p className="archive-empty">
          Nothing archived yet. Tick some tasks off in the planner, then hit{" "}
          <strong>clean</strong> — they'll be filed here with the time you
          finished them, and the planner goes back to being about what's left.
        </p>
      </div>
    );
  }

  return (
    <div className="archive">
      <input
        className="archive-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search archived tasks…"
        aria-label="Search archived tasks"
      />

      {groups.length === 0 ? (
        <p className="archive-empty">No archived task matches “{query.trim()}”.</p>
      ) : (
        <div className="archive-scroll">
          {groups.map((group) => (
            <div className="archive-group" key={group.key}>
              <div className="archive-group-head">
                <span>{formatDayLabel(group.at)}</span>
                <span>
                  {group.items.length} task{group.items.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="archive-list">
                {group.items.map((entry) => (
                  <li className="archive-item" key={entry.id}>
                    <span className="archive-check" aria-hidden="true">
                      ✓
                    </span>
                    <span className="archive-body">
                      <span className="archive-text">{entry.text || <em>Empty task</em>}</span>
                      {entry.heading && (
                        <span className="archive-heading">{entry.heading}</span>
                      )}
                    </span>
                    <span
                      className={`archive-time${entry.estimated ? " archive-time-estimated" : ""}`}
                      title={
                        entry.estimated
                          ? "This one was already ticked before pomopomo started recording completion times, so this is when it was archived rather than when it was finished."
                          : undefined
                      }
                    >
                      {formatTimeOfDay(entry.doneAt)}
                      {entry.estimated && "?"}
                    </span>
                    <button
                      className="archive-remove"
                      onClick={() => removeEntry(entry.id)}
                      aria-label={`Delete archived task "${entry.text}"`}
                      title="Delete permanently"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
