import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { RootState } from '../../../store';

export interface PatientsState {
  isLoading: boolean;
}

const initialState: PatientsState = {
  isLoading: false,
};

export const selectPatientsState = (state: RootState) => state.patients;

export const patientsSlice = createSlice({
  name: 'patients',
  initialState,
  reducers: {
    setIsLoading(state, action: PayloadAction<PatientsState['isLoading']>) {
      state.isLoading = action.payload;
    },
  },
});

export const { setIsLoading } = patientsSlice.actions;
