import { syncDb } from '@/db';
import { UserModel } from '@/db/models/User.model';
import { Stack, Typography } from '@mui/material';
import { Users } from './_components/Users';

const Page = async () => {
  await syncDb();
  const users = await UserModel.findAll();
  const publicUsers = users.map((user) => user.getPublic());

  return (
    <Stack spacing={1}>
      <Typography variant="h1">Users</Typography>
      <Users data={publicUsers} />
    </Stack>
  );
};

export default Page;
