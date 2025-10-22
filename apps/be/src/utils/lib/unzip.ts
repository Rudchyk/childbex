import StreamZip from 'node-stream-zip';
import { promises as fs } from 'fs';
import path from 'path';
import sanitize from 'sanitize-filename';
import { IMAGE_RX } from '../../services/patients.service';

export async function unzip(src: string, dest: string) {
  const zip = new StreamZip.async({ file: src });
  for (const e of Object.values(await zip.entries())) {
    if (e.isDirectory || !IMAGE_RX.test(e.name)) continue;
    await fs.writeFile(
      path.join(dest, sanitize(path.basename(e.name))),
      await zip.entryData(e)
    );
  }
  await zip.close();
}
