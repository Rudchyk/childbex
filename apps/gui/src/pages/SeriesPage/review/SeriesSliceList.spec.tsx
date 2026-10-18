/**
 * The virtualised slice list when its panel is collapsed and restored: the
 * browser drops the scroll position of a hidden list, so the list reads it
 * again and brings the active slice back into view (no blank rows).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PatientImageReviewVoteTypes, ReviewState } from '@libs/schemas';
import { ROW_HEIGHT, SeriesSliceList, type SliceRow } from './SeriesSliceList';

/** Synthetic slices (no patient data). */
const ROWS: SliceRow[] = Array.from({ length: 200 }, (_, index) => ({
  id: `img-${index}`,
  index,
  instanceNumber: index + 1,
  opinion: null,
  reviewState: ReviewState.NOT_REVIEWED,
}));

let resize: () => void = () => undefined;
let height = 360;

beforeEach(() => {
  height = 360;
  (window as { ResizeObserver?: unknown }).ResizeObserver = jest.fn().mockImplementation(
    (callback: () => void) => {
      resize = () => act(() => callback());
      return { observe: jest.fn(), disconnect: jest.fn() };
    }
  );
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as { ResizeObserver?: unknown }).ResizeObserver;
});

const renderList = (activeId: string) =>
  render(
    <SeriesSliceList
      rows={ROWS}
      activeId={activeId}
      selected={new Set()}
      onToggle={jest.fn()}
      onToggleAll={jest.fn()}
      onNavigate={jest.fn()}
    />
  );

const renderedIds = () =>
  screen.getAllByTestId('slice-row').map((row) => row.getAttribute('data-image-id'));

it('shows the active slice again after the list was hidden and shown', () => {
  renderList('img-150');
  const list = screen.getByRole('list', { name: 'Series slices' });
  resize();
  expect(renderedIds()).toContain('img-150');

  // Collapsed: no size. Restored: the browser starts it at the top again.
  height = 0;
  resize();
  list.scrollTop = 0;
  height = 360;
  resize();

  expect(list.scrollTop).toBe(150 * ROW_HEIGHT - 360 / 2);
  expect(renderedIds()).toContain('img-150');
});

it('renders the rows at the scroll position it is shown with', () => {
  renderList('img-0');
  const list = screen.getByRole('list', { name: 'Series slices' });
  resize();

  height = 0;
  resize();
  // Shown again at another position, the active slice still in view.
  list.scrollTop = 100 * ROW_HEIGHT;
  height = 360;
  resize();
  expect(renderedIds()).toContain('img-0');
  expect(renderedIds()).not.toContain('img-100');

  // A plain resize while shown keeps the user's scroll position.
  list.scrollTop = 100 * ROW_HEIGHT;
  height = 400;
  resize();
  expect(list.scrollTop).toBe(100 * ROW_HEIGHT);
  expect(renderedIds()).toContain('img-100');
});

/**
 * Issue #38: the slice on screen (active), the selection and the opinions
 * are three separate states; a checkbox click selects and asks once for
 * its slice.
 */
describe('active slice, selection and navigation', () => {
  const rowOf = (id: string) =>
    screen.getAllByTestId('slice-row').find((row) => row.getAttribute('data-image-id') === id) as HTMLElement;
  const checkboxOf = (id: string) => within(rowOf(id)).getByRole('checkbox');

  const setup = (
    props: Partial<Parameters<typeof SeriesSliceList>[0]> = {},
    rows: SliceRow[] = ROWS.slice(0, 5)
  ) => {
    const onToggle = jest.fn();
    const onToggleAll = jest.fn();
    const onNavigate = jest.fn();
    render(
      <SeriesSliceList
        rows={rows}
        selected={new Set()}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onNavigate={onNavigate}
        {...props}
      />
    );
    return { onToggle, onToggleAll, onNavigate };
  };

  /** The visual state of a row, without MUI's generated class names. */
  const look = (id: string) => {
    const row = rowOf(id);
    const style = getComputedStyle(row);
    return {
      active: row.getAttribute('data-active'),
      selected: row.getAttribute('aria-selected'),
      current: within(row).getByRole('button').getAttribute('aria-current'),
      marker: !!within(row).queryByTestId('active-slice-marker'),
      checked: (within(row).getByRole('checkbox') as HTMLInputElement).checked,
      /** The active frame and leading bar. */
      framed: style.boxShadow.includes('inset'),
      /** The active (primary) tint over the whole row. */
      tinted: style.backgroundImage.includes('gradient'),
      /** The selection's background. */
      shaded: !['', 'transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor),
      bold: getComputedStyle(within(row).getByText(/^Slice/)).fontWeight === '700',
    };
  };

  it('tells active, selected, both and ordinary rows apart', () => {
    setup({ activeId: 'img-1', selected: new Set(['img-2', 'img-1']) });
    expect(look('img-0')).toEqual({
      active: 'false', selected: 'false', current: null, marker: false,
      checked: false, framed: false, tinted: false, shaded: false, bold: false,
    });
    // Selected only: neutral background and checked box, no frame or marker.
    expect(look('img-2')).toEqual({
      active: 'false', selected: 'true', current: null, marker: false,
      checked: true, framed: false, tinted: false, shaded: true, bold: false,
    });
    // Active and selected: the active frame, marker and bold label stay.
    expect(look('img-1')).toEqual({
      active: 'true', selected: 'true', current: 'true', marker: true,
      checked: true, framed: true, tinted: true, shaded: true, bold: true,
    });
  });

  it('an active row that is not selected is framed and marked, its box unchecked', () => {
    setup({ activeId: 'img-3' });
    expect(look('img-3')).toMatchObject({
      active: 'true', selected: 'false', current: 'true', marker: true,
      checked: false, framed: true, tinted: true, shaded: false, bold: true,
    });
    expect(screen.getAllByTestId('active-slice-marker')).toHaveLength(1);
  });

  it('keeps the opinion and conflict marks on the active row', () => {
    const rows: SliceRow[] = [
      {
        ...ROWS[0],
        reviewState: ReviewState.CONFLICTED,
        opinion: { vote: PatientImageReviewVoteTypes.ABNORMAL, source: 'explicit' },
      },
      { ...ROWS[1], opinion: { vote: PatientImageReviewVoteTypes.UNCERTAIN, source: 'explicit' } },
    ];
    setup({ activeId: 'img-0', selected: new Set(['img-0']) }, rows);
    expect(within(rowOf('img-0')).getByLabelText('Conflict')).toBeTruthy();
    expect(within(rowOf('img-0')).getByLabelText('Your opinion: Abnormal')).toBeTruthy();
    expect(within(rowOf('img-1')).getByLabelText('Your opinion: Not sure')).toBeTruthy();
  });

  it.each([
    ['unchecked', new Set<string>()],
    ['checked', new Set(['img-3'])],
  ])('a click on an %s checkbox toggles it and navigates to it once', (_, selected) => {
    const calls: string[] = [];
    const { onToggle, onNavigate } = setup({ activeId: 'img-0', selected });
    onToggle.mockImplementation(() => calls.push('toggle'));
    onNavigate.mockImplementation(() => calls.push('navigate'));

    fireEvent.click(checkboxOf('img-3'));
    expect(onToggle.mock.calls).toEqual([['img-3', false]]);
    expect(onNavigate.mock.calls).toEqual([[3]]);
    expect(calls).toEqual(['toggle', 'navigate']);
    // A request only: the list never marks the target active itself.
    expect(rowOf('img-3').getAttribute('data-active')).toBe('false');
    expect(rowOf('img-0').getAttribute('data-active')).toBe('true');
  });

  it('a shift-click asks for a range and navigates once, to the clicked slice', () => {
    const { onToggle, onNavigate } = setup();
    fireEvent.click(checkboxOf('img-4'), { shiftKey: true });
    expect(onToggle.mock.calls).toEqual([['img-4', true]]);
    expect(onNavigate.mock.calls).toEqual([[4]]);
  });

  it('a row click navigates without selecting; Select all selects without navigating', () => {
    const { onToggle, onToggleAll, onNavigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show Slice 3 · #3' }));
    expect(onNavigate.mock.calls).toEqual([[2]]);
    expect(onToggle).not.toHaveBeenCalled();

    onNavigate.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all slices' }));
    expect(onToggleAll).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('the checkbox and the row work from the keyboard', () => {
    const { onToggle, onNavigate } = setup();
    const box = checkboxOf('img-1');
    box.focus();
    expect(document.activeElement).toBe(box);
    // Space on a focused checkbox, Enter on a button: the browser clicks it.
    act(() => box.click());
    expect(onToggle.mock.calls).toEqual([['img-1', false]]);
    expect(onNavigate.mock.calls).toEqual([[1]]);

    const button = screen.getByRole('button', { name: 'Show Slice 2 · #2' });
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(onNavigate.mock.calls).toEqual([[1], [1]]);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('highlights nothing without an active slice or for an id not in the list', () => {
    setup({ activeId: 'not-listed' });
    expect(screen.queryAllByTestId('active-slice-marker')).toEqual([]);
    expect(
      screen.getAllByTestId('slice-row').filter((row) => row.getAttribute('data-active') === 'true')
    ).toEqual([]);
  });

  it('with hundreds of slices, mounts few rows and navigates by the row\'s own slice index', () => {
    // Reverse order, as in the Series page: list position != slice index.
    const many: SliceRow[] = Array.from({ length: 600 }, (_, i) => ({
      ...ROWS[0],
      id: `big-${599 - i}`,
      index: 599 - i,
      instanceNumber: 600 - i,
    }));
    const { onToggle, onNavigate } = setup({ activeId: 'big-150' }, many);
    resize();
    const mounted = screen.getAllByTestId('slice-row');
    expect(mounted.length).toBeLessThan(60);
    // The active slice was scrolled into view and is the only active row.
    expect(rowOf('big-150').getAttribute('data-active')).toBe('true');
    expect(mounted.filter((row) => row.getAttribute('data-active') === 'true')).toHaveLength(1);

    fireEvent.click(checkboxOf('big-140'));
    expect(onToggle.mock.calls).toEqual([['big-140', false]]);
    expect(onNavigate.mock.calls).toEqual([[140]]);
  });

  it('the active row stays highlighted after the list is hidden and shown', () => {
    setup({ activeId: 'img-120' }, ROWS);
    resize();
    height = 0;
    resize();
    screen.getByRole('list', { name: 'Series slices' }).scrollTop = 0;
    height = 360;
    resize();
    expect(rowOf('img-120').getAttribute('data-active')).toBe('true');
    expect(within(rowOf('img-120')).getByTestId('active-slice-marker')).toBeTruthy();
  });
});
