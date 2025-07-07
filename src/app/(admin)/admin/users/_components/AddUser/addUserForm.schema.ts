import { UserRolesEnum } from '@cv/types';
import * as Yup from 'yup';
import { InferType } from 'yup';

export const roleValues = Object.values(UserRolesEnum) as UserRolesEnum[];

export const addUserFormDataSchema = Yup.object().shape({
  name: Yup.string().required(),
  email: Yup.string().email().required(),
  allowExtraEmails: Yup.boolean().required(),
  password: Yup.string().min(8).required(),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('password')])
    .required(),
  role: Yup.mixed<UserRolesEnum>()
    .oneOf(roleValues, `role must be one of: ${roleValues.join(', ')}`)
    .required(),
});

export type RegisterFormData = InferType<typeof addUserFormDataSchema>;
