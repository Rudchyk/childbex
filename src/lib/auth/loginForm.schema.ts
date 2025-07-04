import * as Yup from 'yup';

export const loginFormSchema = Yup.object().shape({
  email: Yup.string().email().required(),
  password: Yup.string().required(),
});

export type LoginFormData = Yup.InferType<typeof loginFormSchema>;
