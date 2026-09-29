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
  /** Replace (string) or remove (null) text attributes of the data set. */
  attributes?: Partial<Record<SyntheticTextAttribute, string | null>>;
  /** Replace (number) or remove (null) unsigned short attributes. */
  ushorts?: Partial<Record<SyntheticUShortAttribute, number | null>>;
  /** File meta Transfer Syntax UID (default explicit VR LE); null omits it. */
  transferSyntaxUid?: string | null;
  /**
   * Pixel data as an encapsulated fragment (undefined length, empty basic
   * offset table), as written for compressed transfer syntaxes.
   */
  encapsulatedPixelData?: Buffer;
}

const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

type TagDef = [group: number, element: number, vr: string];

const textAttributes = {
  ImageType: [0x0008, 0x0008, 'CS'],
  SOPClassUID: [0x0008, 0x0016, 'UI'],
  SOPInstanceUID: [0x0008, 0x0018, 'UI'],
  StudyDate: [0x0008, 0x0020, 'DA'],
  StudyTime: [0x0008, 0x0030, 'TM'],
  Modality: [0x0008, 0x0060, 'CS'],
  SeriesDescription: [0x0008, 0x103e, 'LO'],
  ContrastBolusAgent: [0x0018, 0x0010, 'LO'],
  SliceThickness: [0x0018, 0x0050, 'DS'],
  ConvolutionKernel: [0x0018, 0x1210, 'SH'],
  StudyInstanceUID: [0x0020, 0x000d, 'UI'],
  SeriesInstanceUID: [0x0020, 0x000e, 'UI'],
  SeriesNumber: [0x0020, 0x0011, 'IS'],
  InstanceNumber: [0x0020, 0x0013, 'IS'],
  ImagePositionPatient: [0x0020, 0x0032, 'DS'],
  ImageOrientationPatient: [0x0020, 0x0037, 'DS'],
  FrameOfReferenceUID: [0x0020, 0x0052, 'UI'],
  PhotometricInterpretation: [0x0028, 0x0004, 'CS'],
  NumberOfFrames: [0x0028, 0x0008, 'IS'],
  PixelSpacing: [0x0028, 0x0030, 'DS'],
  RescaleIntercept: [0x0028, 0x1052, 'DS'],
  RescaleSlope: [0x0028, 0x1053, 'DS'],
} satisfies Record<string, TagDef>;

const ushortAttributes = {
  SamplesPerPixel: [0x0028, 0x0002, 'US'],
  Rows: [0x0028, 0x0010, 'US'],
  Columns: [0x0028, 0x0011, 'US'],
  BitsAllocated: [0x0028, 0x0100, 'US'],
  BitsStored: [0x0028, 0x0101, 'US'],
  HighBit: [0x0028, 0x0102, 'US'],
  PixelRepresentation: [0x0028, 0x0103, 'US'],
} satisfies Record<string, TagDef>;

export type SyntheticTextAttribute = keyof typeof textAttributes;
export type SyntheticUShortAttribute = keyof typeof ushortAttributes;

/** Synthetic UIDs shared by all slices of the default series. */
export const SYNTHETIC_STUDY_UID = '2.25.200000000000000000000000001';
export const SYNTHETIC_SERIES_UID = '2.25.300000000000000000000000001';
export const SYNTHETIC_FRAME_OF_REFERENCE_UID =
  '2.25.400000000000000000000000001';

const encapsulated = (fragment: Buffer) => {
  const item = (group: number, elem: number, value: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt16LE(group, 0);
    header.writeUInt16LE(elem, 2);
    header.writeUInt32LE(value.length, 4);
    return Buffer.concat([header, value]);
  };
  const header = Buffer.concat([
    us(0x7fe0),
    us(0x0010),
    str('OB'),
    Buffer.alloc(2),
    ul(0xffffffff),
  ]);
  return Buffer.concat([
    header,
    item(0xfffe, 0xe000, Buffer.alloc(0)), // basic offset table (empty)
    item(0xfffe, 0xe000, padValue('OB', fragment)),
    item(0xfffe, 0xe0dd, Buffer.alloc(0)), // sequence delimiter
  ]);
};

export const makeSyntheticDicom = ({
  part10 = true,
  instance = 1,
  seriesDescription = 'SYNTHETIC AXIAL',
  sliceZ = instance,
  rows = 4,
  cols = 4,
  pixelDataBytes,
  attributes = {},
  ushorts = {},
  transferSyntaxUid = EXPLICIT_VR_LE,
  encapsulatedPixelData,
}: SyntheticDicomOptions = {}): Buffer => {
  const explicit = part10;
  const sopInstanceUid = `2.25.1000000000000000000000000${instance}`;

  const texts: Record<SyntheticTextAttribute, string | null> = {
    ImageType: 'ORIGINAL\\PRIMARY\\AXIAL',
    SOPClassUID: CT_IMAGE_STORAGE,
    SOPInstanceUID: sopInstanceUid,
    StudyDate: '20200101',
    StudyTime: '120000',
    Modality: 'CT',
    SeriesDescription: seriesDescription,
    ContrastBolusAgent: null,
    SliceThickness: '1.25',
    ConvolutionKernel: 'STANDARD',
    StudyInstanceUID: SYNTHETIC_STUDY_UID,
    SeriesInstanceUID: SYNTHETIC_SERIES_UID,
    SeriesNumber: '2',
    InstanceNumber: String(instance),
    ImagePositionPatient: `0\\0\\${sliceZ}`,
    ImageOrientationPatient: '1\\0\\0\\0\\1\\0',
    FrameOfReferenceUID: SYNTHETIC_FRAME_OF_REFERENCE_UID,
    PhotometricInterpretation: 'MONOCHROME2',
    NumberOfFrames: null,
    PixelSpacing: '0.5\\0.5',
    RescaleIntercept: '-1024',
    RescaleSlope: '1',
    ...attributes,
  };
  const shorts: Record<SyntheticUShortAttribute, number | null> = {
    SamplesPerPixel: 1,
    Rows: rows,
    Columns: cols,
    BitsAllocated: 16,
    BitsStored: 12,
    HighBit: 11,
    PixelRepresentation: 0,
    ...ushorts,
  };

  const elements: [tag: number, bytes: Buffer][] = [];
  const add = ([group, elem, vr]: TagDef, value: Buffer) =>
    elements.push([
      (group << 16) | elem,
      element(group, elem, vr, value, explicit),
    ]);
  for (const [name, value] of Object.entries(texts)) {
    if (value !== null) {
      add(textAttributes[name as SyntheticTextAttribute], str(value));
    }
  }
  for (const [name, value] of Object.entries(shorts)) {
    if (value !== null) {
      add(ushortAttributes[name as SyntheticUShortAttribute], us(value));
    }
  }
  elements.push([
    0x7fe00010,
    encapsulatedPixelData
      ? encapsulated(encapsulatedPixelData)
      : element(
          0x7fe0,
          0x0010,
          'OW',
          Buffer.alloc(pixelDataBytes ?? rows * cols * 2),
          explicit
        ),
  ]);
  // Data set elements must be in ascending tag order.
  elements.sort(([a], [b]) => a - b);
  const dataset = Buffer.concat(elements.map(([, bytes]) => bytes));
  if (!part10) return dataset;

  const sopClassUid = texts.SOPClassUID ?? CT_IMAGE_STORAGE;
  const metaElements = Buffer.concat([
    element(0x0002, 0x0001, 'OB', Buffer.from([0x00, 0x01]), true),
    element(0x0002, 0x0002, 'UI', str(sopClassUid), true),
    element(0x0002, 0x0003, 'UI', str(texts.SOPInstanceUID ?? sopInstanceUid), true),
    ...(transferSyntaxUid === null
      ? []
      : [element(0x0002, 0x0010, 'UI', str(transferSyntaxUid), true)]),
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
