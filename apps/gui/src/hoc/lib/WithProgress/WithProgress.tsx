import { LinearProgress } from '@mui/material';
import { ReactElement } from 'react';

export interface WithProgressProps {
  isLoading: boolean;
  LoadingComponent?: ReactElement;
}

export const WithProgress =
  <P extends object>(WrappedComponent: React.ComponentType<P>) =>
  ({ isLoading, LoadingComponent, ...props }: P & WithProgressProps) => {
    if (isLoading) {
      return LoadingComponent || <LinearProgress />;
    }

    return <WrappedComponent {...(props as P)} />;
  };

export default WithProgress;
