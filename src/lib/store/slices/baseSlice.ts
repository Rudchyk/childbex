import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface BaseState {
  nodeEnv: string;
}

export const initialState: BaseState = { nodeEnv: process.env.NODE_ENV };

export const baseSlice = createSlice({
  name: 'base',
  initialState,
  reducers: {
    initializeBase(state, action: PayloadAction<BaseState>) {
      state = action.payload;
    },
  },
});

export const { initializeBase } = baseSlice.actions;
