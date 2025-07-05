'use client';

import React, { FC, FormEventHandler } from 'react';
import { SubmitHandler, SubmitErrorHandler, useForm } from 'react-hook-form';
import { Box, IconButton, InputAdornment } from '@mui/material';
import { FormUITextField } from '@/lib/components';
import {
  editNameProfileFormSchema,
  EditNameProfileFormData,
} from './profileForms.schemas';
import { yupResolver } from '@hookform/resolvers/yup';
import SaveIcon from '@mui/icons-material/Save';

export interface EditNameProfileFormProps {
  onSubmit: SubmitHandler<EditNameProfileFormData>;
  loading?: boolean;
  onError?: SubmitErrorHandler<EditNameProfileFormData>;
  onChange?: FormEventHandler<EditNameProfileFormData>;
  value: string;
}

export const EditNameProfileForm: FC<EditNameProfileFormProps> = ({
  onSubmit,
  onError,
  onChange,
  loading,
  value,
}) => {
  const { handleSubmit, control, watch } = useForm<EditNameProfileFormData>({
    resolver: yupResolver(editNameProfileFormSchema),
    defaultValues: {
      name: value,
    },
  });
  const { name } = watch();
  return (
    <Box
      component="form"
      onChange={onChange}
      onSubmit={handleSubmit(onSubmit, onError)}
    >
      <FormUITextField
        name="name"
        control={control}
        label="Name"
        margin="normal"
        fullWidth
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                {name !== value && (
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
