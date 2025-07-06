'use client';

import {
  Checkbox,
  CheckboxProps,
  FormControl,
  FormControlLabel,
  FormControlLabelProps,
  FormControlProps,
  FormHelperText,
  FormHelperTextProps,
} from '@mui/material';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';

export interface FormUICheckboxProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label?: FormControlLabelProps['label'];
  helperText?: FormHelperTextProps['children'];
  slotsProps?: {
    formControlProps?: FormControlProps;
    formControlLabelProps?: FormControlLabelProps;
    checkboxProps?: CheckboxProps;
    FormHelperTextProps?: FormHelperTextProps;
  };
}

export const FormUICheckbox = <T extends FieldValues>({
  name,
  control,
  label,
  helperText,
  slotsProps,
}: FormUICheckboxProps<T>) => {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <FormControl {...slotsProps?.formControlProps} error={!!error}>
          <FormControlLabel
            {...slotsProps?.formControlLabelProps}
            control={
              <Checkbox
                {...slotsProps?.checkboxProps}
                checked={value}
                onChange={onChange}
              />
            }
            label={label || slotsProps?.formControlLabelProps?.label}
          />
          <FormHelperText {...slotsProps?.FormHelperTextProps}>
            {error?.message || helperText}
          </FormHelperText>
        </FormControl>
      )}
    />
  );
};
