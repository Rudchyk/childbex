'use server';

import { IMAGE_RX } from '@/lib/constants/constants';
import path from 'path';
import sanitize from 'sanitize-filename';
import * as tar from 'tar';

export async function untar(src: string, dest: string) {
  await tar.x({
    file: src,
    cwd: dest,
    filter: (p) => IMAGE_RX.test(p),
    onentry: (e) => {
      e.path = sanitize(path.basename(e.path));
    },
  });
}
