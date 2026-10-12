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

// ── The header button ────────────────────────────────────────────────────────
//
// Only there while sync is on. It's both the status and the way to sync now:
// the label says where things stand, and clicking it syncs. When another
// device's changes are waiting, that click is what applies them.

const BUTTON = {
  synced: { dot: "ok", label: "synced" },
  syncing: { dot: "busy", label: "syncing…" },
  behind: { dot: "warn", label: "update" },
  offline: { dot: "idle", label: "offline" },
  error: { dot: "bad", label: "sync failed" },
};

function SyncButton({ status }) {
  const now = useNow(30_000);
  const look = BUTTON[status.state] || BUTTON.syncing;

  let title = "Sync now";
  if (status.state === "behind") title = "Another device changed things — click to show them";
  else if (status.state === "error") title = `${status.error} Click to try again.`;
  else if (status.lastSynced) title = `Last synced ${ago(status.lastSynced, now)} — click to sync now`;

  return (
    <button
      className="btn btn-ghost sync-button"
      onClick={() => syncNow("manual")}
      disabled={status.state === "syncing"}
      title={title}
    >
      <span className={`sync-dot sync-dot-${look.dot}`} aria-hidden="true" />
      {look.label}
    </button>
  );
}

// ── Panel pieces ─────────────────────────────────────────────────────────────

function Notice({ notice }) {
  if (!notice) return null;
  const parts = [notice.joined ? "This device is now syncing." : "Updated with changes from another device."];
  if (notice.copies) {
    parts.push(
      notice.copies === 1
        ? "One document had been changed on two devices at once — the other version is saved below."
        : `${notice.copies} documents had been changed on two devices at once — the other versions are saved below.`
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
        The same lines were changed on two devices before they could sync. One
        version won; the other is here. Copy back anything you need, then
        dismiss it.
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

// ── Sync off: two fields, two buttons ────────────────────────────────────────

function Setup({ status, form, setForm }) {
  const [error, setError] = useState(null);
  const shown = error || status.error;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const serverOk = /^https?:\/\/\S+/.test(form.server.trim());
  const busy = status.state === "syncing";

  return (
    <>
      <p className="backup-note">
        Keep pomopomo the same on your phone and laptops. Everything is
        encrypted on this device before it's sent.
      </p>

      <form
        className="sync-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!join(form.code, form.server, form.access)) {
            setError("That isn't a sync code. It's 25 letters and numbers, like abcde-fghjk-….");
          }
        }}
      >
        {!DEFAULT_SERVER && (
          <label className="sync-field">
            <span>Sync server</span>
            <input
              type="text"
              value={form.server}
              onChange={set("server")}
              placeholder="https://pomopomo-sync.you.workers.dev"
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
        )}

        <label className="sync-field">
          <span>Access key</span>
          <input
            type="password"
            value={form.access}
            onChange={set("access")}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </label>

        <label className="sync-field">
          <span>Sync code</span>
          <input
            type="text"
            value={form.code}
            onChange={set("code")}
            placeholder="from your other device"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </label>

        <div className="sync-buttons">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !serverOk || !form.access.trim() || !form.code.trim()}
          >
            Sync with this code
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !serverOk || !form.access.trim()}
            onClick={() => {
              setError(null);
              turnOn(form.server, form.access);
            }}
          >
            Create a new code
          </button>
        </div>

        <p className="backup-explain">
          Already syncing somewhere else? Enter that device's code. Setting up
          your first device? Leave the code empty and create one.
        </p>
      </form>

      {shown && <p className="backup-error">{shown}</p>}
    </>
  );
}

// ── Sync on: what to type on the next device ─────────────────────────────────

function Settings({ status, config, conflicts, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(syncLink(config));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <Notice notice={status.notice} />
      {status.state === "error" && <p className="backup-error">{status.error}</p>}

      <div className="sync-form">
        <p className="sync-heading">To add another device</p>
        <dl className="sync-code">
          <dt>Access key</dt>
          <dd>
            {showKey ? config.access || "none" : "••••••••"}{" "}
            <button className="sync-inline" onClick={() => setShowKey((s) => !s)}>
              {showKey ? "hide" : "show"}
            </button>
          </dd>
          <dt>Sync code</dt>
          <dd className="sync-code-value">{formatCode(config.code)}</dd>
        </dl>
        <p className="backup-explain">
          Type these into sync settings there and press <strong>Sync with this
          code</strong> — or copy the link and open it there, which does both.
          Anyone with the code can read your pomopomo, so keep it to yourself.
        </p>
        <button className="btn" onClick={copyLink}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <Conflicts conflicts={conflicts} onDismiss={onDismiss} />

      <div className="sync-off">
        {confirmOff ? (
          <>
            <p className="backup-explain">
              This device keeps its data and stops syncing; your other devices
              carry on. Note the code first if this is the only place you have it.
            </p>
            <div className="sync-buttons">
              <button
                className="btn backup-danger"
                onClick={() => {
                  turnOff();
                  setConfirmOff(false);
                }}
              >
                Stop syncing here
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmOff(false)}>
                cancel
              </button>
            </div>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmOff(true)}>
            stop syncing on this device
          </button>
        )}
      </div>
    </>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

export default function SyncPanel() {
  const status = useSyncExternalStore(subscribe, getStatus);
  const config = loadConfig();
  const [open, setOpen] = useState(false);
  const [conflicts, setConflicts] = useState(loadConflicts);
  // Up here so what you've typed survives a failed attempt, which briefly
  // switches the panel over to the "on" view and back.
  const [form, setForm] = useState({ server: DEFAULT_SERVER, access: "", code: "" });

  // Open by itself only for things worth stopping for: just joined, or a clash
  // left a copy behind. A plain update from another device just updates.
  useEffect(() => {
    if (status.notice && (status.notice.joined || status.notice.copies)) setOpen(true);
  }, [status.notice]);

  return (
    <div className="sync">
      <div className="sync-actions">
        {config && <SyncButton status={status} />}
        <button
          className="btn btn-ghost"
          onClick={() => {
            setOpen((o) => !o);
            setConflicts(loadConflicts());
          }}
          aria-expanded={open}
        >
          {open ? "close" : "sync settings"}
          {conflicts.length > 0 && !open && ` (${conflicts.length})`}
        </button>
      </div>

      {open && (
        <div className="panel backup-panel">
          <div className="panel-body">
            {config ? (
              <Settings
                status={status}
                config={config}
                conflicts={conflicts}
                onDismiss={(id) => {
                  dismissConflict(id);
                  setConflicts(loadConflicts());
                }}
              />
            ) : (
              <Setup status={status} form={form} setForm={setForm} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
