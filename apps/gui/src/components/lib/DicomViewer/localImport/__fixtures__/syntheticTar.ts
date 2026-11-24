/**
 * Synthetic TAR bytes for tests (no real patient data), with knobs for
 * damaged and hostile archives. Deterministic: same entries, same bytes.
 */

const BLOCK = 512;

const utf8 = (text: string) =>
  Uint8Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0));

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const padToBlock = (data: Uint8Array) =>
  concat([data, new Uint8Array((BLOCK - (data.length % BLOCK)) % BLOCK)]);

const octal = (value: number, length: number) =>
  utf8(value.toString(8).padStart(length - 1, '0') + '\0');

export interface TarFixtureEntry {
  name: string;
  data?: Uint8Array;
  /** Type flag (default `0`, a regular file; `5` directory, `2` symlink…). */
  type?: string;
  linkName?: string;
  /** Header layout (default POSIX `ustar`). */
  format?: 'ustar' | 'gnu' | 'v7';
  /** POSIX ustar name prefix (the name is `prefix/name`). */
  prefix?: string;
  /** PAX records written in an `x` header before this entry. */
  pax?: Record<string, string>;
  /** A GNU `L` long name record before this entry. */
  gnuLongName?: string;
  /** Overrides the size field (the data written is unchanged). */
  declaredSize?: number;
  /** Writes a wrong checksum. */
  badChecksum?: boolean;
}

const header = (entry: Partial<TarFixtureEntry>, type: string, name: string, size: number) => {
  const block = new Uint8Array(BLOCK);
  block.set(utf8(name).subarray(0, 100), 0);
  block.set(octal(0o644, 8), 100);
  block.set(octal(0, 8), 108);
  block.set(octal(0, 8), 116);
  block.set(octal(size, 12), 124);
  block.set(octal(0, 12), 136);
  block[156] = type.charCodeAt(0);
  if (entry.linkName) block.set(utf8(entry.linkName).subarray(0, 100), 157);
  const format = entry.format ?? 'ustar';
  if (format === 'ustar') {
    block.set(utf8('ustar\u000000'), 257);
    if (entry.prefix) block.set(utf8(entry.prefix).subarray(0, 155), 345);
  } else if (format === 'gnu') {
    block.set(utf8('ustar  \u0000'), 257);
  }
  if (format !== 'v7') {
    block.set(utf8('synthetic'), 265);
    block.set(utf8('synthetic'), 297);
  }
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.set(utf8(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  if (entry.badChecksum) block.set(utf8('000001\0 '), 148);
  return block;
};

/** `"<length> <key>=<value>\n"`, the length counting the whole record. */
export const paxRecord = (key: string, value: string) => {
  const body = ` ${key}=${value}\n`;
  const bodyLength = utf8(body).length;
  let length = bodyLength + 1;
  while (String(length).length + bodyLength !== length) length++;
  return `${length}${body}`;
};

/** One entry with its PAX / GNU records, as TAR blocks. */
export const tarEntryBlocks = (entry: TarFixtureEntry) => {
  const data = entry.data ?? new Uint8Array(0);
  const type = entry.type ?? '0';
  const parts: Uint8Array[] = [];
  if (entry.pax) {
    const records = utf8(
      Object.entries(entry.pax)
        .map(([key, value]) => paxRecord(key, value))
        .join('')
    );
    parts.push(header({}, 'x', 'PaxHeader', records.length), padToBlock(records));
  }
  if (entry.gnuLongName !== undefined) {
    const longName = utf8(`${entry.gnuLongName}\0`);
    parts.push(
      header({ format: 'gnu' }, 'L', '././@LongLink', longName.length),
      padToBlock(longName)
    );
  }
  parts.push(header(entry, type, entry.name, entry.declaredSize ?? data.length), padToBlock(data));
  return concat(parts);
};

/** Writes a TAR archive (two zero blocks end it unless `endBlocks` says). */
export const buildTar = (
  entries: TarFixtureEntry[],
  options: { endBlocks?: number; trailing?: Uint8Array } = {}
): Uint8Array =>
  concat([
    ...entries.map(tarEntryBlocks),
    new Uint8Array(BLOCK * (options.endBlocks ?? 2)),
    options.trailing ?? new Uint8Array(0),
  ]);

export const fromBase64 = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
