import { syncDb } from '@/db';
import { User } from '@/db/models/User.model';
import { Stack, Typography } from '@mui/material';
import { Users } from './_components/Users';

const Page = async () => {
  await syncDb();
  const result = await User.findAll();
  const data = result.map((item) => item.getPublic());

  return (
    <Stack spacing={1}>
      <Typography variant="h1">Users</Typography>
      <Users data={data} />
    </Stack>
  );
};

export default Page;
