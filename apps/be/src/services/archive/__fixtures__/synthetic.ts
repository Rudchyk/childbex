/**
 * Builders for SYNTHETIC test data only. Nothing here is derived from real
 * patient data: UIDs use the 2.25 (UUID-derived) root with fixed digits,
 * pixel data is all zeros, and no patient attributes are written.
 */
import { deflateRawSync } from 'node:zlib';
import * as tarStream from 'tar-stream';

// ---------------------------------------------------------------- DICOM ---

const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);

const padValue = (vr: string, value: Buffer) =>
  value.length % 2 === 0
    ? value
    : Buffer.concat([value, Buffer.from([vr === 'UI' ? 0x00 : 0x20])]);

const str = (s: string) => Buffer.from(s, 'latin1');
const us = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const ul = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

const element = (
  group: number,
  elem: number,
  vr: string,
  raw: Buffer,
  explicit: boolean
) => {
  const value = padValue(vr, raw);
  const tag = Buffer.alloc(4);
  tag.writeUInt16LE(group, 0);
  tag.writeUInt16LE(elem, 2);
  if (!explicit) return Buffer.concat([tag, ul(value.length), value]);
  if (LONG_VRS.has(vr)) {
    return Buffer.concat([
      tag,
      str(vr),
      Buffer.alloc(2),
      ul(value.length),
      value,
    ]);
  }
  return Buffer.concat([tag, str(vr), us(value.length), value]);
};

export interface SyntheticDicomOptions {
  /** Write the 128-byte preamble + "DICM" + file meta group (default true). */
  part10?: boolean;
  instance?: number;
  seriesDescription?: string;
  sliceZ?: number;
  rows?: number;
  cols?: number;
  /** Override pixel data length (e.g. to simulate truncated pixel data). */
  pixelDataBytes?: number;
}

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

export const makeSyntheticDicom = ({
  part10 = true,
  instance = 1,
  seriesDescription = 'SYNTHETIC AXIAL',
  sliceZ = instance,
  rows = 4,
  cols = 4,
  pixelDataBytes,
}: SyntheticDicomOptions = {}): Buffer => {
  const explicit = part10;
  const sopInstanceUid = `2.25.1000000000000000000000000${instance}`;
  const e = (g: number, el: number, vr: string, v: Buffer) =>
    element(g, el, vr, v, explicit);

  const dataset = Buffer.concat([
    e(0x0008, 0x0016, 'UI', str(CT_IMAGE_STORAGE)),
    e(0x0008, 0x0018, 'UI', str(sopInstanceUid)),
    e(0x0008, 0x0020, 'DA', str('20200101')),
    e(0x0008, 0x0030, 'TM', str('120000')),
    e(0x0008, 0x0060, 'CS', str('CT')),
    e(0x0008, 0x103e, 'LO', str(seriesDescription)),
    e(0x0020, 0x0032, 'DS', str(`0\\0\\${sliceZ}`)),
    e(0x0020, 0x0037, 'DS', str('1\\0\\0\\0\\1\\0')),
    e(0x0028, 0x0002, 'US', us(1)),
    e(0x0028, 0x0010, 'US', us(rows)),
    e(0x0028, 0x0011, 'US', us(cols)),
    e(0x0028, 0x0030, 'DS', str('0.5\\0.5')),
    e(0x0028, 0x0100, 'US', us(16)),
    e(0x7fe0, 0x0010, 'OW', Buffer.alloc(pixelDataBytes ?? rows * cols * 2)),
  ]);
  if (!part10) return dataset;

  const metaElements = Buffer.concat([
    element(0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01]), true),
    element(0x0002, 0x0002, 'UI', str(CT_IMAGE_STORAGE), true),
    element(0x0002, 0x0003, 'UI', str(sopInstanceUid), true),
    element(0x0002, 0x0010, 'UI', str(EXPLICIT_VR_LE), true),
  ]);
  return Buffer.concat([
    Buffer.alloc(128),
    str('DICM'),
    element(0x0002, 0x0000, 'UL', ul(metaElements.length), true),
    metaElements,
    dataset,
  ]);
};

// ------------------------------------------------------------------ TAR ---

export type TarFixtureEntry =
  | { name: string; data: Buffer | string }
  | { name: string; type: 'directory' }
  | { name: string; type: 'symlink' | 'link'; linkname: string }
  | { name: string; type: 'character-device' | 'fifo' };

export const buildTar = async (entries: TarFixtureEntry[]): Promise<Buffer> => {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  const collected = (async () => {
    for await (const chunk of pack as unknown as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
  })();
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const done = (err?: Error | null) => (err ? reject(err) : resolve());
      if ('data' in entry) {
        const data = Buffer.from(entry.data);
        pack.entry(
          { name: entry.name, size: data.length, mode: 0o644 },
          data,
          done
        );
      } else if ('linkname' in entry) {
        pack.entry(
          { name: entry.name, type: entry.type, linkname: entry.linkname },
          done
        );
      } else {
        pack.entry({ name: entry.name, type: entry.type, mode: 0o755 }, done);
      }
    });
  }
  pack.finalize();
  await collected;
  return Buffer.concat(chunks);
};

// ------------------------------------------------------------------ ZIP ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

export interface ZipFixtureEntry {
  name: string;
  data?: Buffer | string;
  /** Unix mode stored in external attributes (e.g. 0o120777 for a symlink). */
  unixMode?: number;
  deflate?: boolean;
}

/** Minimal ZIP writer so tests can craft malicious entry names/attributes. */
export const buildZip = (entries: ZipFixtureEntry[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '');
    const payload = entry.deflate ? deflateRawSync(data) : data;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.unixMode ? (3 << 8) | 20 : 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
};
