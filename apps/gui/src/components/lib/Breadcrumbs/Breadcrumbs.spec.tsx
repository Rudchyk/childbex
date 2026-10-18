/**
 * Breadcrumbs: a page's explicit trail, else the static route's own label;
 * labels and parent links never come from the URL's segments.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs, BreadcrumbItem } from './Breadcrumbs';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const STUDY = '44444444-4444-4444-8444-444444444444';

const renderAt = (pathname: string, items?: BreadcrumbItem[]) =>
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <Breadcrumbs items={items} />
    </MemoryRouter>
  );

const nav = () => screen.getByRole('navigation', { name: 'breadcrumb' });
const links = () =>
  within(nav())
    .queryAllByRole('link')
    .map((a) => [a.textContent, a.getAttribute('href')]);
const current = () =>
  nav().querySelector('[aria-current="page"]')?.textContent;

describe('Breadcrumbs', () => {
  it('renders nothing on the home page', () => {
    renderAt('/');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it.each([
    ['/patients', 'Patients'],
    ['/about', 'About'],
    ['/dashboard', 'Dashboard'],
    ['/dwv', 'Dicom Viewer'],
  ])('labels the static route %s as %s, the current page', (path, label) => {
    renderAt(path);
    expect(links()).toEqual([['Home', '/']]);
    expect(current()).toBe(label);
  });

  it('never turns segments of other URLs into labels or links', () => {
    renderAt(`/patients/${PATIENT}/studies/${STUDY}/series`);
    expect(links()).toEqual([['Home', '/']]);
    expect(current()).toBeUndefined();
    expect(nav().textContent).not.toMatch(/studies|series|1111/);
  });

  it('renders a page trail: ancestors with a route link, the current page is text', () => {
    renderAt(`/patients/${PATIENT}/studies/${STUDY}`, [
      { label: 'Patients', to: '/patients' },
      { label: 'Patient' },
      { label: 'Study 2026-01-02', to: '/not-a-link' },
    ]);
    expect(links()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
    ]);
    // An ancestor without a resolved route is plain text, not a link.
    expect(within(nav()).getByText('Patient').closest('a')).toBeNull();
    expect(current()).toBe('Study 2026-01-02');
    expect(within(nav()).getByText('Study 2026-01-02').closest('a')).toBeNull();
  });
});
