import { lstat, unlink, rm } from 'node:fs/promises';

export async function removePath(p: string) {
  const st = await lstat(p);
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
