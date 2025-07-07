import * as Yup from 'yup';

export const changePasswordProfileFormSchema = Yup.object().shape({
  oldPassword: Yup.string().min(8).required(),
  password: Yup.string().min(8).required(),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('password')])
    .required(),
});

export type ChangePasswordProfileFormData = Yup.InferType<
  typeof changePasswordProfileFormSchema
>;
