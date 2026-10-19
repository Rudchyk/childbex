/**
 * Issue #39: an ordinary click on a live patient's row opens the patient in
 * the same tab (router PUSH), while the grid's own controls (inline edits,
 * ID copy, row actions and their dialogs, sorting, search) keep working
 * without navigating. Runs the real DataGrid, router and editing; only the
 * RTK mutations, auth and notifications are faked. Synthetic patients only.
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import {
  matchRoutes,
  MemoryRouter,
  NavigateFunction,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import type { GetPatientsResponse } from '@libs/schemas';
import type { GridCellParams, MuiEvent } from '@mui/x-data-grid';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { TextEncoder } from 'node:util';

// The DataGrid hashes its styles with TextEncoder when loaded (absent in jsdom).
globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;
const { Patients } =
  jest.requireActual<typeof import('./Patients')>('./Patients');
const { shouldOpenPatientOnCellClick } = jest.requireActual<
  typeof import('./patientRowNavigation')
>('./patientRowNavigation');
const { appRoutes } = jest.requireActual<
  typeof import('../../routes/appRoutes')
>('../../routes/appRoutes');

type Patient = GetPatientsResponse[0];

const mockUpdatePatient = jest.fn();
const mockDeletePatient = jest.fn();
const mockTrashAction = jest.fn();
let mockIsAdmin = false;

jest.mock('../../store/apis', () => ({
  useUpdatePatientMutation: () => [mockUpdatePatient, {}],
  useDeletePatientMutation: () => [mockDeletePatient, {}],
  useDeleteOrRestoreTrashedPatientMutation: () => [mockTrashAction, {}],
}));
jest.mock('../../store/slices', () => ({
  usePatients: () => ({ isLoading: false }),
}));
jest.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin }),
}));
jest.mock('../../modules/notifications', () => ({
  useNotifications: () => ({
    notifyInfo: jest.fn(),
    notifyError: jest.fn(),
    notifySuccess: jest.fn(),
  }),
}));
// The components barrel also exports the DICOM viewer (ESM-only deps).
jest.mock('../../components', () => ({
  ...jest.requireActual(
    '../../components/lib/DataGridColumnsPanelTrigger/DataGridColumnsPanelTrigger'
  ),
  ...jest.requireActual(
    '../../components/lib/DataGridFilterPanelTrigger/DataGridFilterPanelTrigger'
  ),
  ...jest.requireActual(
    '../../components/lib/DataGridExportCsv/DataGridExportCsv'
  ),
  ...jest.requireActual(
    '../../components/lib/DataGridExportPrint/DataGridExportPrint'
  ),
  ...jest.requireActual(
    '../../components/lib/DataGridQuickFilter/DataGridQuickFilter'
  ),
  ...jest.requireActual(
    '../../components/lib/DialogAreYouSure/DialogAreYouSure'
  ),
}));

const patient = (n: number, overrides: Partial<Patient> = {}): Patient => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Synthetic Patient ${n}`,
  slug: `synthetic-${n}`,
  notes: `note ${n}`,
  creatorId: '00000000-0000-4000-8000-0000000000aa',
  creatorName: 'Synthetic Creator',
  createdAt: `2026-01-0${n}T10:00:00.000Z`,
  updatedAt: `2026-01-0${n}T10:00:00.000Z`,
  deletedAt: null,
  studyCount: n,
  imageCount: n * 10,
  ...overrides,
});

const LIVE = patient(1);
const OTHER = patient(2);
const TRASHED = patient(3, { deletedAt: '2026-02-01T10:00:00.000Z' });

const PatientProbe = () => {
  const { slug } = useParams();
  return <h1>Patient details {slug}</h1>;
};

let setRows: (rows: Patient[]) => void = () => undefined;
const PatientsHarness = ({ initial }: { initial: Patient[] }) => {
  const [rows, set] = useState(initial);
  setRows = set;
  return <Patients data={rows} isLoading={false} isError={false} />;
};

const setMobile = (mobile: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

const renderPatients = ({
  rows = [LIVE, OTHER],
  admin = false,
  mobile = false,
  initialEntries = [guiRoutes.patients],
}: {
  rows?: Patient[];
  admin?: boolean;
  mobile?: boolean;
  initialEntries?: string[];
} = {}) => {
  mockIsAdmin = admin;
  setMobile(mobile);
  // Every committed location change, in order ("PUSH /patients/x").
  const navigations: string[] = [];
  const history = {
    pathname: '',
    navigate: (() => undefined) as NavigateFunction,
  };
  const HistoryProbe = () => {
    const location = useLocation();
    const action = useNavigationType();
    history.navigate = useNavigate();
    history.pathname = location.pathname;
    const lastKey = useRef(location.key);
    useEffect(() => {
      if (location.key !== lastKey.current) {
        lastKey.current = location.key;
        navigations.push(`${action} ${location.pathname}`);
      }
    }, [location, action]);
    return null;
  };
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <HistoryProbe />
      <Routes>
        <Route
          path={guiRoutes.patients}
          element={<PatientsHarness initial={rows} />}
        />
        <Route path={guiRoutes.patient} element={<PatientProbe />} />
      </Routes>
    </MemoryRouter>
  );
  const router = {
    pathname: () => history.pathname,
    back: () => history.navigate(-1),
    forward: () => history.navigate(1),
  };
  return { router, navigations };
};

const cell = (row: Patient, field: string) => {
  const element = document.querySelector<HTMLElement>(
    `[role="row"][data-id="${row.id}"] [data-field="${field}"]`
  );
  if (!element) {
    throw new Error(`No ${field} cell for ${row.slug}`);
  }
  return element;
};

/** The toolbar quick filter, as a user opens and types into it. */
const search = (value: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.change(screen.getByPlaceholderText('Search...'), {
    target: { value },
  });
};

const path = (router: { pathname: () => string }) => router.pathname();

let windowOpen: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  windowOpen = jest.spyOn(window, 'open').mockImplementation(() => null);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  windowOpen.mockRestore();
});

describe('Patients row navigation (desktop)', () => {
  it('a primary click on a plain cell pushes the patient once, in the same tab', async () => {
    const { router, navigations } = renderPatients();
    fireEvent.click(cell(LIVE, 'creatorName'));
    await screen.findByText('Patient details synthetic-1');
    expect(navigations).toEqual(['PUSH /patients/synthetic-1']);
    expect(windowOpen).not.toHaveBeenCalled();
    expect(path(router)).toBe('/patients/synthetic-1');
  });

  it.each(['creatorName', 'studyCount', 'imageCount', 'createdAt'])(
    'the non-editable %s cell navigates',
    async (field) => {
      const { navigations } = renderPatients();
      fireEvent.click(cell(OTHER, field));
      await screen.findByText('Patient details synthetic-2');
      expect(navigations).toEqual(['PUSH /patients/synthetic-2']);
    }
  );

  it('Back returns to Patients and Forward reopens the same patient', async () => {
    const { router, navigations } = renderPatients();
    fireEvent.click(cell(LIVE, 'createdAt'));
    await screen.findByText('Patient details synthetic-1');

    await act(() => router.back());
    expect(path(router)).toBe('/patients');
    expect(cell(LIVE, 'name').textContent).toBe('Synthetic Patient 1');

    await act(() => router.forward());
    expect(path(router)).toBe('/patients/synthetic-1');
    await screen.findByText('Patient details synthetic-1');
    expect(navigations).toEqual([
      'PUSH /patients/synthetic-1',
      'POP /patients',
      'POP /patients/synthetic-1',
    ]);
  });

  it('the patient URL is directly loadable (refresh/bookmark)', async () => {
    renderPatients({ initialEntries: ['/patients/synthetic-2'] });
    await screen.findByText('Patient details synthetic-2');
    // The app route table resolves the URL the grid pushes.
    const match = matchRoutes(appRoutes, '/patients/synthetic-2')?.at(-1);
    expect(match?.route.path).toBe(guiRoutes.patient);
    expect(match?.params).toEqual({ slug: 'synthetic-2' });
  });

  it('the row returned to after Back is still sortable and searchable', async () => {
    const { router, navigations } = renderPatients();
    fireEvent.click(cell(LIVE, 'createdAt'));
    await screen.findByText('Patient details synthetic-1');
    await act(() => router.back());

    fireEvent.click(screen.getByRole('columnheader', { name: /Created At/ }));
    expect(
      screen
        .getByRole('columnheader', { name: /Created At/ })
        .getAttribute('aria-sort')
    ).toBe('ascending');
    search('synthetic-2');
    await waitFor(() =>
      expect(document.querySelector(`[data-id="${LIVE.id}"]`)).toBeNull()
    );
    expect(cell(OTHER, 'name')).toBeTruthy();
    expect(navigations).toEqual([
      'PUSH /patients/synthetic-1',
      'POP /patients',
    ]);
  });
});

describe('Patients grid controls do not navigate', () => {
  it('the ID copy button copies without navigating', () => {
    const { router, navigations } = renderPatients();
    fireEvent.click(within(cell(LIVE, 'id')).getByRole('button'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LIVE.id);
    // The padding of the ID cell does not navigate either.
    fireEvent.click(cell(LIVE, 'id'));
    expect(navigations).toEqual([]);
    expect(path(router)).toBe('/patients');
  });

  it.each(['name', 'slug', 'notes'])(
    'a click on the editable %s cell does not navigate',
    (field) => {
      const { navigations } = renderPatients();
      fireEvent.click(cell(LIVE, field));
      expect(navigations).toEqual([]);
    }
  );

  it.each([
    ['name', 'Renamed Synthetic'],
    ['slug', 'renamed-synthetic'],
    ['notes', 'renamed note'],
  ])(
    'double-click editing of %s commits the update without navigating',
    async (field, value) => {
      const { navigations } = renderPatients();
      fireEvent.click(cell(LIVE, field));
      fireEvent.doubleClick(cell(LIVE, field));
      const input = within(cell(LIVE, field)).getByRole('textbox');
      fireEvent.click(input);
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(mockUpdatePatient).toHaveBeenCalledWith({
          id: LIVE.id,
          [field]: value,
        })
      );
      fireEvent.click(cell(LIVE, field));
      expect(navigations).toEqual([]);
    }
  );

  it('cancelling an edit with Escape does not navigate or update', async () => {
    const { navigations } = renderPatients();
    fireEvent.doubleClick(cell(LIVE, 'name'));
    const input = within(cell(LIVE, 'name')).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() =>
      expect(within(cell(LIVE, 'name')).queryByRole('textbox')).toBeNull()
    );
    expect(cell(LIVE, 'name').textContent).toBe('Synthetic Patient 1');
    expect(mockUpdatePatient).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
  });

  it('Enter on an editable cell starts editing, not navigation', () => {
    const { navigations } = renderPatients();
    fireEvent.click(cell(LIVE, 'name'));
    fireEvent.keyDown(cell(LIVE, 'name'), { key: 'Enter' });
    expect(within(cell(LIVE, 'name')).getByRole('textbox')).toBeTruthy();
    expect(navigations).toEqual([]);
  });

  it('Delete and its confirmation dialog do not navigate', async () => {
    const { navigations } = renderPatients();
    const actions = cell(LIVE, 'actions');
    fireEvent.click(
      within(actions).getByRole('menuitem', { name: 'Delete patient' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Disagree' }));
    expect(mockDeletePatient).not.toHaveBeenCalled();

    // The closing dialog keeps the grid aria-hidden until it has exited.
    fireEvent.click(
      await within(actions).findByRole('menuitem', { name: 'Delete patient' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agree' }));
    expect(mockDeletePatient).toHaveBeenCalledWith({ id: LIVE.id });
    fireEvent.click(actions);
    expect(navigations).toEqual([]);
  });

  it('sorting, the filter panel and the search box do not navigate', async () => {
    const { navigations } = renderPatients();
    fireEvent.click(screen.getByRole('columnheader', { name: /Creator/ }));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    search('Synthetic');
    await waitFor(() => expect(cell(LIVE, 'name')).toBeTruthy());
    expect(navigations).toEqual([]);
  });

  it('right-clicks and modified clicks on a plain cell do not navigate', () => {
    const { navigations } = renderPatients();
    const target = cell(LIVE, 'creatorName');
    fireEvent.contextMenu(target);
    fireEvent.click(target, { button: 2 });
    fireEvent.click(target, { button: 1 });
    fireEvent.click(target, { ctrlKey: true });
    fireEvent.click(target, { metaKey: true });
    fireEvent.click(target, { shiftKey: true });
    fireEvent.click(target, { altKey: true });
    expect(navigations).toEqual([]);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('a click that ends a text selection does not navigate', () => {
    const { navigations } = renderPatients();
    const selection = jest.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'Synthetic Creator',
    } as unknown as Selection);
    fireEvent.click(cell(LIVE, 'creatorName'));
    selection.mockRestore();
    expect(navigations).toEqual([]);
  });

  it('Enter and Space on a plain cell keep their grid meaning', () => {
    const { navigations } = renderPatients();
    fireEvent.keyDown(cell(LIVE, 'creatorName'), { key: 'Enter' });
    fireEvent.keyDown(cell(LIVE, 'creatorName'), { key: ' ' });
    expect(navigations).toEqual([]);
  });
});

describe('Patients open link', () => {
  // What remains for the browser after React handled the click.
  let defaultPrevented: boolean[];
  const recordDefault = (event: MouseEvent) => {
    defaultPrevented.push(event.defaultPrevented);
    event.preventDefault(); // jsdom cannot perform a real document navigation
  };
  beforeEach(() => {
    defaultPrevented = [];
    window.addEventListener('click', recordDefault);
  });
  afterEach(() => window.removeEventListener('click', recordDefault));

  const openLink = (row: Patient) =>
    within(cell(row, 'open')).getByRole('link', {
      name: `Open patient ${row.name}`,
    });

  it('is a same-tab link with a meaningful accessible name', () => {
    renderPatients();
    const link = openLink(LIVE);
    expect(link.getAttribute('href')).toBe('/patients/synthetic-1');
    expect(link.hasAttribute('target')).toBe(false);
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
  });

  it('a primary click navigates exactly once (no extra row navigation)', async () => {
    const { navigations } = renderPatients();
    fireEvent.click(openLink(LIVE));
    await screen.findByText('Patient details synthetic-1');
    expect(navigations).toEqual(['PUSH /patients/synthetic-1']);
    expect(defaultPrevented).toEqual([true]);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['middle', { button: 1 }],
  ])('a %s-click is left to the browser (new tab/window)', (_, init) => {
    const { navigations } = renderPatients();
    fireEvent.click(openLink(LIVE), init);
    expect(defaultPrevented).toEqual([false]);
    expect(navigations).toEqual([]);
  });

  it('is reached with the grid arrow keys and opened by Enter', async () => {
    const { navigations } = renderPatients();
    // The grid stays a single tab stop: unfocused cells' links are -1.
    expect(openLink(LIVE).tabIndex).toBe(-1);
    const header = screen.getByRole('columnheader', { name: 'Open' });
    act(() => header.focus());
    // Arrow keys move the grid focus; the focused cell delegates to its link.
    fireEvent.keyDown(header, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(openLink(LIVE)));
    expect(openLink(LIVE).tabIndex).toBe(0);
    fireEvent.keyDown(openLink(LIVE), { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(openLink(OTHER)));
    // Enter on a link: keydown (grid leaves it alone), then the click.
    fireEvent.keyDown(openLink(OTHER), { key: 'Enter' });
    expect(navigations).toEqual([]);
    fireEvent.click(openLink(OTHER));
    await screen.findByText('Patient details synthetic-2');
    expect(navigations).toEqual(['PUSH /patients/synthetic-2']);
  });
});

describe('Patients trashed rows', () => {
  it('have no link and do not navigate on click', () => {
    const { navigations } = renderPatients({
      rows: [LIVE, TRASHED],
      admin: true,
    });
    expect(within(cell(TRASHED, 'open')).queryByRole('link')).toBeNull();
    for (const field of [
      'open',
      'name',
      'creatorName',
      'studyCount',
      'createdAt',
    ]) {
      fireEvent.click(cell(TRASHED, field));
    }
    expect(navigations).toEqual([]);
    expect(
      document.querySelector('a[href="/patients/synthetic-3"]')
    ).toBeNull();
  });

  it('are not editable', () => {
    renderPatients({ rows: [TRASHED], admin: true });
    fireEvent.doubleClick(cell(TRASHED, 'name'));
    expect(within(cell(TRASHED, 'name')).queryByRole('textbox')).toBeNull();
  });

  it('keep the admin restore and permanent-delete actions, which do not navigate', async () => {
    const { navigations } = renderPatients({ rows: [TRASHED], admin: true });
    const actions = cell(TRASHED, 'actions');
    // Trash offers Restore and permanent Delete (no soft Delete).
    expect(
      within(actions)
        .getAllByRole('menuitem')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Restore patient', 'Delete patient']);

    fireEvent.click(
      within(actions).getByRole('menuitem', { name: 'Restore patient' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agree' }));
    expect(mockTrashAction).toHaveBeenCalledWith({
      id: TRASHED.id,
      type: 'restore',
    });

    fireEvent.click(
      await within(actions).findByRole('menuitem', { name: 'Delete patient' })
    );
    expect(mockTrashAction).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Disagree' }));
    expect(navigations).toEqual([]);
  });

  it('becomes navigable once restored', async () => {
    const { navigations } = renderPatients({ rows: [TRASHED], admin: true });
    fireEvent.click(cell(TRASHED, 'creatorName'));
    expect(navigations).toEqual([]);

    act(() => setRows([{ ...TRASHED, deletedAt: null }]));
    expect(
      within(cell(TRASHED, 'open')).getByRole('link').getAttribute('href')
    ).toBe('/patients/synthetic-3');
    fireEvent.click(cell(TRASHED, 'creatorName'));
    await screen.findByText('Patient details synthetic-3');
    expect(navigations).toEqual(['PUSH /patients/synthetic-3']);
  });
});

describe('Patients row navigation (mobile)', () => {
  it('uses the mobile columns with the name as the link', () => {
    renderPatients({ mobile: true, rows: [LIVE, TRASHED], admin: true });
    expect(document.querySelector('[data-field="creatorName"]')).toBeNull();
    const link = within(cell(LIVE, 'name')).getByRole('link', {
      name: 'Synthetic Patient 1',
    });
    expect(link.getAttribute('href')).toBe('/patients/synthetic-1');
    expect(link.hasAttribute('target')).toBe(false);
    expect(within(cell(TRASHED, 'name')).queryByRole('link')).toBeNull();
    expect(cell(TRASHED, 'name').textContent).toBe('Synthetic Patient 3');
  });

  it('the name link navigates once, with no extra row navigation', async () => {
    const { navigations } = renderPatients({ mobile: true });
    fireEvent.click(within(cell(LIVE, 'name')).getByRole('link'));
    await screen.findByText('Patient details synthetic-1');
    expect(navigations).toEqual(['PUSH /patients/synthetic-1']);
  });

  it('other plain cells navigate; actions and trashed rows do not', async () => {
    const { navigations } = renderPatients({
      mobile: true,
      rows: [LIVE, TRASHED],
      admin: true,
    });
    fireEvent.click(cell(TRASHED, 'name'));
    fireEvent.click(cell(TRASHED, 'studyCount'));
    fireEvent.click(
      within(cell(LIVE, 'actions')).getByRole('menuitem', {
        name: 'Delete patient',
      })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Disagree' }));
    expect(navigations).toEqual([]);

    fireEvent.click(cell(LIVE, 'studyCount'));
    await screen.findByText('Patient details synthetic-1');
    expect(navigations).toEqual(['PUSH /patients/synthetic-1']);
  });
});

describe('shouldOpenPatientOnCellClick (event policy)', () => {
  // A navigable cell of a live patient, as the DataGrid reports it.
  const params = {
    row: LIVE,
    field: 'creatorName',
    cellMode: 'view',
    isEditable: false,
    colDef: { type: 'string' },
  } as unknown as GridCellParams<Patient>;
  const click = (
    currentTarget: Element,
    target: Element,
    init: Partial<ReactMouseEvent<HTMLElement>> = {}
  ) =>
    ({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      currentTarget,
      target,
      ...init,
    } as unknown as MuiEvent<ReactMouseEvent<HTMLElement>>);

  let gridCell: HTMLElement;
  beforeEach(() => {
    gridCell = document.createElement('div');
    gridCell.innerHTML =
      '<span>text</span><button type="button"><svg></svg></button>' +
      '<input /><a href="/x">link</a><div role="button">fake</div>';
    document.body.append(gridCell);
  });
  afterEach(() => gridCell.remove());
  const el = (selector: string) => gridCell.querySelector(selector) as Element;

  it('opens on a plain cell or its plain text', () => {
    expect(
      shouldOpenPatientOnCellClick(params, click(gridCell, gridCell))
    ).toBe(true);
    expect(
      shouldOpenPatientOnCellClick(params, click(gridCell, el('span')))
    ).toBe(true);
  });

  it.each(['button', 'svg', 'input', 'a', '[role="button"]'])(
    'never opens from an interactive descendant (%s)',
    (selector) => {
      expect(
        shouldOpenPatientOnCellClick(params, click(gridCell, el(selector)))
      ).toBe(false);
    }
  );

  it('never opens for a click handled already (e.g. a router link)', () => {
    expect(
      shouldOpenPatientOnCellClick(
        params,
        click(gridCell, gridCell, { defaultPrevented: true })
      )
    ).toBe(false);
  });

  it('never opens for a click from a portal rendered by the cell (a dialog)', () => {
    const dialog = document.createElement('div');
    document.body.append(dialog);
    expect(shouldOpenPatientOnCellClick(params, click(gridCell, dialog))).toBe(
      false
    );
    dialog.remove();
  });
});
