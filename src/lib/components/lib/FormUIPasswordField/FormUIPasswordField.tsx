'use client';

import {
  Control,
  Controller,
  FieldValues,
  Path,
  PathValue,
} from 'react-hook-form';
import { useState } from 'react';
import {
  IconButton,
  InputAdornment,
  TextField,
  TextFieldProps,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';

export type FormUIPasswordFieldProps<T extends FieldValues> = TextFieldProps & {
  control: Control<T>;
};

export const FormUIPasswordField = <T extends FieldValues>({
  name,
  control,
  defaultValue,
  ...textFieldProps
}: FormUIPasswordFieldProps<T>) => {
  const [isPasswordShown, setIsPasswordShown] = useState(false);

  const handleClickShowPassword = () => {
    setIsPasswordShown(!isPasswordShown);
  };

  return (
    <Controller
      name={name as Path<T>}
      control={control}
      defaultValue={defaultValue as PathValue<T, Path<T>>}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...textFieldProps}
          {...field}
          type={isPasswordShown ? 'text' : 'password'}
          slotProps={{
            input: {
              ...textFieldProps.slotProps?.input,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={`toggle password visibility`}
                    onClick={handleClickShowPassword}
                  >
                    {isPasswordShown ? <Visibility /> : <VisibilityOff />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          error={!!error}
          helperText={error?.message || textFieldProps.helperText}
        />
      )}
    />
  );
};
