import * as Yup from 'yup';
import { InferType } from 'yup';

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
// const ALLOWED_EXT = ['zip', 'tar', 'gz', 'tgz', '7z'];
const ALLOWED_EXT = ['tar', 'gz', 'tgz'];
const ALLOWED_MIME = [
  // 'application/zip',
  'application/x-tar',
  'application/gzip',
  // 'application/x-zip-compressed',
  // 'application/x-compressed',
];

export const accept = [...ALLOWED_EXT, ...ALLOWED_MIME].join(',');

export const addPatientFormDataSchema = Yup.object().shape({
  name: Yup.string().required(),
  slug: Yup.string().optional().notRequired(),
  notes: Yup.string().optional().notRequired(),
  archive: Yup.mixed<File>()
    .optional()
    .notRequired()
    .test('fileType', `Supported only ${ALLOWED_EXT.join(' / ')}`, (f) =>
      f ? ALLOWED_MIME.includes(f.type) || f.type === '' : true
    )
    .test('fileExt', 'Неприпустиме розширення', (f) =>
      f ? ALLOWED_EXT.includes(f.name.split('.').pop()!.toLowerCase()) : true
    )
    .test(
      'fileSize',
      `Файл завеликий (≤${Math.floor(MAX_SIZE / 1024 / 1024)} МБ)`,
      (f) => (f ? f.size <= MAX_SIZE : true)
    ),
});

export type AddPatientFormData = InferType<typeof addPatientFormDataSchema>;
