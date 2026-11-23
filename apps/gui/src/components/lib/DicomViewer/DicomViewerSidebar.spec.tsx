/**
 * The standalone viewer's image list: collapses to a compact control next
 * to the viewport, keeps its rows (and the slice on screen) while hidden,
 * and its rows are buttons that ask the viewer for a slice index.
 * Synthetic file names only.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DicomViewerSidebar,
  SIDEBAR_WIDTH,
  type Item,
} from './DicomViewerSidebar';

const items: Item[] = [0, 1, 2].map((index) => ({
  imageUid: `uid-${index}`,
  source: `series-a/slice-${index}.dcm`,
  index,
}));

/** The sidebar with its expansion state, as the viewer owns it. */
const Harness = ({
  currentImageId,
  onJumpTo = jest.fn(),
}: {
  currentImageId?: string;
  onJumpTo?: (index: number) => void;
}) => {
  const [expanded, setExpanded] = useState(true);
  return (
    <DicomViewerSidebar
      items={items}
      currentImageId={currentImageId}
      onJumpTo={onJumpTo}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    />
  );
};

const panel = () => screen.getByTestId('dicom-image-list');
const toggle = () => screen.getByRole('button', { name: /image list$/ });

describe('DicomViewerSidebar', () => {
  it('starts expanded: the list is shown and the toggle says it hides it', () => {
    render(<Harness />);
    const button = toggle();
    expect(button.getAttribute('aria-label')).toBe('Hide image list');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Files' });
    expect(button.getAttribute('aria-controls')).toBe(list.id);
    expect(list.id).not.toBe('');
    expect(screen.getAllByRole('button', { name: /slice-\d\.dcm/ })).toHaveLength(3);
    expect(getComputedStyle(panel()).width).toBe(`${SIDEBAR_WIDTH}px`);
  });

  it('collapses to a compact control and opens again, with the same toggle element', () => {
    render(<Harness />);
    const button = toggle();

    fireEvent.click(button);
    // The same, still shown element: keyboard focus stays on it.
    expect(toggle()).toBe(button);
    expect(button.isConnected).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Show image list');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(getComputedStyle(panel()).width).toBe(`${COLLAPSED_SIDEBAR_WIDTH}px`);
    // Still the controlled element (mounted), but hidden: its rows are out
    // of the accessibility tree and take no clicks over the viewer.
    const list = document.getElementById(button.getAttribute('aria-controls') ?? '');
    expect(list).not.toBeNull();
    expect(list?.parentElement?.hidden).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files' })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /slice-\d\.dcm/ })).toHaveLength(0);

    fireEvent.click(button);
    expect(button.getAttribute('aria-label')).toBe('Hide image list');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(panel()).width).toBe(`${SIDEBAR_WIDTH}px`);
    expect(screen.getAllByRole('button', { name: /slice-\d\.dcm/ })).toHaveLength(3);
  });

  it('has a tooltip naming the action', async () => {
    render(<Harness />);
    fireEvent.mouseOver(toggle());
    expect((await screen.findByRole('tooltip')).textContent).toBe('Hide image list');
  });

  it('keeps the display order (last slice first) and the slice indexes', () => {
    render(<Harness />);
    const names = screen
      .getAllByRole('button', { name: /slice-\d\.dcm/ })
      .map((row) => row.textContent);
    expect(names).toEqual(['slice-2.dcm', 'slice-1.dcm', 'slice-0.dcm']);
  });

  it('asks for the clicked or keyboard-activated slice index', () => {
    const onJumpTo = jest.fn();
    render(<Harness onJumpTo={onJumpTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'slice-1.dcm' }));
    expect(onJumpTo).toHaveBeenLastCalledWith(1);

    const row = screen.getByRole('button', { name: 'slice-2.dcm' });
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onJumpTo).toHaveBeenLastCalledWith(2);

    const other = screen.getByRole('button', { name: 'slice-0.dcm' });
    act(() => other.focus());
    fireEvent.keyDown(other, { key: ' ' });
    fireEvent.keyUp(other, { key: ' ' });
    expect(onJumpTo).toHaveBeenLastCalledWith(0);
    expect(onJumpTo).toHaveBeenCalledTimes(3);
  });

  it('keeps the slice on screen highlighted across collapse and expand', () => {
    render(<Harness currentImageId="uid-1" />);
    const current = () => screen.getByRole('button', { name: 'slice-1.dcm' });
    expect(current().getAttribute('aria-current')).toBe('true');
    expect(current().classList).toContain('Mui-selected');

    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(current().getAttribute('aria-current')).toBe('true');
    expect(current().classList).toContain('Mui-selected');
    const others = screen
      .getAllByRole('button', { name: /slice-[02]\.dcm/ })
      .filter((row) => row.getAttribute('aria-current'));
    expect(others).toHaveLength(0);
  });

  it('scrolls only the list to the slice on screen, also when shown again', () => {
    const { rerender } = render(<Harness currentImageId="uid-2" />);
    const list = screen.getByRole('list', { name: 'Files' });
    const rows = within(list).getAllByRole('listitem');
    // Rows of 40px in a 100px list (jsdom has no layout).
    rows.forEach((row, i) => {
      Object.defineProperty(row, 'offsetTop', { value: i * 40, configurable: true });
      Object.defineProperty(row, 'offsetHeight', { value: 40, configurable: true });
    });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      rerender(<Harness currentImageId="uid-0" />); // last row: below the fold
      expect(list.scrollTop).toBe(80 - 30);

      // The browser drops a hidden list's scroll position: restored on expand.
      fireEvent.click(toggle());
      list.scrollTop = 0;
      fireEvent.click(toggle());
      expect(list.scrollTop).toBe(50);
      // Never scrolls the page (no scrollIntoView).
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
