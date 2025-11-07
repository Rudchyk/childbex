import {
  selectPatientsState,
  setIsLoading,
  PatientsState,
} from './patientsSlice';
import { useAppSelector, useAppDispatch } from '../../../useAppStore';

export function usePatients() {
  const state = useAppSelector(selectPatientsState);
  const dispatch = useAppDispatch();

  return {
    ...state,
    setIsLoading: (value: PatientsState['isLoading']) =>
      dispatch(setIsLoading(value)),
  };
}
