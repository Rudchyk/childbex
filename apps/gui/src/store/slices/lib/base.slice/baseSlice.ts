import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../../../store';

export interface BaseState {
  nodeEnv?: string;
  title: string;
  description: string;
}

export const initialState: BaseState = {
  nodeEnv: process.env.NODE_ENV,
  title: '',
  description: '',
};

export const selectBaseState = (state: RootState) => state.base;

export const baseSlice = createSlice({
  name: 'base',
  initialState,
  reducers: {
    initializeBase(state, action: PayloadAction<BaseState>) {
      Object.assign(state, action.payload);
    },
  },
});

export const { initializeBase } = baseSlice.actions;
