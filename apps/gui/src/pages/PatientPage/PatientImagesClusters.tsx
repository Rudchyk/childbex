import { List, Stack } from '@mui/material';
import { GetPatientResponse } from '@libs/schemas';
import { WithLoader } from '../../hoc';
import { PatientImagesCluster } from './PatientImagesCluster';

interface PatientImagesClustersProps {
  slug: string;
}

export const PatientImagesClusters = WithLoader<
  GetPatientResponse,
  PatientImagesClustersProps
>(({ data, slug }) => {
  const { clusters = [] } = data;
  return (
    <Stack>
      <List>
        {clusters.map((item) => (
          <PatientImagesCluster key={item.id} slug={slug} item={item} />
        ))}
      </List>
    </Stack>
  );
});
