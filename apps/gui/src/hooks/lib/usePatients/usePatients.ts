import { useMemo } from 'react';
import {
  useAddPatientMutation,
  useUploadPatientAssetsMutation,
} from '../../../store/apis';

export function usePatients() {
  const [
    addPatient,
    {
      data: addedPatient,
      isError: isAddPatientError,
      isLoading: isAddPatientLoading,
      error: addPatientError,
      isSuccess: isAddPatientSuccess,
    },
  ] = useAddPatientMutation();
  const [
    uploadPatientAssets,
    {
      isLoading: isUploadPatientAssetsLoading,
      error: uploadPatientAssetsError,
      isSuccess: isUploadPatientAssetsSuccess,
      isError: isUploadPatientAssetsError,
    },
  ] = useUploadPatientAssetsMutation();
  console.log(
    '🚀 ~ usePatients ~ isUploadPatientAssetsLoading:',
    isUploadPatientAssetsLoading
  );
  const isLoading = useMemo(
    () => isAddPatientLoading || isUploadPatientAssetsLoading,
    [isAddPatientLoading, isUploadPatientAssetsLoading]
  );

  return {
    addedPatient,
    isAddPatientError,
    addPatient,
    uploadPatientAssets,
    isLoading,
    addPatientError,
    isAddPatientSuccess,
    uploadPatientAssetsError,
    isUploadPatientAssetsSuccess,
    isUploadPatientAssetsError,
    isUploadPatientAssetsLoading,
    isAddPatientLoading,
  };
}
