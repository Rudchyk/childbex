import styled from '@emotion/styled';
import {
  Button,
  FormHelperText,
  FormHelperTextProps,
  Stack,
  Typography,
  TypographyProps,
  FormControl,
  FormLabel,
  IconButton,
  Card,
  CardHeader,
  FormControlProps,
} from '@mui/material';
import { ChangeEventHandler } from 'react';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import DeleteIcon from '@mui/icons-material/Delete';

export interface UIFileInputProps<T extends FieldValues> {
  onChange?: ChangeEventHandler<HTMLInputElement>;
  name: Path<T>;
  control: Control<T>;
  label?: string;
  helperText?: FormHelperTextProps['children'];
  buttonText?: string;
  accept?: string;
  slotsProps?: {
    formControlProps?: FormControlProps;
    labelProps?: Omit<TypographyProps, 'children'>;
    formHelperTextProps?: FormHelperTextProps;
  };
}

const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0,
  whiteSpace: 'nowrap',
  width: 1,
});

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B';
  }

  const sizes = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log10(bytes) / 3);
  const size = (bytes / Math.pow(1000, i)).toFixed(2);

  return `${size} ${sizes[i]}`;
};

export const FormUIFileInput = <T extends FieldValues>({
  name,
  control,
  label,
  helperText,
  buttonText = 'Upload file',
  slotsProps = {},
}: UIFileInputProps<T>) => {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field: { value, onChange }, fieldState: { error } }) => (
        <FormControl
          {...slotsProps?.formControlProps}
          error={!!error}
          sx={{ width: '100%' }}
        >
          {!!label && <FormLabel>{label}</FormLabel>}
          {value ? (
            <Card variant="outlined">
              <CardHeader
                avatar={<InsertDriveFileIcon />}
                title={value.name}
                subheader={
                  <Stack>
                    <Typography
                      variant="caption"
                      color={error ? 'error' : 'text.secondary'}
                    >
                      {formatFileSize(value.size)}
                      {' · '}
                      {error ? 'Failed' : 'Completed'}
                    </Typography>
                  </Stack>
                }
                action={
                  <IconButton onClick={() => onChange(undefined)}>
                    <DeleteIcon />
                  </IconButton>
                }
              />
            </Card>
          ) : (
            <Button
              component="label"
              role={undefined}
              variant="contained"
              tabIndex={-1}
              startIcon={<CloudUploadIcon />}
            >
              {buttonText}
              <VisuallyHiddenInput
                type="file"
                onChange={(event) => {
                  if (event.target.files?.[0]) {
                    onChange(event.target.files[0]);
                  }
                }}
              />
            </Button>
          )}

          <FormHelperText {...slotsProps?.formHelperTextProps}>
            {error?.message || helperText}
          </FormHelperText>
        </FormControl>
      )}
    />
  );
};
