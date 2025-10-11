import { selectBaseState, setMsg, BaseState, setMeta } from './baseSlice';
import { useAppSelector, useAppDispatch } from '../../../useAppStore';

export function useBase() {
  const state = useAppSelector(selectBaseState);
  const isDev = state.nodeEnv === 'development';
  const dispatch = useAppDispatch();

  return {
    ...state,
    isDev,
    setMsg: (msg: BaseState['msg']) => dispatch(setMsg(msg)),
    setMeta: (props: Partial<Pick<BaseState, 'description' | 'title'>>) =>
      dispatch(setMeta(props)),
  };
}
