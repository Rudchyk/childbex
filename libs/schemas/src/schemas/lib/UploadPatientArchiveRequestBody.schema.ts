import { FromSchema } from 'fets';
import { ARCHIVE_MAX_UPLOAD_BYTES } from '@libs/constants';

export const UploadPatientArchiveRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['archive'],
  properties: {
    archive: {
      type: 'string',
      format: 'binary',
      maxLength: ARCHIVE_MAX_UPLOAD_BYTES, // 500 MiB
    },
  },
} as const;

export type UploadPatientArchiveRequestBody = FromSchema<
  typeof UploadPatientArchiveRequestBodySchema
>;
