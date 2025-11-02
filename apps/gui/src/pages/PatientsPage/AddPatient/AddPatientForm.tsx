import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC, useEffect } from 'react';
import { FormUITextField, FormUIFileInput } from '../../../components';
import { Box } from '@mui/material';
import {
  AddPatientFormDataSchema,
  AddPatientFormData,
  accept,
} from './addPatientForm.schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { toSlugIfCyr } from '@libs/helpers';

interface AddPatientFormProps {
  onSubmit: SubmitHandler<AddPatientFormData>;
  onError?: SubmitErrorHandler<AddPatientFormData>;
  loading?: boolean;
}

export const AddPatientForm: FC<AddPatientFormProps> = ({
  onSubmit,
  onError,
  loading,
}) => {
  const methods = useForm({
    resolver: zodResolver(AddPatientFormDataSchema),
    defaultValues: {
      name: '',
      slug: '',
      notes: '',
      archive: undefined,
    },
  });
  const { handleSubmit, control, watch, setValue } = methods;
  const { archive, name } = watch();

  useEffect(() => {
    if (!name && archive) {
      const [name] = archive.name.split('.');
      setValue('name', name);
      setValue('slug', toSlugIfCyr(name));
    }
  }, [archive]);

  useEffect(() => {
    setValue('slug', toSlugIfCyr(name));
  }, [name]);

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <FormUITextField
        name="name"
        control={control}
        label="Name"
        margin="normal"
        fullWidth
        disabled={loading}
      />
      <FormUITextField
        name="slug"
        control={control}
        label="Slug"
        margin="normal"
        fullWidth
        disabled={loading}
      />
      <FormUITextField
        name="notes"
        control={control}
        multiline
        label="Notes"
        margin="normal"
        fullWidth
        disabled={loading}
        rows={3}
      />
      <FormUIFileInput
        name="archive"
        accept={accept}
        slotsProps={{
          formControlProps: {
            sx: {
              mt: 1,
            },
          },
        }}
        control={control}
        disabled={loading}
      />
    </Box>
  );
};
