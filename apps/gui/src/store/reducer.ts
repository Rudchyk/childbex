import { combineReducers } from 'redux';
import { apiStore } from './apis';
import { baseSlice } from './slices';

export default combineReducers({
  [apiStore.reducerPath]: apiStore.reducer,
  [baseSlice.reducerPath]: baseSlice.reducer,
});
