import { ReactNode, FC } from 'react';
import { Container, ContainerProps, Stack } from '@mui/material';

export interface DefaultLayoutProps {
  children: ReactNode;
  ContainerProps?: ContainerProps;
}

export const DefaultLayout: FC<DefaultLayoutProps> = ({
  children,
  ContainerProps,
}) => {
  return (
    <Stack spacing={0} height="100%">
      <Container
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
        component="main"
        {...ContainerProps}
      >
        {children}
      </Container>
    </Stack>
  );
};

export default DefaultLayout;
