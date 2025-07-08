'use client';

import { FieldValues } from 'react-hook-form';
import {
  FormUITextField,
  FormUITextFieldProps,
} from '../FormUITextField/FormUITextField';
import { MenuItem } from '@mui/material';

export type FormUISelectOptions =
  | string[]
  | {
      value: string;
      label?: string;
    }[];

export type FormUISelectProps<T extends FieldValues> =
  FormUITextFieldProps<T> & {
    options: FormUISelectOptions;
  };

export const FormUISelect = <T extends FieldValues>({
  options,
  ...props
}: FormUISelectProps<T>) => {
  return (
    <FormUITextField select {...props}>
      {options.map((option) => {
        if (typeof option === 'string') {
          return (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          );
        }
        return (
          <MenuItem key={option.value} value={option.value}>
            {option.label}
          </MenuItem>
        );
      })}
    </FormUITextField>
  );
};
