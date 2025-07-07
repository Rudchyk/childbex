'use client';

import * as yup from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import {
  FormProvider,
  SubmitErrorHandler,
  SubmitHandler,
  useForm,
} from 'react-hook-form';
import { FC } from 'react';

import { ExchangesSelect, FormTextField } from '@gui/components';
import Grid from '@mui/material/Grid';

const addAccountFormSchema = yup
  .object()
  .shape({
    [PUBK_KEY]: yup.string().trim().required(),
    [ECN_KEY]: yup.string().trim().required(),
    [CLIENT_KEY]: yup.string().trim().required(),
    [GUINAME_KEY]: yup.string().trim().required(),
    [TRESS_WALLET_KEY]: yup.string().trim(),
  })
  .noUnknown();

export type AddAccountFormData = yup.InferType<typeof addAccountFormSchema>;

interface AddAccountFormProps {
  onSubmit: SubmitHandler<AddAccountFormData>;
  onError?: SubmitErrorHandler<AddAccountFormData>;
}

export const AddAccountForm: FC<AddAccountFormProps> = ({
  onSubmit,
  onError,
}) => {
  const methods = useForm({
    resolver: yupResolver(addAccountFormSchema),
    defaultValues: {
      [PUBK_KEY]: '',
      [ECN_KEY]: '',
      [CLIENT_KEY]: '',
      [GUINAME_KEY]: '',
      [TRESS_WALLET_KEY]: '',
    },
  });
  const { handleSubmit, control } = methods;

  return (
    <FormProvider {...methods}>
      <Grid
        component="form"
        container
        spacing={2}
        noValidate
        onSubmit={handleSubmit(onSubmit, onError)}
      >
        <Grid item xs={12}>
          <ExchangesSelect
            fullWidth
            control={control}
            label="Exchange"
            name={ECN_KEY}
          />
        </Grid>
        <Grid item xs={12}>
          <FormTextField
            fullWidth
            control={control}
            label="Client"
            name={CLIENT_KEY}
            isCopy={true}
          />
        </Grid>
        <Grid item xs={12}>
          <FormTextField
            fullWidth
            control={control}
            label="Guiname"
            name={GUINAME_KEY}
            isCopy={true}
          />
        </Grid>
        <Grid item xs={12}>
          <FormTextField
            fullWidth
            control={control}
            label="PUBK"
            name={PUBK_KEY}
            isCopy={true}
          />
        </Grid>
        <Grid item xs={12}>
          <FormTextField
            fullWidth
            control={control}
            label="Tress Wallet"
            name={TRESS_WALLET_KEY}
            isCopy={true}
          />
        </Grid>
      </Grid>
    </FormProvider>
  );
};
