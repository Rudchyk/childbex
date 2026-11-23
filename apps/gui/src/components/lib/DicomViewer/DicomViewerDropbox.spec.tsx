/**
 * The standalone viewer's local import: files, folders, ZIP and TAR-family
 * archives are read in the browser, a single Series opens directly, several
 * are offered one at a time, and cancel/retry/reset work while reading.
 */
import { TextDecoder } from 'util';
import { ReadableStream } from 'stream/web';
import { gzipSync } from 'fflate';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DicomViewerDropbox } from './DicomViewerDropbox';
import { fakeDataTransfer } from './localImport/__fixtures__/fakeEntries';
import {
  buildZip,
  fileOf,
  folderFileOf,
  syntheticDicom,
  type SyntheticDicomOptions,
} from './localImport/__fixtures__/syntheticDicom';
import { buildTar } from './localImport/__fixtures__/syntheticTar';
import { TAR_STUDY_XZ } from './localImport/__fixtures__/tarFixtures';

Object.assign(globalThis, {
  TextDecoder,
  // The browser's web streams (jsdom has none), used by the xz decoder.
  ReadableStream: globalThis.ReadableStream ?? ReadableStream,
});

const slice = (series: string, n: number, extra: SyntheticDicomOptions = {}) =>
  syntheticDicom({
    studyUid: '2.25.7',
    seriesUid: `2.25.7.${series}`,
    sopUid: `2.25.7.${series}.${n}`,
    seriesNumber: Number(series),
    seriesDescription: `Synthetic ${series}`,
    instanceNumber: n,
    ...extra,
  });

const filesInput = () => screen.getByTestId('local-import-files-input');
const folderInput = () => screen.getByTestId('local-import-folder-input');
const choose = (input: HTMLElement, files: File[]) =>
  fireEvent.change(input, { target: { files } });

const loadedNames = (onLoadFiles: jest.Mock, call = 0) =>
  (onLoadFiles.mock.calls[call][0] as File[]).map((f) => f.name);

let fetchSpy: jest.Mock;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy = jest.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  // jsdom has no folder picker; Chrome, Edge, Firefox and Safari have one.
  Object.defineProperty(HTMLInputElement.prototype, 'webkitdirectory', {
    value: false,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete (HTMLInputElement.prototype as { webkitdirectory?: boolean }).webkitdirectory;
});

describe('DicomViewerDropbox', () => {
  it('renders nothing while hidden', () => {
    const { container } = render(<DicomViewerDropbox isShow={false} onLoadFiles={jest.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('offers files, a folder (webkitdirectory) and drag and drop, without uploading', () => {
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    expect(screen.getByText(/Drag and drop files, folders or an archive/)).toBeTruthy();
    expect(
      screen.getByText(/Archives: ZIP, TAR, TAR\.GZ\/TGZ, TAR\.BZ2\/TBZ2, TAR\.XZ\/TXZ/)
    ).toBeTruthy();
    // No `accept` filter: extensionless DICOM files stay selectable.
    expect(filesInput().hasAttribute('accept')).toBe(false);
    expect(screen.getByText('Choose files')).toBeTruthy();
    expect(screen.getByText('Choose folder')).toBeTruthy();
    expect(folderInput().hasAttribute('webkitdirectory')).toBe(true);
    expect(filesInput().hasAttribute('multiple')).toBe(true);
    expect(screen.getByText(/nothing is uploaded or saved/)).toBeTruthy();
  });

  it('explains the alternatives where folders cannot be chosen', () => {
    delete (HTMLInputElement.prototype as { webkitdirectory?: boolean }).webkitdirectory;
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    expect(screen.queryByText('Choose folder')).toBeNull();
    expect(screen.getByText(/cannot choose folders/)).toBeTruthy();
  });

  it('opens a single Series directly (existing multi-file selection)', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(filesInput(), [fileOf(slice('1', 2), 'b.dcm'), fileOf(slice('1', 1), 'a.dcm')]);

    await waitFor(() => expect(onLoadFiles).toHaveBeenCalledTimes(1));
    // In Instance Number order.
    expect(loadedNames(onLoadFiles)).toEqual(['a.dcm', 'b.dcm']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets one of several Series be chosen, never all of them together', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(folderInput(), [
      folderFileOf(slice('1', 1), 'Study/S1/IM1'),
      folderFileOf(slice('2', 1), 'Study/S2/IM1'),
      folderFileOf(slice('2', 2), 'Study/S2/IM2'),
    ]);

    const rows = await screen.findAllByTestId('local-import-series');
    expect(rows).toHaveLength(2);
    expect(onLoadFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/never combined into one stack/)).toBeTruthy();

    fireEvent.click(within(rows[1]).getByRole('button', { name: /Open Series 2/ }));

    expect(onLoadFiles).toHaveBeenCalledTimes(1);
    expect(loadedNames(onLoadFiles)).toEqual(['IM1', 'IM2']);
    expect(within(rows[1]).getByText('Last opened')).toBeTruthy();
  });

  it('imports a dropped folder tree and a dropped ZIP archive', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    fireEvent.drop(screen.getByTestId('dicom-viewer-dropbox'), {
      dataTransfer: fakeDataTransfer([
        { name: 'Study', node: { S1: { IM1: fileOf(slice('1', 1), 'IM1') } } },
        {
          name: 'more.zip',
          node: fileOf(buildZip([{ name: 'a/b/IM2', data: slice('2', 1) }]), 'more.zip'),
        },
      ]),
    });

    expect(await screen.findAllByTestId('local-import-series')).toHaveLength(2);
    expect(screen.getByText(/3 files checked: 2 DICOM images in 2 Series/)).toBeTruthy();
  });

  it('opens the single Series of a dropped .tar.gz directly', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    const tar = buildTar([
      { name: 'Study/', type: '5' },
      { name: 'Study/S1/IM2', data: slice('1', 2) },
      { name: 'Study/S1/IM1', data: slice('1', 1) },
    ]);

    fireEvent.drop(screen.getByTestId('dicom-viewer-dropbox'), {
      dataTransfer: fakeDataTransfer([
        { name: 'study.tar.gz', node: fileOf(gzipSync(tar), 'study.tar.gz') },
      ]),
    });

    await waitFor(() => expect(onLoadFiles).toHaveBeenCalledTimes(1));
    expect(loadedNames(onLoadFiles)).toEqual(['IM1', 'IM2']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a TAR archive whose name does not match its content', async () => {
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    choose(filesInput(), [
      fileOf(buildTar([{ name: 'IM1', data: slice('1', 1) }]), 'study.tar.xz'),
    ]);
    expect(await screen.findByText('Archive 1 (TAR.XZ) could not be opened')).toBeTruthy();
    expect(screen.getByText(/does not match the archive content/)).toBeTruthy();
  });

  it('names failed archives by position and format, never by file or entry name', async () => {
    // Synthetic names shaped like patient identifiers.
    const phi = 'DOE^JANE_MRN-0042';
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    choose(filesInput(), [
      fileOf(buildZip([{ name: `${phi}/IM1`, data: slice('1', 1), crc: 42 }]), `${phi}.zip`),
      fileOf(
        gzipSync(buildTar([{ name: `${phi}/IM1`, type: '2', linkName: `${phi}/IM2` }])),
        `${phi}.tar.gz`
      ),
      fileOf(buildTar([{ name: 'IM1', data: slice('1', 1) }]), `${phi}.tar.xz`),
    ]);

    const alerts = await screen.findAllByTestId('local-import-failed-archive');
    expect(alerts.map((a) => a.querySelector('.MuiAlertTitle-root')?.textContent)).toEqual([
      'Archive 1 (ZIP) could not be opened',
      'Archive 2 (TAR.GZ) could not be opened',
      'Archive 3 (TAR.XZ) could not be opened',
    ]);
    for (const alert of alerts) expect(alert.textContent).not.toMatch(/DOE|JANE|MRN|0042/);
  });

  it('cancels a running .tar.xz import and retries it', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(filesInput(), [fileOf(TAR_STUDY_XZ, 'study.tar.xz')]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Import cancelled.')).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Three Series: offered for choice, none opened directly.
    expect(await screen.findAllByTestId('local-import-series')).toHaveLength(3);
    expect(onLoadFiles).not.toHaveBeenCalled();
  });

  it('shows skipped files instead of a silent success', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(filesInput(), [
      fileOf(slice('1', 1), 'IM1'),
      fileOf(Uint8Array.from('notes', (c) => c.charCodeAt(0)), 'README.txt'),
    ]);

    expect(await screen.findByText('1 file skipped')).toBeTruthy();
    expect(screen.getByText(/Not DICOM: 1/)).toBeTruthy();
    // Something was skipped: the user opens the Series knowingly.
    expect(onLoadFiles).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('local-import-series')).toHaveLength(1);
  });

  it('says so when no displayable DICOM was found', async () => {
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    choose(filesInput(), [fileOf(Uint8Array.from('x', (c) => c.charCodeAt(0)), 'x.txt')]);
    expect(await screen.findByText(/No DICOM images that can be displayed/)).toBeTruthy();
  });

  it('reports an archive that cannot be opened', async () => {
    render(<DicomViewerDropbox isShow onLoadFiles={jest.fn()} />);
    choose(filesInput(), [
      fileOf(buildZip([{ name: 'IM1', data: slice('1', 1), flags: 1 }]), 'locked.zip'),
    ]);
    expect(await screen.findByText('Archive 1 (ZIP) could not be opened')).toBeTruthy();
    expect(screen.getByText(/encrypted/)).toBeTruthy();
  });

  it('never opens a Series directly when files of its folder could not be read', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(folderInput(), [
      folderFileOf(slice('1', 1), 'CT/IM1'),
      folderFileOf(slice('1', 2), 'CT/IM2'),
      folderFileOf(new Uint8Array([...slice('1', 3).slice(0, 140), 0xff, 0xff]), 'CT/IM3'),
    ]);

    const [row] = await screen.findAllByTestId('local-import-series');
    expect(onLoadFiles).not.toHaveBeenCalled();
    expect(screen.getByTestId('local-import-incomplete').textContent).toMatch(
      /1 file or archive that may contain images could not be read \(folder CT\)/
    );
    expect(within(row).getByText('May be missing images')).toBeTruthy();
  });

  it('offers a Series dwv cannot stack in labelled parts, never opening it directly', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);

    choose(folderInput(), [
      folderFileOf(slice('1', 1, { imageType: 'DERIVED\\SECONDARY\\MPR' }), 'CT/mpr'),
      folderFileOf(slice('1', 2), 'CT/IM2'),
      folderFileOf(slice('1', 3), 'CT/IM3'),
    ]);

    const rows = await screen.findAllByTestId('local-import-series');
    expect(rows).toHaveLength(2);
    expect(onLoadFiles).not.toHaveBeenCalled();
    expect(screen.getByText(/3 DICOM images in 1 Series/)).toBeTruthy();
    expect(screen.getByTestId('local-import-parts').textContent).toMatch(/Image Type/);
    expect(within(rows[0]).getByText('Part 1 of 2')).toBeTruthy();
    expect(within(rows[0]).getByText(/Image Type: DERIVED/)).toBeTruthy();

    fireEvent.click(within(rows[1]).getByRole('button', { name: /part 2 of 2/ }));
    expect(loadedNames(onLoadFiles)).toEqual(['IM2', 'IM3']);
  });

  it('does not open a stack directly when only some images may load', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    choose(filesInput(), [
      fileOf(slice('1', 1, { position: '0\\0\\0' }), 'b0'),
      fileOf(slice('1', 2, { position: '0\\0\\0' }), 'b1000'),
    ]);

    const [row] = await screen.findAllByTestId('local-import-series');
    expect(within(row).getByText('May load incompletely')).toBeTruthy();
    expect(onLoadFiles).not.toHaveBeenCalled();
  });

  it('never offers a partial Series from an archive rejected part-way', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    choose(filesInput(), [
      fileOf(
        buildZip([
          { name: 'S/IM1', data: slice('1', 1) },
          { name: 'S/IM2', data: slice('1', 2) },
          { name: 'S/zeros', data: new Uint8Array(2 * 1024 * 1024), declaredSize: 100 },
        ]),
        'study.zip'
      ),
    ]);

    expect(await screen.findByText('Archive 1 (ZIP) could not be opened')).toBeTruthy();
    expect(screen.queryAllByTestId('local-import-series')).toHaveLength(0);
    expect(screen.getByText(/No DICOM images that can be displayed/)).toBeTruthy();
    expect(onLoadFiles).not.toHaveBeenCalled();
  });

  it('still opens a picture as before (dwv image loader), unchanged', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'photo.png', {
      type: 'image/png',
    });

    choose(filesInput(), [photo]);

    await waitFor(() => expect(onLoadFiles).toHaveBeenCalledTimes(1));
    expect(onLoadFiles.mock.calls[0][0]).toEqual([photo]);
    expect((onLoadFiles.mock.calls[0][0] as File[])[0]).toBe(photo);
  });

  it('lists pictures next to DICOM Series and opens them one at a time', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    const photo = new File([new Uint8Array(4)], 'photo.jpg', { type: 'image/jpeg' });

    choose(filesInput(), [photo, fileOf(slice('1', 1), 'IM1')]);

    const media = await screen.findByTestId('local-import-media');
    expect(onLoadFiles).not.toHaveBeenCalled();
    fireEvent.click(within(media).getByRole('button', { name: 'Open photo.jpg' }));
    expect((onLoadFiles.mock.calls[0][0] as File[])[0]).toBe(photo);
    expect(within(media).getByText('Last opened')).toBeTruthy();
  });

  it('explains a limit and allows Retry and Start over', async () => {
    render(
      <DicomViewerDropbox isShow onLoadFiles={jest.fn()} limits={{ maxFiles: 1 }} />
    );
    choose(filesInput(), [fileOf(slice('1', 1), 'a'), fileOf(slice('1', 2), 'b')]);

    expect(await screen.findByText(/More than 1 files were found/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/More than 1 files were found/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByText('Choose files')).toBeTruthy();
  });

  it('cancels a running import and retries it', async () => {
    const onLoadFiles = jest.fn();
    render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    const tree = { S1: { IM1: fileOf(slice('1', 1), 'IM1'), IM2: fileOf(slice('1', 2), 'IM2') } };

    fireEvent.drop(screen.getByTestId('dicom-viewer-dropbox'), {
      dataTransfer: fakeDataTransfer([{ name: 'Study', node: tree }]),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Import cancelled.')).toBeTruthy();
    // The cancelled run never delivers its result.
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(onLoadFiles).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(onLoadFiles).toHaveBeenCalledTimes(1));
    expect(loadedNames(onLoadFiles)).toEqual(['IM1', 'IM2']);
  });

  it('stops reading when the viewer is closed', async () => {
    const onLoadFiles = jest.fn();
    const consoleError = jest.spyOn(console, 'error');
    const { unmount } = render(<DicomViewerDropbox isShow onLoadFiles={onLoadFiles} />);
    fireEvent.drop(screen.getByTestId('dicom-viewer-dropbox'), {
      dataTransfer: fakeDataTransfer([
        { name: 'Study', node: { IM1: fileOf(slice('1', 1), 'IM1') } },
      ]),
    });

    unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(onLoadFiles).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
