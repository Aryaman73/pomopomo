import { useEffect, useState } from "react";
import { formatClock, PHASE_LABEL } from "./useTimer";
import { notificationPermission } from "./alerts";
import "./Timer.css";

const RING = 2 * Math.PI * 78; // r=78 in the SVG below

function SettingsPanel({ settings, updateSettings, onClose }) {
  const fields = [
    { key: "work", label: "Focus", max: 180 },
    { key: "short", label: "Short break", max: 60 },
    { key: "long", label: "Long break", max: 120 },
    { key: "longEvery", label: "Long break every", max: 12, unit: "sessions" },
  ];

  return (
    <div className="settings">
      {fields.map(({ key, label, max, unit }) => (
        <label className="settings-row" key={key}>
          <span>{label}</span>
          <span className="settings-input">
            <input
              type="number"
              min={key === "longEvery" ? 2 : 1}
              max={max}
              value={settings[key]}
              onChange={(e) => {
                // Let the field go empty while typing; sanitize on blur so the
                // user isn't fighting a value that snaps back mid-keystroke.
                const v = e.target.value;
                if (v === "") return;
                updateSettings({ [key]: v });
              }}
              onBlur={(e) => {
                if (e.target.value === "") updateSettings({ [key]: settings[key] });
              }}
            />
            <em>{unit || "min"}</em>
          </span>
        </label>
      ))}
      <button className="btn btn-ghost settings-close" onClick={onClose}>
        Done
      </button>
    </div>
  );
}

/**
 * Hand-correct the count-up. Deliberately plain and slightly out of the way:
 * this exists for a timer left running through lunch, not as a way to author
 * sessions that never happened.
 */
function AdjustPanel({ elapsed, onApply, onClose }) {
  const seconds = Math.max(0, Math.round(elapsed / 1000));
  const initialHours = Math.floor(seconds / 3600);
  const initialMinutes = Math.floor((seconds % 3600) / 60);

  const [hours, setHours] = useState(String(initialHours));
  const [minutes, setMinutes] = useState(String(initialMinutes));

  const parse = (value, max) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
  };

  const submit = (event) => {
    event.preventDefault();
    const h = parse(hours, 24);
    const m = parse(minutes, 59);
    // Unchanged means unchanged — applying the same hours and minutes shouldn't
    // discard the seconds or mark the session as hand-set.
    if (h !== initialHours || m !== initialMinutes) {
      onApply((h * 3600 + m * 60) * 1000);
    }
    onClose();
  };

  return (
    <form className="settings adjust" onSubmit={submit}>
      <label className="settings-row">
        <span>Time worked</span>
        <span className="settings-input adjust-input">
          <input
            type="number"
            min="0"
            max="24"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label="Hours worked"
            autoFocus
          />
          <em>h</em>
          <input
            type="number"
            min="0"
            max="59"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="Minutes worked"
          />
          <em>m</em>
        </span>
      </label>

      <p className="adjust-note">
        For a timer you left running. Sessions with a hand-set time are marked{" "}
        <em>adjusted</em> in your history.
      </p>

      <div className="adjust-actions">
        <button type="button" className="btn btn-ghost btn-tiny" onClick={onClose}>
          cancel
        </button>
        <button type="submit" className="btn btn-tiny">
          Set
        </button>
      </div>
    </form>
  );
}

export default function Timer(props) {
  const {
    mode,
    setMode,
    settings,
    updateSettings,
    phase,
    round,
    running,
    remaining,
    elapsed,
    progress,
    otherRunning,
    task,
    setTask,
    countupAdjusted,
    toggle,
    reset,
    skip,
    logCountup,
    adjustCountup,
    resetCycle,
  } = props;

  const [showSettings, setShowSettings] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const isCountup = mode === "countup";
  const display = formatClock(isCountup ? elapsed : remaining);

  // Live countdown in the tab title, so it's readable from another tab.
  useEffect(() => {
    if (!running && !isCountup && !remaining) {
      document.title = "pomopomo";
      return;
    }
    document.title = running
      ? `${display} · ${isCountup ? "counting up" : PHASE_LABEL[phase]} — pomopomo`
      : "pomopomo";
  }, [display, running, phase, isCountup, remaining]);

  const perm = notificationPermission();

  // Which session of the current cycle we're on. During a work phase that's the
  // one about to be (or being) worked; during a break it's the one just closed.
  const inCycle =
    phase === "work"
      ? (round % settings.longEvery) + 1
      : ((round - 1) % settings.longEvery) + 1;

  return (
    <section className="panel timer-panel">
      <div className="panel-head">
        <h2 className="panel-title">Timer</h2>
        {/* Every setting here is a pomodoro phase length, so there's nothing to
            configure while the count-up is showing. */}
        {!isCountup && (
          <button
            className="btn btn-ghost"
            onClick={() => setShowSettings((s) => !s)}
            aria-expanded={showSettings}
          >
            {showSettings ? "close" : "settings"}
          </button>
        )}
      </div>

      <div className="panel-body">
        <div className="segmented" role="group" aria-label="Timer mode">
          <button
            aria-pressed={!isCountup}
            onClick={() => setMode("pomodoro")}
          >
            Pomodoro
          </button>
          <button aria-pressed={isCountup} onClick={() => setMode("countup")}>
            Count up
          </button>
        </div>

        {showSettings && !isCountup && (
          <SettingsPanel
            settings={settings}
            updateSettings={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        <input
          className="task-input"
          type="text"
          value={task}
          maxLength={200}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What are you working on? (optional)"
          aria-label="Task name for this session"
        />
        {/* Each mode keeps its own label, since the two timers run
            independently and may well be tracking different things. */}

        <div className={`dial phase-${isCountup ? "countup" : phase}`}>
          <svg viewBox="0 0 180 180" aria-hidden="true">
            <circle className="dial-track" cx="90" cy="90" r="78" />
            {!isCountup && (
              <circle
                className="dial-progress"
                cx="90"
                cy="90"
                r="78"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - Math.min(1, Math.max(0, progress)))}
              />
            )}
          </svg>
          <div className="dial-face">
            <span className="dial-phase">
              {isCountup ? "elapsed" : PHASE_LABEL[phase]}
            </span>
            <span
              className="dial-time"
              role="timer"
              aria-live="off"
              aria-label={`${display} ${isCountup ? "elapsed" : "remaining"}`}
            >
              {display}
            </span>
            {!isCountup && (
              <span className="dial-round">
                session {inCycle} / {settings.longEvery}
              </span>
            )}
          </div>
        </div>

        {/* Reset sits apart from the main controls and small: it's the one
            action here that throws work away, so it shouldn't have the same
            visual weight as the buttons you press every session. */}
        <div className="dial-reset">
          {/* Only offered once there's something on the clock to correct. */}
          {isCountup && elapsed >= 1000 && (
            <button
              className="btn btn-ghost btn-tiny"
              onClick={() => setShowAdjust((s) => !s)}
              aria-expanded={showAdjust}
              title="Correct the time on a timer you left running"
            >
              adjust
            </button>
          )}
          <button
            className="btn btn-ghost btn-tiny"
            onClick={() => {
              setShowAdjust(false);
              reset();
            }}
            title={
              isCountup
                ? "Discard this stretch without recording it"
                : "Restart this phase without recording it"
            }
          >
            reset
          </button>
        </div>

        {isCountup && showAdjust && (
          <AdjustPanel
            elapsed={elapsed}
            onApply={adjustCountup}
            onClose={() => setShowAdjust(false)}
          />
        )}

        {isCountup && countupAdjusted && !showAdjust && (
          <p className="timer-note timer-adjusted">
            Time set by hand — this session will be marked <em>adjusted</em>.
          </p>
        )}

        <div className="timer-controls">
          <button className="btn btn-primary btn-start" onClick={toggle}>
            {running ? "Pause" : "Start"}
          </button>
          {isCountup && (
            <button
              className="btn"
              onClick={logCountup}
              disabled={elapsed < 1000}
              title="Record this stretch and clear the timer"
            >
              Finish
            </button>
          )}
          {!isCountup && (
            <button
              className="btn"
              onClick={skip}
              title="Move on, recording whatever focus time you did"
            >
              Skip
            </button>
          )}
        </div>

        {!isCountup && (
          <div className="timer-meta">
            <span>{round} completed</span>
            <button className="btn btn-ghost" onClick={resetCycle}>
              reset cycle
            </button>
          </div>
        )}

        {otherRunning && (
          <button
            className="btn btn-ghost timer-elsewhere"
            onClick={() => setMode(isCountup ? "pomodoro" : "countup")}
          >
            {isCountup ? "A pomodoro" : "The count-up"} is still running — switch
            back
          </button>
        )}

        {perm === "denied" && (
          <p className="timer-note">
            Notifications are blocked, so you'll only get the chime. Re-enable
            them in your browser's site settings if you want desktop alerts.
          </p>
        )}
      </div>
    </section>
  );
}
