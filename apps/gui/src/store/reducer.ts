import { combineReducers } from 'redux';
import { api } from './apis';
import { baseSlice } from './slices';

export default combineReducers({
  [api.reducerPath]: api.reducer,
  [baseSlice.reducerPath]: baseSlice.reducer,
});
