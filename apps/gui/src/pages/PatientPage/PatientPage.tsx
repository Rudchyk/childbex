import { DefaultLayout } from '../../layouts';
import { useGetPatientBySlugQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { PatientStudies } from './PatientStudies';
import { useParams } from 'react-router-dom';
import { SlugProperty } from '@libs/schemas';
import { PageTitle } from '../../components';
import { AddPatientImagesCluster } from './AddPatientImagesCluster/AddPatientImagesCluster';
import { WithLoader } from '../../hoc';

// The patient's (legacy) clusters in this response are not used: the page
// lists DICOM Studies.
const PatientContent = WithLoader<{ id: string }>(({ data }) => (
  <PatientStudies patientId={data.id} />
));

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
        <PatientContent
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
