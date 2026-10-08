// ── Sync ─────────────────────────────────────────────────────────────────────
//
// Opt-in. Off, none of this does anything and pomopomo is exactly what it was:
// one browser, nothing sent anywhere. On, the same data the backup exports is
// kept the same across devices through a tiny server (sync-server/) that only
// ever sees an opaque id and ciphertext — see syncCrypto.js.
//
// The shape of it:
//
// - **Pull before the app draws.** main.jsx waits (briefly) for a sync before
//   rendering, so a device opened after you used another one starts on the
//   current data, and the dailies rollover runs against the merged day.
// - **Push shortly after anything changes,** and whenever the tab is hidden.
// - **Check again on return to the tab,** and every so often while it's open.
//
// The one hard rule: merged data only goes into localStorage when the page is
// about to reload. Every component seeds itself from storage once and then owns
// its state, so writing underneath a live page would get overwritten by the
// next keystroke — and the stale copy would then sync out as if it were an
// edit. Reloading is the same move an import makes, for the same reason. It
// only happens when another device actually changed something, and never while
// you're typing: a change that arrives mid-edit waits until you pause, switch
// away, or click "update".

import { cleanData } from "./backupStore";
import { saveArchive, saveDoneMap } from "./archiveStore";
import {
  DAY_KEY,
  DEFAULT_HOUR,
  DOC_KEY,
  HOUR_KEY,
  LOG_KEY,
  STARTER as DAILIES_STARTER,
  saveLog,
} from "./dailiesStore";
import { FLUSH_EVENT } from "./markdownEditor";
import { STARTER as PLANNER_STARTER } from "./Planner";
import { saveSessions } from "./sessions";
import { freeze, load, onChange, quietly, remove, save } from "./storage";
import { deriveVault, formatCode, newCode, open, parseCode, seal } from "./syncCrypto";
import {
  MAX_CONFLICTS,
  byCopiedAt,
  byDoneAt,
  bySessionStart,
  mergeSnapshots,
  same,
} from "./syncMerge";

const CONFIG_KEY = "sync";
const BASE_KEY = "syncBase";
const EDITED_KEY = "syncEdited";
export const CONFLICTS_KEY = "syncConflicts";

// Handed across the reload that applies remote changes, so the page can say why
// it just reloaded.
const NOTICE_KEY = "pomopomo:syncNotice";

// Storage keys whose last edit time decides a clash, by snapshot field.
const EDITED = {
  planner: "planner",
  [DOC_KEY]: "dailies",
  [HOUR_KEY]: "dailiesHour",
  settings: "settings",
};

// Everything that travels. Live timer state doesn't, for the same reason it
// isn't in a backup: a running countdown belongs to the device it's running on.
const SYNCED = new Set([
  "planner",
  DOC_KEY,
  DAY_KEY,
  HOUR_KEY,
  LOG_KEY,
  "settings",
  "sessions",
  "archive",
  "done",
  CONFLICTS_KEY,
]);

const PUSH_DELAY = 2500;
const POLL_EVERY = 60_000;
const TICK = 5000;
// A change from another device is applied once you've stopped typing for this
// long. Long enough not to reload under someone who paused to think.
const IDLE_BEFORE_APPLY = 15_000;
// How long the first paint waits for the server. Past this the app draws from
// what it has, and anything newer arrives like any other remote change.
const BOOT_WAIT = 2500;
// The server refuses anything bigger; checking here gives a better message.
const MAX_BYTES = 1_500_000;

export function cleanServer(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : "";
}

export const DEFAULT_SERVER = cleanServer(import.meta.env.VITE_SYNC_URL);

class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// ── Status, for the UI ───────────────────────────────────────────────────────

let status = { state: "off", lastSynced: null, error: null, notice: null };
const subscribers = new Set();

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of subscribers) fn();
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export const getStatus = () => status;

export function clearNotice() {
  setStatus({ notice: null });
}

// ── Config and base ──────────────────────────────────────────────────────────

export function loadConfig() {
  const raw = load(CONFIG_KEY, null);
  const code = parseCode(raw?.code);
  return code ? { code, server: cleanServer(raw.server) } : null;
}

function saveConfig(config) {
  save(CONFIG_KEY, config);
}

function loadBase() {
  const raw = load(BASE_KEY, null);
  if (!raw || !Number.isInteger(raw.rev) || !raw.snapshot) return null;
  return raw;
}

/** The link that sets up another device: the code rides in the hash, which browsers never send to a server. */
export function syncLink(config) {
  const server =
    config.server && config.server !== DEFAULT_SERVER
      ? `&server=${encodeURIComponent(config.server)}`
      : "";
  return `${location.origin}${location.pathname}#sync=${formatCode(config.code)}${server}`;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

function cleanConflicts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c) =>
        c &&
        typeof c.id === "string" &&
        (c.field === "planner" || c.field === "dailies") &&
        typeof c.text === "string" &&
        Number.isFinite(c.at)
    )
    .map((c) => ({ id: c.id, field: c.field, text: c.text, at: c.at }))
    .sort(byCopiedAt)
    .slice(0, MAX_CONFLICTS);
}

function cleanEdited(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const field of Object.values(EDITED)) {
      if (Number.isFinite(raw[field])) out[field] = raw[field];
    }
  }
  return out;
}

// Local and remote both go through the backup's validation, so they always
// have the same shape and compare equal when they are equal.
function toSnapshot(raw) {
  const data = cleanData(raw);
  return {
    planner: data.planner ?? PLANNER_STARTER,
    dailies: data.dailies ?? DAILIES_STARTER,
    dailiesDay: data.dailiesDay,
    dailiesHour: data.dailiesHour ?? DEFAULT_HOUR,
    dailiesLog: data.dailiesLog,
    settings: data.settings,
    sessions: data.sessions.sort(bySessionStart),
    archive: data.archive.sort(byDoneAt),
    done: data.done,
    conflicts: cleanConflicts(raw.conflicts),
    edited: cleanEdited(raw.edited),
  };
}

function readSnapshot() {
  return toSnapshot({
    planner: load("planner", PLANNER_STARTER),
    dailies: load(DOC_KEY, DAILIES_STARTER),
    dailiesDay: load(DAY_KEY, null),
    dailiesHour: load(HOUR_KEY, DEFAULT_HOUR),
    dailiesLog: load(LOG_KEY, []),
    settings: load("settings", null),
    sessions: load("sessions", []),
    archive: load("archive", []),
    done: load("done", {}),
    conflicts: load(CONFLICTS_KEY, []),
    edited: load(EDITED_KEY, {}),
  });
}

function writeSnapshot(snap) {
  quietly(() => {
    save("planner", snap.planner);
    save(DOC_KEY, snap.dailies);
    if (snap.dailiesDay) save(DAY_KEY, snap.dailiesDay);
    save(HOUR_KEY, snap.dailiesHour);
    saveLog(snap.dailiesLog);
    if (snap.settings) save("settings", snap.settings);
    saveSessions(snap.sessions);
    saveArchive(snap.archive);
    saveDoneMap(snap.done);
    save(CONFLICTS_KEY, snap.conflicts);
    save(EDITED_KEY, snap.edited);
  });
}

export function loadConflicts() {
  return cleanConflicts(load(CONFLICTS_KEY, []));
}

/** Drop a conflict copy. Syncs like any other change, so it goes everywhere. */
export function dismissConflict(id) {
  save(
    CONFLICTS_KEY,
    loadConflicts().filter((c) => c.id !== id)
  );
}

// ── The server ───────────────────────────────────────────────────────────────

async function call(config, vault, method, body) {
  let res;
  try {
    res = await fetch(`${config.server}/v1/vault/${vault.id}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new SyncError("offline", "Can't reach the sync server.");
  }

  if (method === "GET" && res.status === 404) return null;
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* handled below */
  }
  if (res.status === 409) return { conflict: true, ...json };
  if (!res.ok || !json) {
    throw new SyncError(
      "server",
      json?.error ? `Sync server: ${json.error}` : `The sync server answered ${res.status}.`
    );
  }
  return json;
}

async function decode(vault, payload) {
  if (!payload || !Number.isInteger(payload.rev) || typeof payload.data !== "string") {
    throw new SyncError("server", "The sync server sent back something unexpected.");
  }
  let value;
  try {
    value = await open(vault, payload.data);
  } catch (e) {
    throw new SyncError(
      "locked",
      e.message === "newer"
        ? "Another device is on a newer pomopomo. Reload this page to update, then sync."
        : "The synced data couldn't be decrypted, so nothing was changed. Check the sync code matches your other devices."
    );
  }
  if (!value || typeof value !== "object") {
    throw new SyncError("locked", "The synced data is damaged, so nothing was changed.");
  }
  return { rev: payload.rev, snapshot: toSnapshot(value) };
}

// ── One sync ─────────────────────────────────────────────────────────────────

// False until the app has drawn. Before that, merged data can go straight into
// storage; after it, only on the way into a reload.
let mounted = false;
let lastInput = 0;
let lastRun = 0;

// Apply whatever the moment: the page is loading, you asked for it, or you've
// just switched away from it.
const ALWAYS = new Set(["boot", "manual", "join", "hidden"]);
// You've just come back to the tab, so seeing current data straight away beats
// being shown the old and having it swapped. Unless the return *was* a click or
// a keypress — that's you starting to do something, and a reload would eat it.
const ARRIVALS = new Set(["visible", "focus"]);

function mayApply(trigger) {
  if (!mounted || ALWAYS.has(trigger)) return true;
  const quiet = Date.now() - lastInput;
  if (ARRIVALS.has(trigger)) return quiet > 1000;
  return quiet > IDLE_BEFORE_APPLY;
}

function reloadWith(notice) {
  try {
    sessionStorage.setItem(NOTICE_KEY, JSON.stringify(notice));
  } catch {
    /* the reload still happens; it just won't explain itself */
  }
  freeze();
  location.reload();
}

async function runOnce(trigger) {
  const config = loadConfig();
  if (!config) return;
  if (!config.server) {
    setStatus({ state: "error", error: "No sync server is set." });
    return;
  }
  if (!globalThis.crypto?.subtle) {
    setStatus({
      state: "error",
      error: "This page isn't on a secure (https) connection, so the browser won't encrypt.",
    });
    return;
  }

  const startedAt = Date.now();
  setStatus({ state: "syncing" });

  try {
    const vault = await deriveVault(config.code);
    window.dispatchEvent(new Event(FLUSH_EVENT));

    const local = readSnapshot();
    const base = loadBase();
    let remote = await call(config, vault, "GET");
    if (remote) remote = await decode(vault, remote);

    // Joining is for a code another device already started. One that finds
    // nothing is far more likely a typo than an intent, and quietly starting a
    // fresh vault under it would leave this device syncing with nobody.
    if (!remote && trigger === "join") {
      remove(CONFIG_KEY);
      remove(BASE_KEY);
      setStatus({
        state: "off",
        error: "Nothing is synced under that code yet. Check it against your other device.",
      });
      return;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      let merged = local;
      let copies = 0;
      // The server still has exactly what this device last agreed with it, so
      // there's nothing to merge — only local changes to send.
      if (remote && !(base && base.rev === remote.rev)) {
        ({ snapshot: merged, copies } = mergeSnapshots(base?.snapshot ?? null, local, remote.snapshot, {
          pristine: { planner: PLANNER_STARTER, dailies: DAILIES_STARTER },
        }));
      }

      const changesHere = !same(merged, local);
      if (changesHere && !mayApply(trigger)) {
        setStatus({ state: "behind" });
        return;
      }

      let rev = remote ? remote.rev : 0;
      if (!remote || !same(merged, remote.snapshot)) {
        const sealed = await seal(vault, merged);
        if (sealed.length > MAX_BYTES) {
          throw new SyncError(
            "server",
            "There's too much to sync — the session log or archive has outgrown the server's limit."
          );
        }
        const res = await call(config, vault, "PUT", { rev, data: sealed });
        if (res.conflict) {
          // Someone else wrote first. Their version came back with the refusal,
          // so merge against that and try again.
          remote = await decode(vault, res);
          continue;
        }
        rev = res.rev;
      }

      // Turned off, or switched to another code, while that was in flight.
      if (loadConfig()?.code !== config.code) return;

      if (changesHere) {
        if (mounted && lastInput > startedAt) {
          // Typing started while this was in flight. The server has the merge,
          // and the base still says what this device last agreed to, so the next
          // run merges the new keystrokes in too. Nothing is lost by waiting.
          setStatus({ state: "behind" });
          return;
        }
        // The data first, then the base: a page that dies in between is left
        // looking like it has local edits the server already has, which merges
        // to nothing. The other order would look like this device deleting them.
        writeSnapshot(merged);
        save(BASE_KEY, { rev, snapshot: merged, at: Date.now() });
        if (mounted) {
          reloadWith({ copies, joined: trigger === "join" });
          return;
        }
        if (copies || trigger === "join") {
          setStatus({ notice: { copies, joined: trigger === "join" } });
        }
      } else {
        save(BASE_KEY, { rev, snapshot: merged, at: Date.now() });
      }

      setStatus({ state: "synced", lastSynced: Date.now(), error: null });
      return;
    }

    throw new SyncError("server", "Another device kept changing things mid-sync. Trying again shortly.");
  } catch (e) {
    if (e instanceof SyncError && e.kind === "offline") {
      setStatus({ state: "offline", error: null });
    } else {
      setStatus({
        state: "error",
        error: e instanceof SyncError ? e.message : `Sync failed: ${e.message || e}`,
      });
    }
  } finally {
    lastRun = Date.now();
  }
}

// One at a time. A trigger that lands mid-sync runs once afterwards, so a change
// made while a sync was in flight still goes out.
let inFlight = null;
let queued = null;

const WEAK = new Set(["push", "poll", "tick"]);

export function syncNow(trigger = "manual") {
  if (inFlight) {
    if (!queued || WEAK.has(queued)) queued = trigger;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      await runOnce(trigger);
    } finally {
      inFlight = null;
    }
    if (queued) {
      const next = queued;
      queued = null;
      await syncNow(next);
    }
  })();
  return inFlight;
}

// ── Turning it on and off ────────────────────────────────────────────────────

/** Start a new vault from this device's data. */
export function turnOn(server) {
  saveConfig({ code: parseCode(newCode()), server: cleanServer(server) });
  remove(BASE_KEY);
  return syncNow("manual");
}

/** Join a vault another device started. Returns false if the code isn't one. */
export function join(input, server) {
  const code = parseCode(input);
  if (!code) return false;
  if (loadConfig()?.code !== code) {
    saveConfig({ code, server: cleanServer(server) });
    remove(BASE_KEY);
  }
  syncNow("join");
  return true;
}

/** Stop syncing on this device. Its data stays exactly as it is. */
export function turnOff() {
  remove(CONFIG_KEY);
  remove(BASE_KEY);
  setStatus({ state: "off", error: null, lastSynced: null, notice: null });
}

// ── Start-up ─────────────────────────────────────────────────────────────────

/** A `#sync=…` link opened on this device: join that vault, and tidy the URL. */
function takeLink() {
  const match = /(?:^#|&)sync=([^&]+)/.exec(location.hash);
  if (!match) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const code = parseCode(params.get("sync"));
  history.replaceState(null, "", location.pathname + location.search);
  if (!code) return;

  const current = loadConfig();
  if (current?.code === code) return;
  saveConfig({
    code,
    server: cleanServer(params.get("server")) || current?.server || DEFAULT_SERVER,
  });
  remove(BASE_KEY);
  return true;
}

function takeNotice() {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(NOTICE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listen() {
  const markInput = () => {
    lastInput = Date.now();
  };
  // `beforeinput` as well as keys: phone keyboards and autocorrect edit text
  // without reliable key events, and those edits are exactly the ones to wait for.
  for (const type of ["keydown", "beforeinput", "pointerdown", "mousedown", "touchstart"]) {
    window.addEventListener(type, markInput, { capture: true, passive: true });
  }

  let pushTimer = null;
  onChange((key) => {
    if (!SYNCED.has(key) || !loadConfig()) return;
    const field = EDITED[key];
    if (field) save(EDITED_KEY, { ...load(EDITED_KEY, {}), [field]: Date.now() });
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => syncNow("push"), PUSH_DELAY);
  });

  // Tab switches fire visibilitychange and focus together; one sync covers both.
  const arrive = (trigger) => {
    if (Date.now() - lastRun > 3000 || status.state === "behind") syncNow(trigger);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) syncNow("hidden");
    else arrive("visible");
  });
  window.addEventListener("focus", () => arrive("focus"));
  window.addEventListener("online", () => arrive("visible"));
  // A sync link pasted into a tab that's already open only changes the hash.
  window.addEventListener("hashchange", () => {
    if (takeLink()) syncNow("join");
  });

  setInterval(() => {
    if (!loadConfig()) return;
    if (status.state === "behind") {
      if (Date.now() - lastInput > IDLE_BEFORE_APPLY) syncNow("tick");
    } else if (!document.hidden && Date.now() - lastRun > POLL_EVERY) {
      syncNow("poll");
    }
  }, TICK);
}

/**
 * Run before the app first renders. Waits for one sync, but never for long,
 * and never throws: sync failing must not stop pomopomo opening.
 */
export async function startSync() {
  try {
    const joined = takeLink();
    const notice = takeNotice();
    const config = loadConfig();
    if (config) {
      setStatus({
        state: "syncing",
        lastSynced: loadBase()?.at ?? null,
        notice: notice || null,
      });
      const first = syncNow(joined ? "join" : "boot");
      await Promise.race([first, new Promise((r) => setTimeout(r, BOOT_WAIT))]);
    }
    listen();
  } catch (e) {
    setStatus({ state: "error", error: `Sync failed to start: ${e.message || e}` });
  } finally {
    mounted = true;
  }
}
