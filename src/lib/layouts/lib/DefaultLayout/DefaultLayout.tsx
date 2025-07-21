'use client';

import { ReactNode, FC } from 'react';
import { Box, Container, ContainerProps } from '@mui/material';
import { Header, Breadcrumbs } from '@/lib/components';

export interface DefaultLayoutProps {
  children: ReactNode;
  ContainerProps?: ContainerProps;
  isHeader?: boolean;
}

export const DefaultLayout: FC<DefaultLayoutProps> = ({
  children,
  isHeader = true,
  ContainerProps,
}) => {
  return (
    <>
      {isHeader && <Header />}
      <Container maxWidth="lg" component="main" {...ContainerProps}>
        <Box py={2}>
          <Breadcrumbs />
          {children}
        </Box>
      </Container>
    </>
  );
};

export default DefaultLayout;
