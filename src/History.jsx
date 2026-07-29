import { useMemo, useState } from "react";
import {
  bucketsByDay,
  bucketsByWeek,
  totalAll,
  totalSince,
} from "./sessions";
import {
  formatDayLabel,
  formatDayTick,
  formatDuration,
  formatTimeOfDay,
  formatWeekTick,
  groupByDay,
  startOfDay,
  startOfWeek,
} from "./datetime";
import "./History.css";

const DAYS_SHOWN = 14;
const WEEKS_SHOWN = 8;

function SessionRow({ session, onRemove }) {
  return (
    <li className="session">
      <span
        className={`session-kind session-kind-${session.kind}`}
        title={session.kind === "countup" ? "Count-up" : "Pomodoro"}
        aria-hidden="true"
      >
        {session.kind === "countup" ? "∞" : "◔"}
      </span>
      <span className="session-task">
        {session.task || <em>Untitled</em>}
        {session.partial && (
          <span className="session-partial" title="Skipped before the phase ended">
            partial
          </span>
        )}
      </span>
      <span className="session-time">{formatTimeOfDay(session.start)}</span>
      <span className="session-duration">{formatDuration(session.ms)}</span>
      <button
        className="session-remove"
        onClick={() => onRemove(session.id)}
        aria-label={`Delete session${session.task ? ` "${session.task}"` : ""}`}
        title="Delete this session"
      >
        ×
      </button>
    </li>
  );
}

function SessionList({ sessions, removeSession }) {
  const groups = useMemo(
    () =>
      groupByDay(sessions, (s) => s.start).map((g) => ({
        ...g,
        ms: g.items.reduce((sum, s) => sum + s.ms, 0),
      })),
    [sessions]
  );

  if (sessions.length === 0) {
    return (
      <p className="history-empty">
        Nothing logged yet. Complete a focus session, or hit{" "}
        <strong>Finish</strong> on the count-up, and it'll show up here.
      </p>
    );
  }

  return (
    <div className="history-scroll">
      {groups.map((group) => (
        <div className="session-group" key={group.key}>
          <div className="session-group-head">
            <span>{formatDayLabel(group.at)}</span>
            <span>{formatDuration(group.ms)}</span>
          </div>
          <ul className="session-list">
            {group.items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onRemove={removeSession}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Bars({ buckets, tick }) {
  // Scale to the busiest bucket on screen rather than to an absolute ceiling —
  // the useful comparison here is between your own days, not against a target.
  const peak = Math.max(...buckets.map((b) => b.ms), 1);

  return (
    <ul className="bars">
      {buckets.map((b) => (
        <li className={`bar-row${b.ms === 0 ? " bar-row-empty" : ""}`} key={b.key}>
          <span className="bar-label">{tick(b.at)}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${(b.ms / peak) * 100}%` }}
            />
          </span>
          <span className="bar-value">{b.ms ? formatDuration(b.ms) : "—"}</span>
        </li>
      ))}
    </ul>
  );
}

function Stats({ sessions }) {
  const [range, setRange] = useState("day");

  const { today, week, all, buckets } = useMemo(() => {
    const now = Date.now();
    return {
      today: totalSince(sessions, startOfDay(now)),
      week: totalSince(sessions, startOfWeek(now)),
      all: totalAll(sessions),
      buckets:
        range === "day"
          ? bucketsByDay(sessions, DAYS_SHOWN)
          : bucketsByWeek(sessions, WEEKS_SHOWN),
    };
  }, [sessions, range]);

  return (
    <div className="stats">
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-value">{formatDuration(today.ms)}</span>
          <span className="stat-label">today</span>
          <span className="stat-sub">
            {today.count} session{today.count === 1 ? "" : "s"}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatDuration(week.ms)}</span>
          <span className="stat-label">this week</span>
          <span className="stat-sub">
            {week.count} session{week.count === 1 ? "" : "s"}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-value">{formatDuration(all.ms)}</span>
          <span className="stat-label">all time</span>
          <span className="stat-sub">
            {all.count} session{all.count === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="segmented stats-range" role="group" aria-label="Chart range">
        <button
          aria-pressed={range === "day"}
          onClick={() => setRange("day")}
        >
          Last {DAYS_SHOWN} days
        </button>
        <button
          aria-pressed={range === "week"}
          onClick={() => setRange("week")}
        >
          Last {WEEKS_SHOWN} weeks
        </button>
      </div>

      <div className="history-scroll">
        <Bars
          buckets={buckets}
          tick={range === "day" ? formatDayTick : formatWeekTick}
        />
      </div>
      {range === "week" && (
        <p className="stats-note">Weeks run Monday to Sunday.</p>
      )}
    </div>
  );
}

export default function History({ sessions, removeSession, clearSessions }) {
  const [tab, setTab] = useState("sessions");
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <section className="panel history-panel">
      <div className="panel-head">
        <h2 className="panel-title">History</h2>
        {sessions.length > 0 &&
          (confirmClear ? (
            <span className="history-confirm">
              <button
                className="btn btn-ghost history-danger"
                onClick={() => {
                  clearSessions();
                  setConfirmClear(false);
                }}
              >
                delete everything
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmClear(false)}
              >
                cancel
              </button>
            </span>
          ) : (
            <button
              className="btn btn-ghost"
              onClick={() => setConfirmClear(true)}
            >
              clear
            </button>
          ))}
      </div>

      <div className="panel-body">
        <div className="segmented" role="group" aria-label="History view">
          <button
            aria-pressed={tab === "sessions"}
            onClick={() => setTab("sessions")}
          >
            Sessions
          </button>
          <button aria-pressed={tab === "stats"} onClick={() => setTab("stats")}>
            Stats
          </button>
        </div>

        {tab === "sessions" ? (
          <SessionList sessions={sessions} removeSession={removeSession} />
        ) : (
          <Stats sessions={sessions} />
        )}
      </div>
    </section>
  );
}
