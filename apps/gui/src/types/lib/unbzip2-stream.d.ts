/**
 * The pure JavaScript bzip2 block decoder inside `unbzip2-stream` (no
 * Node streams or Buffer), used by the local DICOM import for `.tar.bz2`.
 */
declare module 'unbzip2-stream/lib/bit_iterator.js' {
  /** Reads `n` bits (big-endian); `null` aligns to the next byte. */
  export interface BitReader {
    (n: number | null): number;
    /** Bytes of input started so far. */
    bytesRead: number;
  }
  /** `nextBuffer` is called (synchronously) whenever more input is needed. */
  function bitIterator(nextBuffer: () => Uint8Array): BitReader;
  export = bitIterator;
}

declare module 'unbzip2-stream/lib/bzip2.js' {
  import type { BitReader } from 'unbzip2-stream/lib/bit_iterator.js';

  interface Bzip2 {
    /** Reads the `BZh` stream header; returns the block size (1–9). */
    header(bits: BitReader): number;
    /**
     * Decodes one block, passing each output byte to `write`, and verifies
     * its CRC. Returns the running stream CRC, or `null` at the end of the
     * stream (after checking the stream CRC). Throws on damaged data.
     */
    decompress(
      bits: BitReader,
      write: (byte: number) => void,
      buffer: Int32Array,
      bufferSize: number,
      streamCrc: number
    ): number | null;
  }
  const bzip2: Bzip2;
  export = bzip2;
}
