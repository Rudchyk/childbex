import { lstat, unlink, rm } from 'node:fs/promises';

/** Removes a file or directory tree. Idempotent: a missing path is not an error. */
export async function removePath(p: string) {
  let st;
  try {
    st = await lstat(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (st.isSymbolicLink() || st.isFile()) {
    await unlink(p);
  } else {
    await rm(p, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}
