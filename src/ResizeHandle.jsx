// A drag handle along the bottom edge of a panel, for panels whose height is
// the user's call rather than the layout's.
//
// Pointer events rather than mouse events, so a phone can drag it too, and
// pointer capture so a fast drag that leaves the handle doesn't drop it.

import { useCallback, useEffect, useRef, useState } from "react";
import { load, save } from "./storage";
import "./ResizeHandle.css";

// Tall enough that no panel can be dragged into uselessness on a big screen,
// and not so tall that a stored value can strand a small one.
const MAX_HEIGHT = 1600;

/** A panel height the user has set, remembered across reloads. */
export function usePanelHeight(key, fallback, min) {
  const clamp = useCallback(
    (value) => Math.min(MAX_HEIGHT, Math.max(min, Math.round(value))),
    [min]
  );

  const [height, setStored] = useState(() => {
    const stored = load(key, null);
    return Number.isFinite(stored) ? clamp(stored) : fallback;
  });

  // Whatever we started at — either a height the user set before or the
  // default.
  const opened = useRef(height);

  // Only heights the user actually moved to are written. Storing the default on
  // sight would freeze it, and a later change to that default would then never
  // reach anyone who had merely opened the app. Comparing values rather than
  // counting renders, because StrictMode runs this effect twice on mount.
  //
  // Debounced: a drag produces a height per pointer event, and localStorage
  // writes are synchronous.
  useEffect(() => {
    if (height === opened.current) return;
    const id = setTimeout(() => save(key, height), 250);
    return () => clearTimeout(id);
  }, [key, height]);

  const setHeight = useCallback((value) => setStored(clamp(value)), [clamp]);

  return [height, setHeight];
}

export default function ResizeHandle({ height, setHeight, min, label }) {
  const drag = useRef(null);

  const onPointerDown = (event) => {
    // Keeps the drag from selecting text or scrolling the page under it.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, from: height };
  };

  const onPointerMove = (event) => {
    if (!drag.current) return;
    setHeight(drag.current.from + (event.clientY - drag.current.y));
  };

  const end = (event) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Dragging is a pointer gesture; this gives the same control to a keyboard.
  const onKeyDown = (event) => {
    const direction =
      event.key === "ArrowDown" || event.key === "PageDown"
        ? 1
        : event.key === "ArrowUp" || event.key === "PageUp"
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    setHeight(height + direction * (event.key.startsWith("Page") ? 80 : 20));
  };

  return (
    <div
      className="resize-handle"
      // A separator is what this is: the thing between a panel and what's below
      // it, which the user can move.
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={height}
      aria-valuemin={min}
      aria-valuemax={MAX_HEIGHT}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setHeight(min)}
      title={`${label} — drag, or double-click for the smallest it goes`}
    >
      <span className="resize-grip" aria-hidden="true" />
    </div>
  );
}
