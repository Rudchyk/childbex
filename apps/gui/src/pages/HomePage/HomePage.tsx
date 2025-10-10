import { Stack, Typography } from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { Nav } from '../../components';
import { useBase } from '../../store/slices';

export const Component = () => {
  const { msg } = useBase();
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack>
          <Typography variant="h5">Hello from home</Typography>
          <Nav />
          {!!msg && <Typography variant="h6">{msg}</Typography>}
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
