import * as Yup from 'yup';

export const editEmailProfileFormSchema = Yup.object().shape({
  email: Yup.string().email().required(),
});
export type EditEmailProfileFormData = Yup.InferType<
  typeof editEmailProfileFormSchema
>;
export const editNameProfileFormSchema = Yup.object().shape({
  name: Yup.string().required(),
});
export type EditNameProfileFormData = Yup.InferType<
  typeof editNameProfileFormSchema
>;
