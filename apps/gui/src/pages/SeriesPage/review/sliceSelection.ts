import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Gmail-like selection of Series images (pure state transitions + hook).
 * Identity is the image id (the stable database id of the DICOM instance),
 * never a list position or file name. Selection is independent of the
 * active (displayed) slice.
 */

/**
 * Toggles `id`. With `range` (shift-click) and an anchor, every image
 * between the anchor and `id` (in `ordered`) gets the toggled state of `id`.
 */
export const toggleSelection = (
  selected: ReadonlySet<string>,
  id: string,
  ordered: readonly string[],
  anchor: string | null,
  range = false
): Set<string> => {
  const next = new Set(selected);
  const select = !selected.has(id);
  const from = anchor === null ? -1 : ordered.indexOf(anchor);
  const to = ordered.indexOf(id);
  if (range && from >= 0 && to >= 0) {
    const [start, end] = from < to ? [from, to] : [to, from];
    for (const item of ordered.slice(start, end + 1)) {
      if (select) next.add(item);
      else next.delete(item);
    }
    return next;
  }
  if (select) next.add(id);
  else next.delete(id);
  return next;
};

/** Selected ids still present in the list (images can disappear on reload). */
export const pruneSelection = (
  selected: ReadonlySet<string>,
  ids: readonly string[]
): Set<string> => {
  const present = new Set(ids);
  return new Set([...selected].filter((id) => present.has(id)));
};

export interface SliceSelection {
  /** Selected ids (only ids of `ids`). */
  selected: ReadonlySet<string>;
  /** Selected ids in list order. */
  selectedIds: string[];
  toggle: (id: string, range?: boolean) => void;
  /** Selects every id, or clears when all are selected. */
  toggleAll: () => void;
  clear: () => void;
}

/** Selection over `ids` (list order). */
export const useSliceSelection = (ids: readonly string[]): SliceSelection => {
  const [raw, setRaw] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const selected = useMemo(() => pruneSelection(raw, ids), [raw, ids]);
  const selectedIds = useMemo(
    () => ids.filter((id) => selected.has(id)),
    [ids, selected]
  );
  const toggle = useCallback((id: string, range = false) => {
    // Read now: React may run the updater after the anchor moved on.
    const from = anchor.current;
    const ordered = idsRef.current;
    setRaw((previous) =>
      toggleSelection(pruneSelection(previous, ordered), id, ordered, from, range)
    );
    anchor.current = id;
  }, []);
  const toggleAll = useCallback(() => {
    setRaw((previous) => {
      const current = pruneSelection(previous, idsRef.current);
      return current.size === idsRef.current.length
        ? new Set()
        : new Set(idsRef.current);
    });
  }, []);
  const clear = useCallback(() => {
    anchor.current = null;
    setRaw(new Set());
  }, []);
  return { selected, selectedIds, toggle, toggleAll, clear };
};
