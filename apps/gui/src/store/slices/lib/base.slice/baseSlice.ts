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
    initializeBase(state, action: PayloadAction<BaseState>) {
      Object.assign(state, action.payload);
    },
    setMsg(state, action: PayloadAction<BaseState['msg']>) {
      state.msg = action.payload;
    },
  },
});

export const { initializeBase, setMsg } = baseSlice.actions;
