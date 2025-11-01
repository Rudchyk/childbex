import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC, useEffect } from 'react';
import { FormUITextField, FormUIFileInput } from '../../../components';
// import {
//   addPatientFormDataSchema,
//   AddPatientFormData,
//   accept,
// } from './addPatientForm.schema';
import { Box } from '@mui/material';
import {
  CreatePatientRequestBody,
  CreatePatientRequestBodySchema,
  Type,
  TypeCompiler,
  typeboxResolver,
} from '@libs/schemas';

interface AddPatientFormProps {
  onSubmit: SubmitHandler<CreatePatientRequestBody>;
  onError?: SubmitErrorHandler<CreatePatientRequestBody>;
  loading?: boolean;
}

const typecheck = TypeCompiler.Compile(CreatePatientRequestBodySchema);

const schema = Type.Object({
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});

export const AddPatientForm: FC<AddPatientFormProps> = ({
  onSubmit,
  onError,
  loading,
}) => {
  const methods = useForm({
    resolver: typeboxResolver(schema),
    // defaultValues: {
    //   name: '',
    //   slug: '',
    //   notes: '',
    //   // archive: undefined,
    // },
  });
  const { handleSubmit, control, watch, setValue, trigger, clearErrors } =
    methods;
  const { archive } = watch();

  // useEffect(() => {
  //   if (archive) {
  //     console.log('archive', archive);

  //     trigger('archive').then((valid) => {
  //       if (valid) {
  //         const [name] = archive.name.split('.');
  //         setValue('name', name);
  //         setValue('slug', toSlugIfCyr(name));
  //       }
  //     });
  //   } else {
  //     setValue('name', '');
  //     setValue('slug', '');
  //     clearErrors('archive');
  //   }
  // }, [archive]);

  return (
    <div>ddddddddd</div>
    // <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
    //   {/* <FormUIFileInput
    //     name="archive"
    //     accept={accept}
    //     control={control}
    //     label="Archive"
    //     disabled={loading}
    //   /> */}
    //   <FormUITextField
    //     name="name"
    //     control={control}
    //     label="Name"
    //     margin="normal"
    //     fullWidth
    //     disabled={loading}
    //   />
    //   <FormUITextField
    //     name="slug"
    //     control={control}
    //     label="Slug"
    //     margin="normal"
    //     fullWidth
    //     disabled={loading}
    //   />
    //   <FormUITextField
    //     name="notes"
    //     control={control}
    //     multiline
    //     label="Notes"
    //     margin="normal"
    //     fullWidth
    //     disabled={loading}
    //     rows={3}
    //   />
    // </Box>
  );
};
