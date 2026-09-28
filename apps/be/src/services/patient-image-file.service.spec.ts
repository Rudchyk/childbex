import path from 'node:path';
import { Readable } from 'node:stream';
import {
  resolveUploadFilePath,
  toWebStream,
} from './patient-image-file.service';

jest.mock('./logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

describe('resolveUploadFilePath', () => {
  const root = path.resolve('/srv/childbex/uploads');

  it('maps a stored source to a file inside the upload root', () => {
    expect(resolveUploadFilePath('/uploads/p/c/1.dcm', root)).toBe(
      path.join(root, 'p', 'c', '1.dcm')
    );
  });

  it('keeps names that only start with dots inside the root', () => {
    expect(resolveUploadFilePath('/uploads/p/..image.dcm', root)).toBe(
      path.join(root, 'p', '..image.dcm')
    );
  });

  it.each([
    ['traversal', '/uploads/../secret'],
    ['nested traversal', '/uploads/p/../../secret'],
    ['backslash traversal', '/uploads/..\\..\\secret'],
    ['the root itself', '/uploads/'],
    ['the root via dot', '/uploads/.'],
    ['another prefix', '/assets/p/1.dcm'],
    ['an absolute path', path.resolve('/etc/passwd')],
    ['a NUL byte', '/uploads/p/1.dcm\0.png'],
    ['an empty source', ''],
  ])('rejects %s', (_, source) => {
    const resolved = resolveUploadFilePath(source, root);
    if (path.sep === '/' && source.includes('\\')) {
      // On POSIX a backslash is an ordinary file name character.
      expect(resolved?.startsWith(root + path.sep)).toBe(true);
    } else {
      expect(resolved).toBeNull();
    }
  });
});

describe('toWebStream', () => {
  it('passes all chunks through', async () => {
    const stream = toWebStream(
      Readable.from([Buffer.from('ab'), Buffer.from('cd')])
    );

    const received = Buffer.from(await new Response(stream).arrayBuffer());

    expect(received.toString()).toBe('abcd');
  });

  it('reads lazily and destroys the source when cancelled', async () => {
    let produced = 0;
    const source = new Readable({
      highWaterMark: 1,
      read() {
        produced += 1;
        this.push(Buffer.from([produced]));
      },
    });
    const reader = toWebStream(source).getReader();

    await reader.read();
    await reader.cancel();

    expect(source.destroyed).toBe(true);
    // An endless source: only what the consumer asked for (plus the small
    // stream buffers) was read.
    expect(produced).toBeLessThan(10);
  });

  it('reports source errors to the consumer', async () => {
    const source = new Readable({
      read() {
        this.destroy(new Error('read failed'));
      },
    });

    await expect(toWebStream(source).getReader().read()).rejects.toThrow(
      'read failed'
    );
  });
});
