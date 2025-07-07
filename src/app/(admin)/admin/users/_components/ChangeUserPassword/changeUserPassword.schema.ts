import * as Yup from 'yup';

export const changeUserPasswordFormSchema = Yup.object().shape({
  password: Yup.string().min(8).required(),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('password')])
    .required(),
});

export type ChangeUserPasswordFormData = Yup.InferType<
  typeof changeUserPasswordFormSchema
>;
