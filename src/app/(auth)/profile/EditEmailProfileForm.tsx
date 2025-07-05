'use client';

import React, { FC } from 'react';
import { SubmitHandler, SubmitErrorHandler, useForm } from 'react-hook-form';
import { Box, IconButton, InputAdornment } from '@mui/material';
import { FormUITextField } from '@/lib/components';
import {
  editEmailProfileFormSchema,
  EditEmailProfileFormData,
} from './profileForms.schemas';
import { yupResolver } from '@hookform/resolvers/yup';
import SaveIcon from '@mui/icons-material/Save';

export interface EditEmailProfileFormProps {
  onSubmit: SubmitHandler<EditEmailProfileFormData>;
  loading?: boolean;
  onError?: SubmitErrorHandler<EditEmailProfileFormData>;
  value: string;
}

export const EditEmailProfileForm: FC<EditEmailProfileFormProps> = ({
  onSubmit,
  onError,
  loading,
  value,
}) => {
  const { handleSubmit, control, watch } = useForm<EditEmailProfileFormData>({
    resolver: yupResolver(editEmailProfileFormSchema),
    defaultValues: {
      email: value,
    },
  });
  const { email } = watch();
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <FormUITextField
        name="email"
        control={control}
        label="Email"
        margin="normal"
        fullWidth
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                {email !== value && (
                  <IconButton loading={loading} type="submit">
                    <SaveIcon />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  );
};
