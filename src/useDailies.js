// State for the dailies list: the rollover hour, the log of closed days that
// the streak counts, and today's tally.
//
// It lives up here rather than inside the panel because two components need it
// — the list itself and the history panel — and because the mount-time rollover
// has to happen before the editor exists.

import { useCallback, useEffect, useRef, useState } from "react";
import { countTasks } from "./markdown";
import {
  addDay,
  applyRollover,
  clampHour,
  loadDailies,
  loadHour,
  loadLog,
  saveHour,
  saveLog,
} from "./dailiesStore";

export function useDailies() {
  // One read, before anything renders: loading the document is also what closes
  // out a day that ended while the app was shut.
  const [start] = useState(() => {
    const hour = loadHour();
    const { text, closed, day } = loadDailies(hour);
    const log = loadLog();
    return { hour, day, doc: text, log: closed ? addDay(log, closed) : log };
  });

  const [hour, setHourState] = useState(start.hour);
  const [day, setDay] = useState(start.day);
  const [log, setLog] = useState(start.log);
  const [counts, setCounts] = useState(() => countTasks(start.doc));

  useEffect(() => saveLog(log), [log]);

  // Mirror, so the rollover callback can stay stable while still seeing the
  // current hour.
  const hourRef = useRef(hour);
  hourRef.current = hour;

  const setHour = useCallback((value) => {
    const next = clampHour(value);
    setHourState(next);
    saveHour(next);
  }, []);

  /**
   * Close out the day if it has turned. Returns the text the list should now
   * hold, or null when the day hasn't turned — the caller owns the editor, so
   * it does the rewriting.
   */
  const rollOver = useCallback((text) => {
    const rolled = applyRollover(text, hourRef.current);
    if (!rolled) return null;
    setLog((list) => addDay(list, rolled.closed));
    setDay(rolled.today);
    return rolled.text;
  }, []);

  return {
    hour,
    setHour,
    // The day the ticks currently on screen belong to.
    day,
    log,
    counts,
    setCounts,
    rollOver,
    initialDoc: start.doc,
  };
}
