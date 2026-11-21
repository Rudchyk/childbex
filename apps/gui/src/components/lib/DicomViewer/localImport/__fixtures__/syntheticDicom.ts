/**
 * Synthetic DICOM and ZIP bytes for tests. No real patient data: every
 * value is invented, and the pixel data is a tiny gradient.
 */
import { deflateSync } from 'fflate';
import { crc32 } from '../localImport.zip';

const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const LONG_VRS = new Set(['OB', 'OW', 'SQ', 'UN', 'UT', 'OF']);

const pad = (vr: string, value: Uint8Array | string) => {
  if (typeof value !== 'string') return value;
  const even = value.length % 2 ? value + (vr === 'UI' ? '\0' : ' ') : value;
  return ascii(even);
};

const explicitElement = (group: number, element: number, vr: string, raw: Uint8Array | string) => {
  const value = pad(vr, raw);
  const long = LONG_VRS.has(vr);
  const head = new DataView(new ArrayBuffer(long ? 12 : 8));
  head.setUint16(0, group, true);
  head.setUint16(2, element, true);
  head.setUint8(4, vr.charCodeAt(0));
  head.setUint8(5, vr.charCodeAt(1));
  if (long) head.setUint32(8, value.length, true);
  else head.setUint16(6, value.length, true);
  return concat([new Uint8Array(head.buffer), value]);
};

const implicitElement = (group: number, element: number, vr: string, raw: Uint8Array | string) => {
  const value = pad(vr, raw);
  const head = new DataView(new ArrayBuffer(8));
  head.setUint16(0, group, true);
  head.setUint16(2, element, true);
  head.setUint32(4, value.length, true);
  return concat([new Uint8Array(head.buffer), value]);
};

const uint16 = (value: number) => {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
};
const uint32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
};

export const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
export const BASIC_TEXT_SR = '1.2.840.10008.5.1.4.1.1.88.11';
export const MEDIA_STORAGE_DIRECTORY = '1.2.840.10008.1.3.10';

export interface SyntheticDicomOptions {
  studyUid?: string;
  seriesUid?: string;
  sopUid?: string;
  sopClassUid?: string;
  modality?: string;
  seriesNumber?: number;
  seriesDescription?: string;
  instanceNumber?: number;
  rows?: number;
  columns?: number;
  /** Part 10 preamble, `DICM` and file meta group (default true). */
  part10?: boolean;
  /** Pixel Data element (default true). */
  pixels?: boolean;
  /** A private element of this many bytes before Pixel Data. */
  privatePaddingBytes?: number;
  /** Image Type (default `ORIGINAL\PRIMARY\AXIAL`). */
  imageType?: string;
  /** Image Orientation (Patient) (default axial `1\0\0\0\1\0`). */
  orientation?: string;
  /** Image Position (Patient) (default `0\0\<instance number>`). */
  position?: string;
  photometricInterpretation?: string;
  bitsStored?: number;
  /** Number of Frames (multi-frame image when above 1). */
  numberOfFrames?: number;
  /** Invented name (dwv compares it between slices). */
  patientName?: string;
  /** Transfer Syntax UID of the file meta (the data set stays explicit LE). */
  transferSyntaxUid?: string;
}

/** A tiny synthetic CT slice (explicit VR little endian). */
export const syntheticDicom = (options: SyntheticDicomOptions = {}): Uint8Array => {
  const {
    studyUid = '2.25.1001',
    seriesUid = '2.25.1001.1',
    sopUid = '2.25.1001.1.1',
    sopClassUid = CT_IMAGE_STORAGE,
    modality = 'CT',
    seriesNumber = 1,
    seriesDescription = 'Synthetic series',
    instanceNumber = 1,
    rows = 4,
    columns = 4,
    part10 = true,
    pixels = true,
    privatePaddingBytes = 0,
    imageType = 'ORIGINAL\\PRIMARY\\AXIAL',
    orientation = '1\\0\\0\\0\\1\\0',
    position = `0\\0\\${instanceNumber}`,
    photometricInterpretation = 'MONOCHROME2',
    bitsStored = 12,
    numberOfFrames = 1,
    patientName = 'SYNTHETIC^PATIENT',
    transferSyntaxUid = '1.2.840.10008.1.2.1',
  } = options;
  const element = part10 ? explicitElement : implicitElement;
  const dataSet: Uint8Array[] = [
    element(0x0008, 0x0008, 'CS', imageType),
    element(0x0008, 0x0016, 'UI', sopClassUid),
    element(0x0008, 0x0018, 'UI', sopUid),
    element(0x0008, 0x0020, 'DA', '20200101'),
    element(0x0008, 0x0060, 'CS', modality),
    element(0x0008, 0x103e, 'LO', seriesDescription),
    element(0x0010, 0x0010, 'PN', patientName),
    element(0x0020, 0x000d, 'UI', studyUid),
    element(0x0020, 0x000e, 'UI', seriesUid),
    element(0x0020, 0x0011, 'IS', String(seriesNumber)),
    element(0x0020, 0x0013, 'IS', String(instanceNumber)),
    element(0x0020, 0x0032, 'DS', position),
    element(0x0020, 0x0037, 'DS', orientation),
  ];
  if (sopClassUid !== BASIC_TEXT_SR && sopClassUid !== MEDIA_STORAGE_DIRECTORY) {
    dataSet.push(
      element(0x0028, 0x0002, 'US', uint16(1)),
      element(0x0028, 0x0004, 'CS', photometricInterpretation),
      ...(numberOfFrames > 1 ? [element(0x0028, 0x0008, 'IS', String(numberOfFrames))] : []),
      element(0x0028, 0x0010, 'US', uint16(rows)),
      element(0x0028, 0x0011, 'US', uint16(columns)),
      element(0x0028, 0x0100, 'US', uint16(16)),
      element(0x0028, 0x0101, 'US', uint16(bitsStored)),
      element(0x0028, 0x0102, 'US', uint16(bitsStored - 1)),
      element(0x0028, 0x0103, 'US', uint16(0))
    );
  }
  if (privatePaddingBytes) {
    dataSet.push(element(0x0029, 0x1010, 'OB', new Uint8Array(privatePaddingBytes)));
  }
  if (pixels) {
    const pixelBytes = new Uint8Array(rows * columns * 2 * numberOfFrames);
    for (let i = 0; i < pixelBytes.length; i++) pixelBytes[i] = (i * 7 + instanceNumber) & 0xff;
    dataSet.push(element(0x7fe0, 0x0010, 'OW', pixelBytes));
  }
  if (!part10) return concat(dataSet);

  const meta = concat([
    explicitElement(0x0002, 0x0001, 'OB', new Uint8Array([0, 1])),
    explicitElement(0x0002, 0x0002, 'UI', sopClassUid),
    explicitElement(0x0002, 0x0003, 'UI', sopUid),
    explicitElement(0x0002, 0x0010, 'UI', transferSyntaxUid),
  ]);
  return concat([
    new Uint8Array(128),
    ascii('DICM'),
    explicitElement(0x0002, 0x0000, 'UL', uint32(meta.length)),
    meta,
    ...dataSet,
  ]);
};

export interface ZipFixtureEntry {
  name: string;
  data?: Uint8Array;
  /** 0 stored, 8 deflate (default), others written as stored. */
  method?: number;
  /** Unix mode (e.g. `0o120777` for a symbolic link). */
  unixMode?: number;
  /** General purpose flags (e.g. `1` encrypted). */
  flags?: number;
  /** Lies about the uncompressed size (central directory). */
  declaredSize?: number;
  /** Overrides the CRC-32 (central directory). */
  crc?: number;
  /** Points the central directory at another entry's local header. */
  localHeaderOfEntry?: number;
  /**
   * ZIP64 for this entry: the listed central directory fields are written
   * as 0xFFFFFFFF and their real values go into a ZIP64 extra field.
   */
  zip64?: {
    fields: Array<'uncompressed' | 'compressed' | 'offset'>;
    /** Writes only this many bytes of the extra field values (damaged). */
    extraBytes?: number;
    /** Saturates the fields without writing the extra field (damaged). */
    omitExtra?: boolean;
    /** Writes other values into the extra field (hostile). */
    override?: Partial<Record<'uncompressed' | 'compressed' | 'offset', number>>;
  };
}

/** ZIP64 end of central directory (record + locator, saturated EOCD). */
export interface Zip64EndOptions {
  omitLocator?: boolean;
  /** Overrides the record offset written in the locator. */
  recordOffset?: number;
  /** Overrides the central directory size / offset in the record. */
  directorySize?: number;
  directoryOffset?: number;
  /** Total number of disks in the locator (split archives: above 1). */
  totalDisks?: number;
}

const uint64 = (value: number) => {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, value % 2 ** 32, true);
  view.setUint32(4, Math.floor(value / 2 ** 32), true);
  return bytes;
};

const SATURATED = 0xffffffff;

/** Writes a ZIP archive (with knobs for damaged and hostile archives). */
export const buildZip = (
  entries: ZipFixtureEntry[],
  options: { zip64End?: true | Zip64EndOptions } = {}
): Uint8Array => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  const offsets: number[] = [];
  let offset = 0;
  entries.forEach((entry) => {
    const data = entry.data ?? new Uint8Array(0);
    const method = entry.method ?? 8;
    const body = method === 8 ? deflateSync(data) : data;
    const name = ascii(unescape(encodeURIComponent(entry.name))); // UTF-8
    const crc = entry.crc ?? crc32(0, data);
    const flags = (entry.flags ?? 0) | 0x800;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    offsets.push(offset);
    const localBytes = concat([new Uint8Array(local.buffer), name, body]);
    locals.push(localBytes);

    const values = {
      uncompressed: entry.declaredSize ?? data.length,
      compressed: body.length,
      offset,
      ...entry.zip64?.override,
    };
    const zip64Fields = entry.zip64?.fields ?? [];
    let extra = new Uint8Array(0);
    if (zip64Fields.length && !entry.zip64?.omitExtra) {
      const ordered = (['uncompressed', 'compressed', 'offset'] as const).filter((f) =>
        zip64Fields.includes(f)
      );
      const fieldBytes = concat(ordered.map((f) => uint64(values[f]))).slice(
        0,
        entry.zip64?.extraBytes
      );
      extra = concat([uint16(0x0001), uint16(fieldBytes.length), fieldBytes]);
    }
    const field = (name: keyof typeof values) =>
      zip64Fields.includes(name) ? SATURATED : values[name];

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, entry.unixMode !== undefined ? (3 << 8) | 20 : 20, true);
    central.setUint16(6, 45, true);
    central.setUint16(8, flags, true);
    central.setUint16(10, method, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, field('compressed'), true);
    central.setUint32(24, field('uncompressed'), true);
    central.setUint16(28, name.length, true);
    central.setUint16(30, extra.length, true);
    central.setUint32(38, entry.unixMode !== undefined ? (entry.unixMode << 16) >>> 0 : 0, true);
    central.setUint32(42, field('offset'), true);
    centrals.push(concat([new Uint8Array(central.buffer), name, extra]));
    offset += localBytes.length;
  });
  entries.forEach((entry, index) => {
    if (entry.localHeaderOfEntry !== undefined) {
      new DataView(centrals[index].buffer).setUint32(42, offsets[entry.localHeaderOfEntry], true);
    }
  });
  const directory = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  if (!options.zip64End) {
    return concat([...locals, directory, new Uint8Array(end.buffer)]);
  }

  const zip64 = options.zip64End === true ? {} : options.zip64End;
  const recordOffset = offset + directory.length;
  const record = concat([
    uint32(0x06064b50),
    uint64(44),
    uint16(45),
    uint16(45),
    uint32(0),
    uint32(0),
    uint64(entries.length),
    uint64(entries.length),
    uint64(zip64.directorySize ?? directory.length),
    uint64(zip64.directoryOffset ?? offset),
  ]);
  const locator = concat([
    uint32(0x07064b50),
    uint32(0),
    uint64(zip64.recordOffset ?? recordOffset),
    uint32(zip64.totalDisks ?? 1),
  ]);
  end.setUint16(8, 0xffff, true);
  end.setUint16(10, 0xffff, true);
  end.setUint32(12, SATURATED, true);
  end.setUint32(16, SATURATED, true);
  return concat([
    ...locals,
    directory,
    record,
    ...(zip64.omitLocator ? [] : [locator]),
    new Uint8Array(end.buffer),
  ]);
};

export const fileOf = (bytes: Uint8Array, name: string) =>
  new File([bytes as BlobPart], name);

/** File with the folder hierarchy of `<input webkitdirectory>`. */
export const folderFileOf = (bytes: Uint8Array, relativePath: string) => {
  const file = fileOf(bytes, relativePath.split('/').pop() ?? relativePath);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};
