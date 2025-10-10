import { ReactNode, FC } from 'react';
import { Provider } from 'react-redux';
import store from './store';

export interface StoreProviderProps {
  children: ReactNode;
}

export const StoreProvider: FC<StoreProviderProps> = ({ children }) => (
  <Provider store={store}>{children}</Provider>
);

export default StoreProvider;
