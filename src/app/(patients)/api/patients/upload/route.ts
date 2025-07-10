import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { toSlugIfCyr } from '@/lib/utils';

const TMP_ROOT = path.join(os.tmpdir(), 'uploads');

export async function POST(request: Request) {
  try {
    // const formData = await request.formData();
    // const file = formData.get('file') as File | null;
    // if (!file) {
    //   return NextResponse.json(
    //     { error: 'Поле «file» відсутнє' },
    //     { status: 400 }
    //   );
    // }
    // if (file.size > 500 * 1024 * 1024) {
    //   return NextResponse.json({ error: 'Максимум 500 MB' }, { status: 400 });
    // }
    // const buf = Buffer.from(await file.arrayBuffer());
    // const stamp = Date.now().toString();
    // const fullFileName = file.name;
    // const { name } = path.parse(fullFileName);
    // const tmpArcFileName = `${stamp}_${fullFileName}`;
    // const arcPath = path.join(TMP_ROOT, `${stamp}_${fullFileName}`);
    // const dest = path.join(TMP_ROOT, stamp);
    // fs.mkdirSync(dest, { recursive: true });
    // await fs.promises.writeFile(arcPath, buf);
    // const slug = toSlugIfCyr(name);
    // return NextResponse.json({
    //   ok: true,
    //   arcPath: arcPath,
    //   slug,
    //   name,
    //   arcFileName: tmpArcFileName,
    // });
    return NextResponse.json('ok');
  } catch (error) {
    const err = error as Error;
    return NextResponse.json({ ok: false, message: err?.message || err?.name });
  }
}
