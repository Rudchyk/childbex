import { createReadStream } from 'node:fs';
import { Readable, pipeline } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import { createGunzip } from 'node:zlib';
import * as tarStream from 'tar-stream';
import unbzip2 from 'unbzip2-stream';
import { XzReadableStream } from 'xz-decompress';
import StreamZip from 'node-stream-zip';
import { ArchiveError } from './archive.errors';
import type { ArchiveFormat } from './archive.detect';
import type { ExtractionSink } from './archive.entries';

const noop = () => undefined;

type TarFormat = Exclude<ArchiveFormat, 'zip'>;

/** Opens the archive as a stream of raw tar bytes. */
const openTarInput = (archivePath: string, format: TarFormat): Readable => {
  const source = createReadStream(archivePath);
  switch (format) {
    case 'tar':
      return source;
    case 'tar.gz':
      return pipeline(source, createGunzip(), noop);
    case 'tar.bz2': {
      const bz = unbzip2();
      source.on('error', (err) => bz.emit('error', err));
      return new Readable().wrap(source.pipe(bz));
    }
    case 'tar.xz': {
      const web = Readable.toWeb(
        source
      ) as unknown as ReadableStream<Uint8Array>;
      return Readable.fromWeb(
        new XzReadableStream(web) as unknown as NodeWebReadableStream
      );
    }
  }
};

// tar-stream's bundled typings rely on streamx, which ships no types;
// describe the members used here.
interface TarEntry extends AsyncIterable<Buffer> {
  header: tarStream.Header;
  resume(): void;
}
interface TarExtract extends AsyncIterable<TarEntry> {
  destroy(error?: unknown): void;
}

export const extractTar = async (
  archivePath: string,
  format: TarFormat,
  sink: ExtractionSink,
  signal: AbortSignal
): Promise<void> => {
  const input = openTarInput(archivePath, format);
  // Old v7 tars have no `ustar` magic; header checksums are still verified.
  const extractStream = tarStream.extract({
    allowUnknownFormat: true,
  } as Parameters<typeof tarStream.extract>[0]);
  const extract = extractStream as unknown as TarExtract;
  const abort = () => extract.destroy(signal.reason);
  input.on('error', (err) => extract.destroy(err));
  signal.addEventListener('abort', abort, { once: true });
  input.pipe(extractStream as unknown as NodeJS.WritableStream);

  try {
    for await (const entry of extract) {
      const { header } = entry;
      let written: string | null = null;
      switch (header.type) {
        case 'file':
        case 'contiguous-file':
          written = await sink.addFile(
            header.name,
            header.size,
            async () => entry
          );
          break;
        case 'directory':
          sink.addDirectory(header.name);
          break;
        case 'symlink':
        case 'link':
          sink.addLink(
            header.name,
            header.linkname ?? '',
            header.type === 'symlink' ? 'symlink' : 'hardlink'
          );
          break;
        default:
          sink.rejectEntryType(header.name, header.type ?? 'unknown');
      }
      if (!written) entry.resume();
    }
  } finally {
    signal.removeEventListener('abort', abort);
    input.destroy();
  }
};

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const ZIP_HOST_UNIX = 3;

export const extractZip = async (
  archivePath: string,
  sink: ExtractionSink,
  signal: AbortSignal
): Promise<void> => {
  // Name validation is done by the sink so every format reports it the same way.
  const zip = new StreamZip.async({
    file: archivePath,
    skipEntryNameValidation: true,
  });
  try {
    const entries = Object.values(await zip.entries());
    sink.checkDeclaredTotals(
      entries.length,
      entries.reduce((sum, e) => sum + (e.isDirectory ? 0 : e.size), 0)
    );
    for (const entry of entries) {
      signal.throwIfAborted();
      if (entry.encrypted) {
        throw new ArchiveError(
          'UNSUPPORTED_FORMAT',
          'Encrypted (password-protected) archives are not supported.'
        );
      }
      const { attr = 0, verMade = 0 } = entry as unknown as {
        attr?: number;
        verMade?: number;
      };
      const unixMode =
        verMade >> 8 === ZIP_HOST_UNIX ? (attr >>> 16) & S_IFMT : 0;

      if (entry.isDirectory || unixMode === S_IFDIR) {
        sink.addDirectory(entry.name);
      } else if (unixMode === S_IFLNK) {
        const target =
          entry.size <= 4096
            ? (await zip.entryData(entry)).toString('utf8')
            : '';
        sink.addLink(entry.name, target, 'symlink');
      } else if (unixMode === 0 || unixMode === S_IFREG) {
        await sink.addFile(
          entry.name,
          entry.size,
          async () => (await zip.stream(entry)) as Readable
        );
      } else {
        sink.rejectEntryType(entry.name, `mode ${unixMode.toString(8)}`);
      }
    }
  } finally {
    await zip.close().catch(noop);
  }
};
