import tar from 'tar-fs';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough } from 'stream';
import zlib from 'zlib';

/**
 * Розпаковує .tar / .tar.gz / .tgz архів у destDir.
 * @param archivePath  шлях до вхідного архіву
 * @param destDir      директорія, куди складати файли
 * @param flatten      якщо true — прибирає всі папки усередині архіву
 */
export async function unpackArchive(
  archivePath: string,
  destDir: string,
  { flatten = true } = {}
) {
  const usedNames = new Set<string>();
  const extract = tar.extract(destDir, {
    /** Пропускаємо ВСЕ, що не є звичайним файлом */
    ignore(_name, header) {
      return header?.type !== 'file'; // true ⇒ skip entry
    },
    /** Перейменовуємо тільки файли (директорії ми не обробляємо) */
    map(header) {
      if (!flatten) return header; // зберігаємо шлях як є

      const base = path.basename(header.name); // тільки ім’я файла
      let candidate = base;
      let n = 1;
      while (usedNames.has(candidate)) {
        // запобігаємо перезапису
        const { name, ext } = path.parse(base);
        candidate = `${name}_${n++}${ext}`;
      }
      usedNames.add(candidate);
      header.name = candidate;
      return header;
    },
  });
  const src = fs.createReadStream(archivePath);
  const isGz = /\.(tgz|\.tar\.gz|\.gz)$/i.test(archivePath);
  await pipeline(src, isGz ? zlib.createGunzip() : new PassThrough(), extract);
}

/**
 * Упаковує всі файли всередині srcDir у gzip-стиснений tar-архів.
 * @param srcDir   каталог, вміст якого пакувати
 * @param outPath  шлях до *.tgz, який буде створено
 */
export async function packArchive(srcDir: string, outPath: string) {
  const pack = tar.pack(srcDir); // створюємо tar-стрім
  await pipeline(
    pack,
    zlib.createGzip(), // додаємо gzip
    fs.createWriteStream(outPath)
  );
}
