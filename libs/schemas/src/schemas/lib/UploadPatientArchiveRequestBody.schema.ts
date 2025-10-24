import { FromSchema } from 'fets';

export const UploadPatientArchiveRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['archive'],
  properties: {
    archive: {
      type: 'string',
      format: 'binary',
      maxLength: 1024 * 1024 * 500, // 5MB
    },
  },
} as const;

export type UploadPatientArchiveRequestBody = FromSchema<
  typeof UploadPatientArchiveRequestBodySchema
>;
