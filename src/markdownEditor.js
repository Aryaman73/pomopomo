// ── The shared markdown editor ───────────────────────────────────────────────
//
// The planner and the dailies list are the same editor with different rules
// around it. What's the same: live-preview markdown, a debounced write to
// localStorage, and a flush so the last few keystrokes survive the tab closing.
// What isn't — archiving, the 4am rollover — stays in the component.

import { useCallback, useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { continueList, livePreview } from "./livePreview";
import { save } from "./storage";
import "./markdownEditor.css";

// The editor fires on every keystroke and localStorage writes are synchronous.
const SAVE_DELAY = 400;

// Slack under the last line, so the line you're typing can sit somewhere
// comfortable rather than pinned to the bottom edge. Panels are sized by hand
// now, so this is a fixed amount rather than a slice of the viewport — a
// screenful of it would leave a short panel scrolling through mostly nothing,
// and a fresh planner showing a scrollbar with nothing under it.
function makeTheme(scrollerPadding) {
  return EditorView.theme(
    {
      "&": { height: "100%", fontSize: "15px" },
      "&.cm-focused": { outline: "none" },
      ".cm-scroller": {
        fontFamily: "var(--font-mono)",
        lineHeight: "1.7",
        padding: scrollerPadding,
      },
      ".cm-content": { padding: "0", caretColor: "var(--cyan)" },
      ".cm-line": { padding: "0 4px" },
      "&.cm-focused .cm-cursor": { borderLeftColor: "var(--cyan)" },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        background: "rgba(164, 121, 255, 0.32)",
      },
      ".cm-selectionBackground": { background: "rgba(164, 121, 255, 0.18)" },
      ".cm-placeholder": { color: "var(--text-faint)" },
    },
    { dark: true }
  );
}

/**
 * Mount a live-preview markdown editor that autosaves to `storageKey`.
 *
 * `initialDoc()` is called once at mount and returns the starting text, so a
 * caller can do setup that has to happen before the first character is on
 * screen. `onChange(text, { programmatic })` fires on every edit; the flag
 * tells a caller's own `rewrite` apart from the user typing.
 *
 * Options are read through a ref, so a fresh callback on every render never
 * rebuilds the editor — that would throw away undo history and the cursor.
 */
export function useMarkdownEditor(options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const saveTimer = useRef(null);
  const programmatic = useRef(false);

  useEffect(() => {
    const { storageKey, initialDoc, hint, scrollerPadding = "4px 0 100px" } =
      optionsRef.current;

    const editor = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialDoc(),
        extensions: [
          history(),
          // continueList first so it wins the Enter key.
          keymap.of([continueList, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder(hint),
          livePreview,
          makeTheme(scrollerPadding),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();

            optionsRef.current.onChange?.(text, {
              programmatic: programmatic.current,
            });

            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => save(storageKey, text), SAVE_DELAY);
          }),
        ],
      }),
    });

    viewRef.current = editor;

    // A pending debounce would otherwise lose the last few keystrokes when the
    // tab closes.
    const flush = () => {
      clearTimeout(saveTimer.current);
      save(storageKey, editor.state.doc.toString());
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);

    return () => {
      flush();
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
      editor.destroy();
      viewRef.current = null;
    };
  }, []);

  /** Replace the whole document, flagged so `onChange` knows it wasn't typed. */
  const rewrite = useCallback((text) => {
    const editor = viewRef.current;
    if (!editor) return;
    programmatic.current = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
    programmatic.current = false;
  }, []);

  return { hostRef, viewRef, rewrite };
}
