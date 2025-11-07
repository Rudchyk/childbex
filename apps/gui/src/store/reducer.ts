import { combineReducers } from 'redux';
import { apiStore } from './apis';
import { baseSlice, patientsSlice } from './slices';

export default combineReducers({
  [apiStore.reducerPath]: apiStore.reducer,
  [baseSlice.reducerPath]: baseSlice.reducer,
  [patientsSlice.reducerPath]: patientsSlice.reducer,
});
