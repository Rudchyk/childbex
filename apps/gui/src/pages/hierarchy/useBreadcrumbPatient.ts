import { useGetPatientQuery } from '../../store/apis';
import { isFetchBaseQueryError } from '../../utils';

/** Patient ids are UUIDs: another id is never requested. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The patient of a Study/Series URL for its breadcrumbs (name and slug),
 * through the cached patient query the Study and Series pages share. Only
 * the URL's patient, never the previous one while another is loaded.
 * `missing`: the patient is confirmed not to exist (404, e.g. deleted, or
 * an id that cannot exist), so its page must not be linked; loading and
 * other failures (network, server) are not `missing`.
 */
export const useBreadcrumbPatient = (patientId: string) => {
  const valid = UUID.test(patientId);
  const { currentData, error } = useGetPatientQuery(
    { id: patientId },
    { skip: !valid }
  );
  return {
    patient: currentData?.id === patientId ? currentData : undefined,
    missing: !valid || (isFetchBaseQueryError(error) && error.status === 404),
  };
};
