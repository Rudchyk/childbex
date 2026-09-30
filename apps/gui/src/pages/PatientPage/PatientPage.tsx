import { DefaultLayout } from '../../layouts';
import { useGetPatientBySlugQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { PatientStudies } from './PatientStudies';
import { useParams } from 'react-router-dom';
import { SlugProperty } from '@libs/schemas';
import { PageTitle } from '../../components';
import { AddPatientImages } from './AddPatientImages/AddPatientImages';
import { WithLoader } from '../../hoc';

// The page lists the patient's DICOM Studies.
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
            titleActions={data?.id && <AddPatientImages id={data.id} />}
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
