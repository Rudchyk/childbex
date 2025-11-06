import { z } from 'zod';
import { archiveSchema, ARCHIVE_KEY } from '../../../schemas';

export * from '../../../schemas/lib/archive.schema';

export const addPatientFormDataSchema = z.object({
  name: z.string().min(1, 'Required'),
  slug: z.string().optional(),
  notes: z.string().optional(),
  [ARCHIVE_KEY]: archiveSchema.optional(),
});

export type AddPatientFormData = z.infer<typeof addPatientFormDataSchema>;
