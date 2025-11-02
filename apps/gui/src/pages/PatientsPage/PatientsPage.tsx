import { DefaultLayout } from '../../layouts';
import { useGetPatientsQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { Patients } from './Patients';
import { AddPatient } from './AddPatient/AddPatient';

export const Component = () => {
  const { data, isLoading, isError, error } = useGetPatientsQuery();
  return (
    <DefaultLayout>
      <PageTmpl pageTitleProps={{ titleActions: <AddPatient /> }}>
        <Patients
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
