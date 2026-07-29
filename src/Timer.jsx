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
    toggle,
    reset,
    skip,
    resetCycle,
  } = props;

  const [showSettings, setShowSettings] = useState(false);
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
        <button
          className="btn btn-ghost"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
        >
          {showSettings ? "close" : "settings"}
        </button>
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

        <div className="timer-controls">
          <button className="btn btn-primary btn-start" onClick={toggle}>
            {running ? "Pause" : "Start"}
          </button>
          <button className="btn" onClick={reset}>
            Reset
          </button>
          {!isCountup && (
            <button className="btn" onClick={skip}>
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
