import { z } from 'zod';
import { archiveSchema, ARCHIVE_KEY } from '../../../schemas';

export * from '../../../schemas/lib/archive.schema';

export const AddPatientImagesFormDataSchema = z.object({
  [ARCHIVE_KEY]: archiveSchema,
});

export type AddPatientImagesFormData = z.infer<
  typeof AddPatientImagesFormDataSchema
>;
