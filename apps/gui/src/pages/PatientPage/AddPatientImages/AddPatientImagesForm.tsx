import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC } from 'react';
import { FormUIFileInput } from '../../../components';
import { Box } from '@mui/material';
import {
  AddPatientImagesFormDataSchema,
  AddPatientImagesFormData,
  accept,
} from './addPatientImagesForm.schema';
import { zodResolver } from '@hookform/resolvers/zod';

interface AddPatientImagesFormProps {
  onSubmit: SubmitHandler<AddPatientImagesFormData>;
  onError?: SubmitErrorHandler<AddPatientImagesFormData>;
  loading?: boolean;
}

export const AddPatientImagesForm: FC<
  AddPatientImagesFormProps
> = ({ onSubmit, onError, loading }) => {
  const methods = useForm({
    resolver: zodResolver(AddPatientImagesFormDataSchema),
    defaultValues: {
      archive: undefined,
    },
  });
  const { handleSubmit, control } = methods;

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
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
