import { act, renderHook } from '@testing-library/react';
import { pruneSelection, toggleSelection, useSliceSelection } from './sliceSelection';

const ids = ['a', 'b', 'c', 'd', 'e'];
const set = (...values: string[]) => new Set(values);

describe('toggleSelection', () => {
  it('selects and deselects one id', () => {
    expect(toggleSelection(set(), 'b', ids, null)).toEqual(set('b'));
    expect(toggleSelection(set('b', 'c'), 'b', ids, 'b')).toEqual(set('c'));
  });

  it('shift-click applies the clicked state to the range from the anchor', () => {
    expect(toggleSelection(set('b'), 'd', ids, 'b', true)).toEqual(set('b', 'c', 'd'));
    // Backwards too.
    expect(toggleSelection(set('d'), 'a', ids, 'd', true)).toEqual(set('a', 'b', 'c', 'd'));
    // Deselecting a range.
    expect(toggleSelection(set('a', 'b', 'c', 'd'), 'c', ids, 'a', true)).toEqual(set('d'));
  });

  it('without a usable anchor a range click is a plain toggle', () => {
    expect(toggleSelection(set(), 'c', ids, null, true)).toEqual(set('c'));
    expect(toggleSelection(set(), 'c', ids, 'gone', true)).toEqual(set('c'));
  });
});

describe('pruneSelection', () => {
  it('keeps only ids still in the list (stable ids, not positions)', () => {
    expect(pruneSelection(set('a', 'x', 'c'), ['c', 'a'])).toEqual(set('a', 'c'));
  });
});

describe('useSliceSelection', () => {
  it('select all toggles; clear empties; selectedIds keep list order', () => {
    const { result, rerender } = renderHook(({ list }) => useSliceSelection(list), {
      initialProps: { list: ids },
    });
    act(() => result.current.toggle('d'));
    act(() => result.current.toggle('a'));
    expect(result.current.selectedIds).toEqual(['a', 'd']);
    act(() => result.current.toggleAll());
    expect(result.current.selectedIds).toEqual(ids);
    act(() => result.current.toggleAll());
    expect(result.current.selectedIds).toEqual([]);
    act(() => result.current.toggle('e'));
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);

    // Images that disappear from the list leave the selection.
    act(() => result.current.toggle('b'));
    rerender({ list: ['a', 'c'] });
    expect(result.current.selectedIds).toEqual([]);
  });
});
