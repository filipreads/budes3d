/**
 * Undo/redo history for the studio editor.
 *
 * The editor keeps two pieces of user-authored state (retouch settings and the
 * product configuration). Both are plain JSON, so history is a debounced stack
 * of snapshots: rapid slider drags collapse into one entry instead of flooding
 * the stack with intermediate values.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const LIMIT = 50;
const DEBOUNCE_MS = 500;

export type HistoryControls<T> = {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Drops the stack and starts again from `snapshot` (e.g. after loading a project). */
  reset: (snapshot: T) => void;
};

export function useEditorHistory<T>(snapshot: T, apply: (value: T) => void): HistoryControls<T> {
  const stack = useRef<string[]>([JSON.stringify(snapshot)]);
  const index = useRef(0);
  // Set while an undo/redo is being applied, so the resulting state change is
  // not pushed back onto the stack as a new entry.
  const travelling = useRef(false);
  const [, force] = useState(0);

  const serialized = JSON.stringify(snapshot);

  useEffect(() => {
    if (travelling.current) {
      travelling.current = false;
      return;
    }
    if (serialized === stack.current[index.current]) return;
    const timer = setTimeout(() => {
      const next = stack.current.slice(0, index.current + 1);
      next.push(serialized);
      stack.current = next.slice(-LIMIT);
      index.current = stack.current.length - 1;
      force((n) => n + 1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [serialized]);

  const travel = useCallback(
    (delta: number) => {
      const target = index.current + delta;
      const entry = stack.current[target];
      if (entry === undefined) return;
      index.current = target;
      travelling.current = true;
      apply(JSON.parse(entry) as T);
      force((n) => n + 1);
    },
    [apply],
  );

  const reset = useCallback((value: T) => {
    stack.current = [JSON.stringify(value)];
    index.current = 0;
    travelling.current = true;
    force((n) => n + 1);
  }, []);

  return {
    canUndo: index.current > 0,
    canRedo: index.current < stack.current.length - 1,
    undo: () => travel(-1),
    redo: () => travel(1),
    reset,
  };
}
