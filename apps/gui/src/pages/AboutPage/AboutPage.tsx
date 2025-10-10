import { Stack, Typography } from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { useBase } from '../../store/slices';
import { PageTmpl } from '../../templates';
import { Nav } from '../../components';

export const Component = () => {
  const { msg } = useBase();
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack>
          <Typography>Hello for About</Typography>
          <Nav />
          {!!msg && <Typography variant="h6">{msg}</Typography>}
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
