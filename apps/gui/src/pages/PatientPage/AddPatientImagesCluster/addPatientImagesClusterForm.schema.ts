import { z } from 'zod';
import { archiveSchema, ARCHIVE_KEY } from '../../../schemas';

export * from '../../../schemas/lib/archive.schema';

export const AddPatientImagesClusterFormDataSchema = z.object({
  [ARCHIVE_KEY]: archiveSchema,
});

export type AddPatientImagesClusterFormData = z.infer<
  typeof AddPatientImagesClusterFormDataSchema
>;
