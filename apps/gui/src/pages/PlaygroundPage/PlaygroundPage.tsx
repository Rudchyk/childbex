import {
  Stack,
  Typography,
  LinearProgress,
  Alert,
  TextField,
  Box,
  FormGroup,
  Button,
} from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { useGetHelloMutation } from '../../store/apis';
import { useBase } from '../../store/slices';
import { SerializedError } from '@reduxjs/toolkit';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useEffect, useState } from 'react';

export const Component = () => {
  const [getHello, { data, isLoading, isError, error }] = useGetHelloMutation();
  const { msg, setMsg } = useBase();
  const [name, setName] = useState('');

  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack spacing={2}>
          <Stack component="section" spacing={2}>
            <Typography variant="h5">Store</Typography>
            <Typography variant="body1">Stored msg: {msg}</Typography>
            <TextField
              variant="outlined"
              type="text"
              value={msg}
              label="Msg"
              onChange={(e) => setMsg(e.target.value)}
            />
          </Stack>
          <Stack component="section" spacing={2}>
            <Typography variant="h5">API</Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                variant="outlined"
                type="text"
                value={name}
                label="Name"
                onChange={(e) => setName(e.target.value)}
              />
              <Button variant="contained" onClick={() => getHello({ name })}>
                Send
              </Button>
            </Stack>
            {isLoading ? (
              <LinearProgress />
            ) : isError ? (
              <Alert variant="filled" severity="error">
                {(error as FetchBaseQueryError)?.data
                  ? JSON.stringify((error as FetchBaseQueryError).data)
                  : (error as SerializedError)?.message ||
                    'Internal Server Error'}
              </Alert>
            ) : (
              <Typography variant="body1">{data}</Typography>
            )}
          </Stack>
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
