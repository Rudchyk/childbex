import { DefaultLayout } from '../../layouts';
import { useGetPatientsQuery } from '../../store/apis';
import { PageTmpl } from '../../templates';
import { Patients } from './Patients';

export const Component = () => {
  const { data, isLoading, isError, error } = useGetPatientsQuery();
  return (
    <DefaultLayout>
      <PageTmpl>
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
