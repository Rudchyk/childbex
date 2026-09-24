declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream';

  /** Creates a streaming bzip2 decompressor (through-stream). */
  function unbzip2Stream(): Duplex;
  export = unbzip2Stream;
}
