import { DefaultLayout } from '../../layouts';
import { useGetPatientBySlugQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { PatientImagesClusters } from './PatientImagesClusters';
import { useParams } from 'react-router-dom';
import { SlugProperty } from '@libs/schemas';
import { PageTitle } from '../../components';
import { AddPatientImagesCluster } from './AddPatientImagesCluster/AddPatientImagesCluster';

export const Component = () => {
  const { slug = '' } = useParams<SlugProperty>();
  const { data, isLoading, isError, error } = useGetPatientBySlugQuery(
    { slug },
    { skip: !slug }
  );
  return (
    <DefaultLayout>
      <PageTmpl
        customTitle={
          <PageTitle
            titleActions={data?.id && <AddPatientImagesCluster id={data.id} />}
          >
            {data?.name}
          </PageTitle>
        }
      >
        <PatientImagesClusters
          slug={slug}
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
