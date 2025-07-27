// import { syncDb } from '@/db';
// import { TrashedPatients } from './_components/TrashedPatients';
import { Stack, Typography } from '@mui/material';
// import { Op } from 'sequelize';
// import { findExtendedPatients } from '@/lib/services/patients.service';

const Page: React.FC = async () => {
  // await syncDb();
  // const result = await findExtendedPatients({
  //   paranoid: false,
  //   where: { deletedAt: { [Op.ne]: null } },
  // });
  return (
    <Stack spacing={1}>
      <Typography variant="h1">Trashed patients</Typography>
      {/* <TrashedPatients data={result} /> */}
    </Stack>
  );
};

export default Page;
