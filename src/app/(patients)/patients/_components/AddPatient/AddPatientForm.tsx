'use client';

import { yupResolver } from '@hookform/resolvers/yup';
import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC, useState } from 'react';
import { FormUITextField } from '@/lib/components';
import {
  addPatientFormDataSchema,
  AddPatientFormData,
} from './addPatientForm.schema';
import { Alert, Box, Stack, Typography } from '@mui/material';
import {
  FileUpload,
  SingleFileUpload,
  useXMLHttpService,
} from 'mui-file-upload';

interface AddPatientFormProps {
  onSubmit: SubmitHandler<AddPatientFormData>;
  onError?: SubmitErrorHandler<AddPatientFormData>;
}

export const AddPatientForm: FC<AddPatientFormProps> = ({
  onSubmit,
  onError,
}) => {
  const [fileName, setFileName] = useState('');
  const methods = useForm({
    resolver: yupResolver<AddPatientFormData, unknown, unknown>(
      addPatientFormDataSchema
    ),
    defaultValues: {
      name: '',
      slug: '',
      notes: '',
      arcPath: '',
    },
  });
  const { handleSubmit, control, setValue, register, watch } = methods;
  const uploadService = useXMLHttpService('/api/patients/upload', 'POST');
  const onSuccessfulUpload = ({
    completed,
    responseBody,
  }: FileUpload<string>) => {
    if (completed && responseBody) {
      const { arcPath, slug, name, arcFileName } = JSON.parse(responseBody) as {
        ok: boolean;
        arcPath: string;
        slug: string;
        name: string;
        arcFileName: string;
      };
      setValue('name', name);
      setValue('slug', slug);
      setValue('arcPath', arcPath);
      setFileName(arcFileName);
    }
    return 'ok';
  };
  const { arcPath } = watch();

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <Stack spacing={1}>
        <Typography>Photo archive</Typography>
        {/* {arcPath && fileName ? (
          <Alert severity="info">{fileName}</Alert>
        ) : ( */}
        <SingleFileUpload
          uploadService={uploadService}
          onSuccessfulUpload={onSuccessfulUpload}
          // error={false}
          // helperText={'hello world'}
          // acceptsOnly=".zip,.tar,.gz,.tgz,.rar,application/zip,application/x-tar,application/gzip,application/vnd.rar,application/x-rar-compressed"
        />
        {/* )} */}
      </Stack>
      <input type="hidden" {...register('arcPath')} />
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
