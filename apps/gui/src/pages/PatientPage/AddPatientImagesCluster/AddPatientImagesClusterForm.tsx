import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC } from 'react';
import { FormUIFileInput } from '../../../components';
import { Box } from '@mui/material';
import {
  AddPatientImagesClusterFormDataSchema,
  AddPatientImagesClusterFormData,
  accept,
} from './addPatientImagesClusterForm.schema';
import { zodResolver } from '@hookform/resolvers/zod';

interface AddPatientImagesClusterFormProps {
  onSubmit: SubmitHandler<AddPatientImagesClusterFormData>;
  onError?: SubmitErrorHandler<AddPatientImagesClusterFormData>;
  loading?: boolean;
}

export const AddPatientImagesClusterForm: FC<
  AddPatientImagesClusterFormProps
> = ({ onSubmit, onError, loading }) => {
  const methods = useForm({
    resolver: zodResolver(AddPatientImagesClusterFormDataSchema),
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
