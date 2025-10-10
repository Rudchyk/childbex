import { selectBaseState, setMsg, BaseState } from './baseSlice';
import { useAppSelector, useAppDispatch } from '../../../useAppStore';

export function useBase() {
  const state = useAppSelector(selectBaseState);
  const isDev = state.nodeEnv === 'development';
  const dispatch = useAppDispatch();

  return {
    ...state,
    isDev,
    setMsg: (msg: BaseState['msg']) => dispatch(setMsg(msg)),
  };
}
