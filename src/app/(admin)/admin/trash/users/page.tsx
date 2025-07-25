import { syncDb } from '@/db';
import { TrashedUsers } from './_components/TrashedUsers';
import { User } from '@/db/models/User.model';
import { Stack, Typography } from '@mui/material';
import { Op } from 'sequelize';

const Page: React.FC = async () => {
  await syncDb();
  const result = await User.findAll({
    paranoid: false,
    where: { deletedAt: { [Op.ne]: null } },
  });
  const data = result.map((item) => item.getPublic());
  return (
    <Stack spacing={1}>
      <Typography variant="h1">Trashed users</Typography>
      <TrashedUsers data={data} />
    </Stack>
  );
};

export default Page;
