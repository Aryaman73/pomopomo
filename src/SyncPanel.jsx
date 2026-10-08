import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_SERVER,
  clearNotice,
  dismissConflict,
  getStatus,
  join,
  loadConfig,
  loadConflicts,
  subscribe,
  syncLink,
  syncNow,
  turnOff,
  turnOn,
} from "./sync";
import { formatCode } from "./syncCrypto";
import { formatDayLabel, formatTimeOfDay } from "./datetime";
import "./SyncPanel.css";

function ago(at, now) {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `on ${formatDayLabel(at)}`;
}

// Re-render on a slow clock, so "synced 2 min ago" doesn't sit at "just now".
function useNow(every) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

function StatusLine({ status, now }) {
  const since = status.lastSynced ? ` · last synced ${ago(status.lastSynced, now)}` : "";
  switch (status.state) {
    case "syncing":
      return <p className="sync-status">Syncing…</p>;
    case "synced":
      return <p className="sync-status sync-ok">Synced {ago(status.lastSynced, now)}</p>;
    case "behind":
      return (
        <p className="sync-status sync-warn">
          Another device changed things. They'll appear when you pause typing —{" "}
          <button className="sync-inline" onClick={() => syncNow("manual")}>
            update now
          </button>
          .
        </p>
      );
    case "offline":
      return (
        <p className="sync-status">
          Offline. Changes stay here and sync once you're back{since}.
        </p>
      );
    case "error":
      return <p className="backup-error">{status.error}</p>;
    default:
      return null;
  }
}

function Notice({ notice }) {
  if (!notice) return null;
  const parts = [];
  if (notice.joined) {
    parts.push(
      "This device joined sync. Its planner and dailies now match your other devices; its sessions and archive were added to theirs."
    );
  } else {
    parts.push("Updated with changes from another device.");
  }
  if (notice.copies) {
    parts.push(
      notice.copies === 1
        ? "One document had been changed in two places at once — the version that didn't win is saved below."
        : `${notice.copies} documents had been changed in two places at once — the versions that didn't win are saved below.`
    );
  }
  return (
    <div className="backup-result">
      <p>{parts.join(" ")}</p>
      <button className="btn btn-ghost btn-tiny" onClick={clearNotice}>
        ok
      </button>
    </div>
  );
}

function Conflicts({ conflicts, onDismiss }) {
  const [copied, setCopied] = useState(null);
  if (conflicts.length === 0) return null;

  const copy = async (c) => {
    try {
      await navigator.clipboard.writeText(c.text);
      setCopied(c.id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="sync-conflicts">
      <p className="sync-heading">Saved copies</p>
      <p className="backup-explain">
        When the same lines were changed on two devices before they could sync,
        one version won and the other was kept here. Copy back anything you
        need, then dismiss it.
      </p>
      <ul>
        {conflicts.map((c) => (
          <li key={c.id}>
            <div className="sync-conflict-head">
              <span>
                {c.field === "planner" ? "Planner" : "Dailies list"} ·{" "}
                {formatDayLabel(c.at)} {formatTimeOfDay(c.at)}
              </span>
              <span>
                <button className="btn btn-ghost btn-tiny" onClick={() => copy(c)}>
                  {copied === c.id ? "copied" : "copy"}
                </button>
                <button className="btn btn-ghost btn-tiny" onClick={() => onDismiss(c.id)}>
                  dismiss
                </button>
              </span>
            </div>
            <pre className="sync-conflict-text">{c.text}</pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Off({ status }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const shown = error || status.error;

  const needsServer = !DEFAULT_SERVER;
  const serverOk = /^https?:\/\/\S+/.test(server.trim());

  return (
    <>
      <p className="backup-note">
        <strong>Sync</strong> keeps the planner, dailies, session history,
        archive and timer settings the same on your phone and laptops. It's
        encrypted in this browser before it leaves: the server holds scrambled
        bytes, and the key never leaves your devices.
      </p>

      {needsServer && (
        <label className="sync-field">
          <span>Sync server</span>
          <input
            type="text"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://pomopomo-sync.you.workers.dev"
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
      )}

      <div className="sync-choice">
        <button
          className="btn btn-primary"
          disabled={!serverOk}
          onClick={() => {
            setError(null);
            turnOn(server);
          }}
        >
          Turn on sync
        </button>
        <p className="backup-explain">
          Start on the device whose planner you want to keep. You'll get a link
          to open on your other devices.
        </p>
      </div>

      <form
        className="sync-choice"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!join(code, server)) {
            setError("That isn't a sync code. It's 25 letters and numbers, like abcde-fghjk-….");
          }
        }}
      >
        <p className="sync-heading">Already syncing on another device?</p>
        <div className="sync-join">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="sync code"
            aria-label="Sync code from your other device"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button className="btn" type="submit" disabled={!code.trim() || !serverOk}>
            Join
          </button>
        </div>
        <p className="backup-explain">
          Or just open the sync link from that device. Joining replaces this
          device's planner and dailies with the synced ones (keeping a copy of
          what was here) and adds its sessions and archive to the rest.
        </p>
      </form>

      {shown && <p className="backup-error">{shown}</p>}
    </>
  );
}

function On({ status, config, conflicts, onDismiss }) {
  const now = useNow(30_000);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const link = syncLink(config);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowCode(true);
    }
  };

  return (
    <>
      <StatusLine status={status} now={now} />
      <Notice notice={status.notice} />

      <div className="sync-choice">
        <p className="sync-heading">Add another device</p>
        <div className="backup-choices">
          <button className="btn" onClick={copyLink}>
            {copied ? "Copied" : "Copy sync link"}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowCode((s) => !s)}>
            {showCode ? "hide code" : "show code"}
          </button>
        </div>
        {showCode && <p className="sync-code">{formatCode(config.code)}</p>}
        <p className="backup-explain">
          Open the link on your phone or other laptop — send it to yourself, or
          type the code into its sync panel. Anyone with the link or code can
          read and change your pomopomo, so treat it like a password.
        </p>
      </div>

      <Conflicts conflicts={conflicts} onDismiss={onDismiss} />

      <div className="backup-choices">
        <button
          className="btn btn-ghost"
          onClick={() => syncNow("manual")}
          disabled={status.state === "syncing"}
        >
          sync now
        </button>
        {confirmOff ? (
          <>
            <button
              className="btn backup-danger"
              onClick={() => {
                turnOff();
                setConfirmOff(false);
              }}
            >
              Turn off here
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmOff(false)}>
              keep syncing
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmOff(true)}>
            turn off on this device
          </button>
        )}
      </div>
      {confirmOff && (
        <p className="backup-explain">
          This device keeps its data and stops syncing. Your other devices carry
          on. Copy the link first if this is the only place you have it.
        </p>
      )}
    </>
  );
}

const DOT = {
  synced: "ok",
  syncing: "busy",
  behind: "warn",
  offline: "idle",
  error: "bad",
};

export default function SyncPanel() {
  const status = useSyncExternalStore(subscribe, getStatus);
  const config = loadConfig();
  const [open, setOpen] = useState(false);
  const [conflicts, setConflicts] = useState(loadConflicts);

  // Open by itself only for things worth stopping for: just joined, or a clash
  // left a copy behind. A plain update from another device just updates.
  useEffect(() => {
    if (status.notice && (status.notice.joined || status.notice.copies)) setOpen(true);
  }, [status.notice]);

  const dot = config ? DOT[status.state] : null;

  return (
    <div className="sync">
      <div className="sync-actions">
        <button
          className="btn btn-ghost"
          onClick={() => {
            setOpen((o) => !o);
            setConflicts(loadConflicts());
          }}
          aria-expanded={open}
          title={config ? `Sync: ${status.state}` : "Sync between your devices"}
        >
          {dot && <span className={`sync-dot sync-dot-${dot}`} aria-hidden="true" />}
          {open ? "close" : "sync"}
          {conflicts.length > 0 && !open && ` (${conflicts.length})`}
        </button>
      </div>

      {open && (
        <div className="panel backup-panel">
          <div className="panel-body">
            {config ? (
              <On
                status={status}
                config={config}
                conflicts={conflicts}
                onDismiss={(id) => {
                  dismissConflict(id);
                  setConflicts(loadConflicts());
                }}
              />
            ) : (
              <Off status={status} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
