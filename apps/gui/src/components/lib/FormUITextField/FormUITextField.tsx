import {
  Controller,
  Control,
  FieldValues,
  Path,
  PathValue,
} from 'react-hook-form';
import { TextField, TextFieldProps } from '@mui/material';

export type FormUITextFieldProps<T extends FieldValues> = TextFieldProps & {
  control: Control<T>;
};

export const FormUITextField = <T extends FieldValues>({
  name,
  control,
  defaultValue,
  ...textFieldProps
}: FormUITextFieldProps<T>) => {
  return (
    <Controller
      name={name as Path<T>}
      control={control}
      defaultValue={defaultValue as PathValue<T, Path<T>>}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...textFieldProps}
          {...field}
          error={!!error}
          helperText={error?.message || textFieldProps.helperText}
        />
      )}
    />
  );
};
