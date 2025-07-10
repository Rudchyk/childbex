import * as Yup from 'yup';
import { InferType } from 'yup';

export const addPatientFormDataSchema = Yup.object().shape({
  name: Yup.string().required(),
  slug: Yup.string().optional().notRequired().nullable(),
  notes: Yup.string().optional().notRequired().nullable(),
  arcPath: Yup.string().optional().notRequired().nullable(),
});

export type AddPatientFormData = InferType<typeof addPatientFormDataSchema>;
