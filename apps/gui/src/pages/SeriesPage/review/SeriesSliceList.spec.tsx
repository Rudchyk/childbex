/**
 * The virtualised slice list when its panel is collapsed and restored: the
 * browser drops the scroll position of a hidden list, so the list reads it
 * again and brings the active slice back into view (no blank rows).
 */
import { act, render, screen } from '@testing-library/react';
import { ReviewState } from '@libs/schemas';
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
