import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../../../store';

export interface BaseState {
  nodeEnv?: string;
  title: string;
  description: string;
  msg: string;
}

export const initialState: BaseState = {
  nodeEnv: process.env.NODE_ENV,
  title: '',
  description: '',
  msg: '',
};

export const selectBaseState = (state: RootState) => state.base;

export const baseSlice = createSlice({
  name: 'base',
  initialState,
  reducers: {
    setMsg(state, action: PayloadAction<BaseState['msg']>) {
      state.msg = action.payload;
    },
    setMeta(
      state,
      action: PayloadAction<Partial<Pick<BaseState, 'description' | 'title'>>>
    ) {
      if (action.payload.description) {
        state.description = action.payload.description;
      }
      if (action.payload.title) {
        state.title = action.payload.title;
      }
    },
  },
});

export const { setMsg, setMeta } = baseSlice.actions;
