'use client';

import { useRef } from 'react';
import { Provider } from 'react-redux';
import { makeStore, AppStore } from '@/lib/store/store';
import { BaseState, initializeBase } from '@/lib/store/slices/baseSlice';

export interface StoreProviderProps {
  children: React.ReactNode;
  data: Pick<BaseState, 'nodeEnv'>;
}

export const StoreProvider = ({ children, data }: StoreProviderProps) => {
  const storeRef = useRef<AppStore | null>(null);

  if (!storeRef.current) {
    storeRef.current = makeStore();
    storeRef.current.dispatch(initializeBase(data));
  }

  return <Provider store={storeRef.current}>{children}</Provider>;
};
