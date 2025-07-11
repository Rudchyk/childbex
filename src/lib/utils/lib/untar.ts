'use server';

import tar from 'tar-fs';
import fs from 'fs';

export async function untar(src: string, dest: string) {
  fs.createReadStream(src).pipe(tar.extract(dest));
}
