import { roleValues } from '@/lib/constants/roleValues';
import { UserRoles } from '@/types';
import * as Yup from 'yup';
import { InferType } from 'yup';

export const addUserFormDataSchema = Yup.object().shape({
  name: Yup.string().required(),
  email: Yup.string().email().required(),
  password: Yup.string().min(8).required(),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('password')])
    .required(),
  role: Yup.mixed<UserRoles>()
    .oneOf(roleValues, `role must be one of: ${roleValues.join(', ')}`)
    .required(),
});

export type AddUserFormData = InferType<typeof addUserFormDataSchema>;
