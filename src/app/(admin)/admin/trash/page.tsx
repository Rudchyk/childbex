import { syncDb } from '@/db';
import { TrashedUsers } from './_components/TrashedUsers';
import { UserModel } from '@/db/models/User.model';
import { Stack, Typography } from '@mui/material';
import { Op } from 'sequelize';

const Page: React.FC = async () => {
  await syncDb();
  const users = await UserModel.findAll({
    paranoid: false,
    where: { deletedAt: { [Op.ne]: null } },
  });
  const publicUsers = users.map((user) => user.getPublic());
  return (
    <Stack spacing={1}>
      <Typography variant="h1">Trash</Typography>
      <TrashedUsers data={publicUsers} />
    </Stack>
  );
};

export default Page;
