/**
 * Component-level tests of the real AddPatient dialog: real form, dialog,
 * upload hooks, upload core and HTTP transport. Only the network edges are
 * faked (fetch, the chunk XMLHttpRequest and the RTK addPatient mutation).
 *
 * Invariants:
 * - one explicit Send -> at most one addPatient();
 * - an unfinished upload / already created patient for the archive ->
 *   no addPatient() until the user explicitly sends again;
 * - Discard alone never calls addPatient().
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { SnackbarProvider } from 'notistack';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { AddPatient } from './AddPatient';

type FakeSession = {
  uploadId: string;
  patientId: string;
  status: string;
  fileSize: number;
  extension: string;
  clientFingerprint?: string;
  chunkSize: number;
  totalChunks: number;
  stored: Set<number>;
};

const mockAddPatientCalls: { name: string }[] = [];
const mockPatients = new Map<string, { id: string; name: string }>();
const mockServer = {
  sessions: new Map<string, FakeSession>(),
  rejectSessionCreation: false,
  calls: [] as string[],
  puts: [] as number[],
  nextId: 1,
};

jest.mock('../../../store/apis', () => {
  const React = jest.requireActual('react');
  const initial = { isLoading: false, isSuccess: false, isError: false };
  let patientNo = 300;
  return {
    apiBaseUrl: '/api/v1',
    TagTypesEnum: { PATIENTS: 'patients', PATIENT: 'patient' },
    apiStore: { util: { invalidateTags: () => ({ type: 'noop' }) } },
    useGetPatientQuery: (arg: { id: string }, opts?: { skip?: boolean }) => ({
      data: opts?.skip ? undefined : mockPatients.get(arg.id),
    }),
    // Behaves like an RTK Query mutation: trigger -> loading -> success.
    useAddPatientMutation: () => {
      const [state, setState] = React.useState(initial);
      const trigger = React.useCallback((body: { name: string }) => {
        mockAddPatientCalls.push(body);
        setState({ ...initial, isLoading: true });
        setTimeout(() => {
          const id = `00000000-0000-4000-8000-000000000${patientNo++}`;
          const patient = { id, name: body.name };
          mockPatients.set(id, patient);
          setState({ ...initial, isSuccess: true, data: patient });
        }, 5);
      }, []);
      const reset = React.useCallback(() => setState(initial), []);
      return [trigger, { ...state, reset }];
    },
  };
});
jest.mock('../../../store/useAppStore', () => ({
  useAppDispatch: () => jest.fn(),
}));
jest.mock('../../../store/slices', () => ({
  usePatients: () => ({ setIsLoading: jest.fn() }),
}));
// The components barrel also exports the DICOM viewer (ESM-only deps).
jest.mock('../../../components', () => ({
  DialogForm: jest.requireActual(
    '../../../components/lib/DialogForm/DialogForm'
  ).DialogForm,
  FormUITextField: jest.requireActual(
    '../../../components/lib/FormUITextField/FormUITextField'
  ).FormUITextField,
  FormUIFileInput: jest.requireActual(
    '../../../components/lib/FormUIFileInput/FormUIFileInput'
  ).FormUIFileInput,
}));

const view = (s: FakeSession) => {
  const { stored, ...rest } = s;
  return {
    ...rest,
    receivedChunks: [...stored].sort((a, b) => a - b),
    missingChunks: Array.from({ length: s.totalChunks }, (_, i) => i).filter(
      (i) => !stored.has(i)
    ),
    expiresAt: new Date().toISOString(),
    retryable: false,
  };
};

const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Fake chunked-upload API. */
const fakeFetch = async (
  url: string,
  init: { method?: string; body?: string } = {}
) => {
  const method = init.method ?? 'GET';
  const path = url.replace('/api/v1', '');
  mockServer.calls.push(`${method} ${path}`);
  let m: RegExpMatchArray | null;
  if (method === 'GET' && path === '/upload-sessions') {
    return reply(
      200,
      [...mockServer.sessions.values()]
        .filter((s) => s.status !== 'completed')
        .map(view)
    );
  }
  if ((m = path.match(/^\/patients\/([^/]+)\/upload-sessions$/))) {
    if (mockServer.rejectSessionCreation) {
      return reply(400, {
        message: 'Upload rejected.',
        code: 'INVALID_REQUEST',
      });
    }
    const body = JSON.parse(init.body ?? '{}');
    const s: FakeSession = {
      uploadId: `upload-${mockServer.nextId++}`,
      patientId: m[1],
      status: 'uploading',
      fileSize: body.fileSize,
      extension: '.tar',
      clientFingerprint: body.clientFingerprint,
      chunkSize: 10,
      totalChunks: Math.ceil(body.fileSize / 10),
      stored: new Set(),
    };
    mockServer.sessions.set(s.uploadId, s);
    return reply(201, view(s));
  }
  if ((m = path.match(/^\/patients\/([^/]+)$/)) && method === 'GET') {
    const patient = mockPatients.get(m[1]);
    return patient ? reply(200, patient) : reply(404, {});
  }
  if ((m = path.match(/^\/upload-sessions\/([^/]+)\/complete$/))) {
    const s = mockServer.sessions.get(m[1]);
    if (!s) return reply(404, {});
    s.status = 'completed';
    return reply(202, view(s));
  }
  if ((m = path.match(/^\/upload-sessions\/([^/]+)$/))) {
    const s = mockServer.sessions.get(m[1]);
    if (!s) return reply(404, {});
    if (method === 'DELETE') {
      mockServer.sessions.delete(m[1]);
      return reply(204, null);
    }
    return reply(200, view(s));
  }
  return reply(404, {});
};

class FakeXHR {
  upload: { onprogress?: (e: { loaded: number }) => void } = {};
  status = 0;
  responseText = '';
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  ontimeout?: () => void;
  private url = '';
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {
    return undefined;
  }
  abort() {
    this.onabort?.();
  }
  send() {
    setTimeout(() => {
      const m = this.url.match(/upload-sessions\/([^/]+)\/chunks\/(\d+)/);
      const index = Number(m?.[2]);
      mockServer.sessions.get(m?.[1] ?? '')?.stored.add(index);
      mockServer.puts.push(index);
      this.status = 201;
      this.responseText = '{}';
      this.onload?.();
    }, 1);
  }
}

beforeAll(() => {
  Object.assign(globalThis, {
    TextEncoder,
    fetch: fakeFetch,
    XMLHttpRequest: FakeXHR,
  });
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
  Blob.prototype.arrayBuffer ??= function (this: Blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(this);
    });
  };
});

beforeEach(() => {
  mockAddPatientCalls.length = 0;
  mockPatients.clear();
  mockServer.sessions.clear();
  mockServer.rejectSessionCreation = false;
  mockServer.calls = [];
  mockServer.puts = [];
  localStorage.clear();
});

const LAST_MODIFIED = 1_700_000_000_000;
const archiveFile = () =>
  new File([new Uint8Array(90)], 'pasichnyk.tar', {
    lastModified: LAST_MODIFIED,
  });
const fingerprintOf = (file: File) =>
  createHash('sha256')
    .update([file.name, file.size, file.lastModified].join('\n'))
    .digest('hex');

const EXISTING_PATIENT = '00000000-0000-4000-8000-000000000224';

/** An unfinished session with 6 of 9 parts, e.g. from before a reload. */
const seedUnfinishedUpload = (fingerprint?: string) => {
  mockPatients.set(EXISTING_PATIENT, {
    id: EXISTING_PATIENT,
    name: 'pasichnyk-224',
  });
  mockServer.sessions.set('upload-existing', {
    uploadId: 'upload-existing',
    patientId: EXISTING_PATIENT,
    status: 'uploading',
    fileSize: 90,
    extension: '.tar',
    clientFingerprint: fingerprint,
    chunkSize: 10,
    totalChunks: 9,
    stored: new Set([0, 1, 2, 3, 4, 5]),
  });
};

const wait = (ms = 100) => act(() => new Promise((r) => setTimeout(r, ms)));

const openDialog = async () => {
  fireEvent.click(
    screen.getAllByLabelText('Add patient', { selector: 'button' })[0]
  );
  await waitFor(() =>
    expect(document.querySelector('input[type=file]')).toBeTruthy()
  );
};

const selectArchive = async () => {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [archiveFile()] } });
  await waitFor(() => expect(screen.getByText('pasichnyk.tar')).toBeTruthy());
};

const sendButton = () =>
  screen.getByRole('button', { name: 'Send', hidden: true });

const renderDialog = async () => {
  render(
    <SnackbarProvider>
      <AddPatient />
    </SnackbarProvider>
  );
  await openDialog();
  await selectArchive();
};

const prompt = () => screen.queryByText(/unfinished upload of this archive/i);

describe('AddPatient: one Send, at most one patient', () => {
  it('creates exactly one patient and uploads to it', async () => {
    await renderDialog();
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect([...mockServer.sessions.values()][0]?.status).toBe('completed')
    );
    expect(mockAddPatientCalls).toHaveLength(1);
    const [session] = [...mockServer.sessions.values()];
    expect(session.clientFingerprint).toBe(fingerprintOf(archiveFile()));
    expect(mockServer.puts.sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('a fast double click creates only one patient', async () => {
    await renderDialog();
    fireEvent.click(sendButton());
    fireEvent.click(sendButton());
    await wait(300);
    expect(mockAddPatientCalls).toHaveLength(1);
  });

  it('Enter in the form plus a click creates only one patient', async () => {
    await renderDialog();
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);
    fireEvent.click(sendButton());
    await wait(300);
    expect(mockAddPatientCalls).toHaveLength(1);
  });
});

describe('AddPatient: an unfinished upload of the archive exists', () => {
  it('offers to resume and does not create a patient', async () => {
    seedUnfinishedUpload(fingerprintOf(archiveFile()));
    await renderDialog();
    fireEvent.click(sendButton());
    await waitFor(() => expect(prompt()).toBeTruthy());
    await wait();
    expect(mockAddPatientCalls).toHaveLength(0);
    // Send is blocked until the user decides.
    fireEvent.click(sendButton());
    await wait();
    expect(mockAddPatientCalls).toHaveLength(0);
  });

  it('Resume continues for the original patient with only the missing parts', async () => {
    seedUnfinishedUpload(fingerprintOf(archiveFile()));
    await renderDialog();
    fireEvent.click(sendButton());
    await waitFor(() => expect(prompt()).toBeTruthy());
    fireEvent.click(
      screen.getByRole('button', { name: 'Resume', hidden: true })
    );
    await waitFor(() =>
      expect(mockServer.sessions.get('upload-existing')?.status).toBe(
        'completed'
      )
    );
    expect(mockAddPatientCalls).toHaveLength(0);
    expect(mockServer.puts.sort((a, b) => a - b)).toEqual([6, 7, 8]);
    expect(
      mockServer.calls.filter(
        (c) => c.endsWith('/upload-sessions') && c.startsWith('POST')
      )
    ).toEqual([]);
  });

  it('Discard alone never creates a patient; only a separate Send does', async () => {
    seedUnfinishedUpload(fingerprintOf(archiveFile()));
    await renderDialog();
    fireEvent.click(sendButton());
    await waitFor(() => expect(prompt()).toBeTruthy());

    fireEvent.click(
      screen.getByRole('button', { name: 'Discard', hidden: true })
    );
    await waitFor(() => expect(prompt()).toBeNull());
    await wait(300);

    expect(mockServer.calls).toContain(
      'DELETE /upload-sessions/upload-existing'
    );
    expect(mockServer.sessions.has('upload-existing')).toBe(false);
    expect(mockAddPatientCalls).toHaveLength(0);
    // The form stays open for an explicit decision.
    expect(screen.getByText('pasichnyk.tar')).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(sendButton());
    await waitFor(() => expect(mockAddPatientCalls).toHaveLength(1));
  });

  it('Discard in the unfinished uploads list never creates a patient', async () => {
    seedUnfinishedUpload(fingerprintOf(archiveFile()));
    await renderDialog();
    await waitFor(() =>
      expect(screen.getByText('Unfinished uploads')).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard', hidden: true })
    );
    await waitFor(() => expect(mockServer.sessions.size).toBe(0));
    await wait(300);
    expect(mockAddPatientCalls).toHaveLength(0);
  });

  it('a legacy session without fingerprint is not matched', async () => {
    seedUnfinishedUpload(undefined);
    await renderDialog();
    fireEvent.click(sendButton());
    await wait(300);
    expect(prompt()).toBeNull();
    // An explicit Send without a match creates one patient.
    expect(mockAddPatientCalls).toHaveLength(1);
  });
});

describe('AddPatient: a patient was already created for the archive', () => {
  const createPatientWithFailedUpload = async () => {
    mockServer.rejectSessionCreation = true;
    await renderDialog();
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(screen.getAllByText('Upload rejected.').length).toBeGreaterThan(0)
    );
    expect(mockAddPatientCalls).toHaveLength(1);
    mockServer.rejectSessionCreation = false;
    // Close the dialog (state is lost like after a reload) and reopen it.
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel', hidden: true })
    );
    // Let the dialog's exit transition finish before reopening it.
    await wait(500);
    await openDialog();
    await selectArchive();
  };

  it('offers to upload to that patient instead of creating another', async () => {
    await createPatientWithFailedUpload();
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(
        screen.getByText(/was already created for this archive/i)
      ).toBeTruthy()
    );
    expect(mockAddPatientCalls).toHaveLength(1);

    fireEvent.click(
      screen.getByRole('button', { name: 'Upload', hidden: true })
    );
    await waitFor(() =>
      expect([...mockServer.sessions.values()][0]?.status).toBe('completed')
    );
    const [session] = [...mockServer.sessions.values()];
    expect(session.patientId).toBe([...mockPatients.keys()][0]);
    expect(mockAddPatientCalls).toHaveLength(1);
  });

  it('Discard forgets the suggestion without creating a patient', async () => {
    await createPatientWithFailedUpload();
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(
        screen.getByText(/was already created for this archive/i)
      ).toBeTruthy()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Discard', hidden: true })
    );
    await wait(300);
    expect(mockAddPatientCalls).toHaveLength(1);
    // The next explicit Send creates a new patient.
    fireEvent.click(sendButton());
    await waitFor(() => expect(mockAddPatientCalls).toHaveLength(2));
  });

  it('ignores the suggestion when that patient no longer exists', async () => {
    await createPatientWithFailedUpload();
    mockPatients.clear(); // the created patient was deleted meanwhile
    fireEvent.click(sendButton());
    await waitFor(() => expect(mockAddPatientCalls).toHaveLength(2));
    expect(
      screen.queryByText(/was already created for this archive/i)
    ).toBeNull();
  });
});
