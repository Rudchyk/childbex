import { selectBaseState } from './baseSlice';
import { useAppSelector } from '../../../useAppStore';

export function useBase() {
  const state = useAppSelector(selectBaseState);
  const isDev = state.nodeEnv === 'development';

  return { ...state, isDev };
}
