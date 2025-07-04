'use client';

import { ReactNode, FC } from 'react';
import { Box, Container, ContainerProps } from '@mui/material';
// import { Header } from '@/lib/components';

export interface DefaultLayoutProps {
  children: ReactNode;
  ContainerProps?: ContainerProps;
}

export const DefaultLayout: FC<DefaultLayoutProps> = ({
  children,
  ContainerProps,
}) => {
  return (
    <>
      {/* <Header /> */}
      <Container maxWidth="lg" component="main" {...ContainerProps}>
        <Box py={2}>{children}</Box>
      </Container>
    </>
  );
};

export default DefaultLayout;
