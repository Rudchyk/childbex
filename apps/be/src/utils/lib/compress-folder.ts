// compress-folder.ts
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createBrotliCompress, constants as zc } from 'node:zlib';
import { spawn } from 'node:child_process';
import tar from 'tar-fs';
import zlib from 'node:zlib';
import { logger } from '../../services/logger.service';

export async function brotliCompressFolder(
  folderPath: string,
  outTarBrPath: string
) {
  try {
    const pack = tar.pack(folderPath);

    // tune Brotli for max compression (you can lower quality to speed up)
    const br = createBrotliCompress({
      params: {
        [zc.BROTLI_PARAM_QUALITY]: 11,
        [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_GENERIC,
        [zc.BROTLI_PARAM_LGWIN]: 22, // sliding window (default 22). Larger → better ratio, more RAM
      },
    });

    await pipeline(pack, br, createWriteStream(outTarBrPath));
  } catch (error) {
    logger.error(error);
  }
}

export async function zstdCompressFolder(
  folderPath: string,
  outTarZstPath: string
) {
  try {
    const pack = tar.pack(folderPath);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    const zstd = zlib.createZstdCompress();

    await pipeline(pack, zstd, createWriteStream(outTarZstPath));
  } catch (error) {
    logger.error(error);
  }
}
