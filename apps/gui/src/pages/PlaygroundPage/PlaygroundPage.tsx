import {
  Stack,
  Typography,
  LinearProgress,
  Alert,
  TextField,
  Link,
} from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { useGetHelloQuery } from '../../store/apis';
import { useBase } from '../../store/slices';
import { SerializedError } from '@reduxjs/toolkit';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { Nav } from '../../components';

export const Component = () => {
  const { data, isLoading, isError, error } = useGetHelloQuery({
    name: 'Sergii',
  });
  const { msg, setMsg } = useBase();
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack spacing={2}>
          <Typography variant="h5">Hello from home</Typography>
          <Nav />
          <TextField
            variant="outlined"
            type="text"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
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
      </PageTmpl>
    </DefaultLayout>
  );
};
