// Phase-end alerts: a synthesized chime and a browser notification.
//
// The chime is generated with Web Audio rather than shipped as an mp3 — no
// asset to load, no CORS or MIME surprises on Pages, and it's a few lines.

let ctx = null;

function audioContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

// Browsers refuse to start an AudioContext outside a user gesture. Call this
// from the click handler that starts a timer, so the context is already running
// by the time a phase ends minutes later with no gesture in sight.
export function unlockAudio() {
  const ac = audioContext();
  if (ac && ac.state === "suspended") ac.resume().catch(() => {});
}

function tone(ac, freq, startAt, duration, peak) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  // Quick attack, exponential decay — a bell, not a beep.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain).connect(ac.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

// Two different arpeggios so you can tell, without looking, whether you just
// earned a break or just lost one.
const CHIMES = {
  // Rising major triad — work is over.
  work: [523.25, 659.25, 783.99],
  // Falling — break is over, back to it.
  break: [783.99, 587.33, 440.0],
};

export function playChime(kind = "work") {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === "suspended") ac.resume().catch(() => {});

  const notes = CHIMES[kind] || CHIMES.work;
  const now = ac.currentTime + 0.02;
  notes.forEach((freq, i) => tone(ac, freq, now + i * 0.16, 0.85, 0.22));
}

export function notificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission() {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notify(title, body) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  // Don't stack notifications if the user has been away a while.
  try {
    new Notification(title, { body, tag: "pomopomo-phase", icon: "./favicon.svg" });
  } catch {
    /* some browsers throw for non-persistent notifications; ignore */
  }
}
