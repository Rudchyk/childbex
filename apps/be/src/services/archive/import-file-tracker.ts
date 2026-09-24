import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { copyFile, link, mkdir, rm, rmdir } from 'node:fs/promises';
import { logger } from '../logger.service';

const NO_CLOBBER_FALLBACK_CODES = new Set([
  'EXDEV',
  'EPERM',
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
]);

/**
 * Tracks files and directories created by one import so they can be removed
 * if the import fails. Never overwrites existing files.
 */
export class ImportFileTracker {
  private readonly files: string[] = [];
  private readonly dirs: string[] = [];

  async ensureDir(dir: string) {
    const firstCreated = await mkdir(dir, { recursive: true });
    if (!firstCreated) return;
    for (let current = dir; ; current = path.dirname(current)) {
      this.dirs.push(current);
      if (current === firstCreated || current === path.dirname(current)) break;
    }
  }

  /** Places `source` into `folder` without overwriting; returns the final name. */
  async placeFile(source: string, folder: string, name: string) {
    const { name: stem, ext } = path.parse(name);
    for (let n = 0; n < 1000; n++) {
      const candidate = n ? `${stem}_${n}${ext}` : name;
      const target = path.join(folder, candidate);
      try {
        await this.placeNoClobber(source, target);
        this.files.push(target);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Could not find a free file name in the cluster folder');
  }

  private async placeNoClobber(source: string, target: string) {
    try {
      // Hard link is atomic and fails with EEXIST instead of overwriting.
      await link(source, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!NO_CLOBBER_FALLBACK_CODES.has(code)) throw error;
      await copyFile(source, target, fsConstants.COPYFILE_EXCL);
    }
  }

  async rollback() {
    for (const file of this.files) {
      await rm(file, { force: true }).catch((error) =>
        logger.error(error, 'import rollback: remove file')
      );
    }
    // Deepest first; rmdir only removes empty directories, so directories
    // that another upload started using in the meantime are left intact.
    const dirs = [...new Set(this.dirs)].sort((a, b) => b.length - a.length);
    for (const dir of dirs) {
      await rmdir(dir).catch(() => undefined);
    }
  }
}
