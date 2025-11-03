import { DefaultLayout } from '../../layouts';
import {
  useGetPatientsQuery,
  useGetTrashedPatientsQuery,
} from '../../store/apis';
import { PageTmpl } from '../../templates';
import { Patients } from './Patients';
import { AddPatient } from './AddPatient/AddPatient';
import { useAuth } from '../../auth/useAuth';
import { useEffect, useMemo } from 'react';
import { useNotifications } from '../../modules/notifications';

export const Component = () => {
  const { isAdmin } = useAuth();
  const { notifyError } = useNotifications();
  const {
    data: patients = [],
    isLoading: isPatientsLoading,
    isError: isPatientsError,
    error: patientsError,
  } = useGetPatientsQuery();
  const {
    data: trashedPatients = [],
    isLoading: isTrashedPatientsLoading,
    isError: isTrashedPatientsError,
    error: trashedPatientsError,
  } = useGetTrashedPatientsQuery(undefined, { skip: !isAdmin });
  const data = useMemo(
    () => [...patients, ...trashedPatients],
    [patients, trashedPatients]
  );
  useEffect(() => {
    if (isTrashedPatientsError) {
      notifyError(trashedPatientsError);
    }
  }, [isTrashedPatientsError]);
  return (
    <DefaultLayout>
      <PageTmpl pageTitleProps={{ titleActions: <AddPatient /> }}>
        <Patients
          data={data}
          isLoading={isPatientsLoading || isTrashedPatientsLoading}
          isError={isPatientsError}
          error={patientsError}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
