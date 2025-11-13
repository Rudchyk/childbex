import { DefaultLayout } from '../../layouts';
import { useGetPatientImagesClusterQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { PatientImagesClusters } from './PatientImagesCluster';
import { useParams } from 'react-router-dom';
import { GetPatientClusterParams } from '@libs/schemas';
import { Typography, useMediaQuery, useTheme } from '@mui/material';

export const Component = () => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const { slug = '', cluster = '' } = useParams<GetPatientClusterParams>();
  const { data, isLoading, isError, error } = useGetPatientImagesClusterQuery(
    { slug, cluster },
    { skip: !slug || !cluster }
  );

  return (
    <DefaultLayout>
      <PageTmpl
        customTitle={
          <Typography component="h1" variant={matches ? 'h3' : 'h1'}>
            {data?.name}
          </Typography>
        }
      >
        <PatientImagesClusters
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
