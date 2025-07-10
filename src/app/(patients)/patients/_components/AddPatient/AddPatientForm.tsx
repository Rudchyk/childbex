'use client';

import { yupResolver } from '@hookform/resolvers/yup';
import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC } from 'react';
import { FormUITextField } from '@/lib/components';
import {
  addPatientFormDataSchema,
  AddPatientFormData,
} from './addPatientForm.schema';
import { Box } from '@mui/material';

interface AddPatientFormProps {
  onSubmit: SubmitHandler<AddPatientFormData>;
  onError?: SubmitErrorHandler<AddPatientFormData>;
}

export const AddPatientForm: FC<AddPatientFormProps> = ({
  onSubmit,
  onError,
}) => {
  const methods = useForm({
    resolver: yupResolver<AddPatientFormData, unknown, unknown>(
      addPatientFormDataSchema
    ),
    defaultValues: {
      name: '',
      slug: null,
      notes: null,
    },
  });
  const { handleSubmit, control } = methods;

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <FormUITextField
        name="name"
        control={control}
        label="Name"
        margin="normal"
        fullWidth
      />
      <FormUITextField
        name="slug"
        control={control}
        label="Slug"
        margin="normal"
        fullWidth
      />
      <FormUITextField
        name="notes"
        control={control}
        multiline
        label="Notes"
        margin="normal"
        fullWidth
        rows={3}
      />
    </Box>
  );
};
