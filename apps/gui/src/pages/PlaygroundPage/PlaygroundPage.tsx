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
import { useBase } from '../../store/slices';
import { SerializedError } from '@reduxjs/toolkit';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useEffect, useState } from 'react';

export const Component = () => {
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
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
