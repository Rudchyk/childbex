'use client';

import { ReactNode, FC } from 'react';
import { Box, BoxProps, Container, ContainerProps, Stack } from '@mui/material';
import { Header, Footer, Breadcrumbs } from '../../../components';

export interface DefaultLayoutProps {
  children: ReactNode;
  slotProps?: {
    ContainerProps?: ContainerProps;
    BoxProps?: BoxProps;
  };
  isHeader?: boolean;
  isFooter?: boolean;
}

export const DefaultLayout: FC<DefaultLayoutProps> = ({
  children,
  isHeader = true,
  isFooter = true,
  slotProps,
}) => {
  return (
    <Stack height="100%">
      {isHeader && <Header />}
      <Container
        maxWidth="lg"
        component="main"
        {...slotProps?.ContainerProps}
        sx={{ flexGrow: 1, ...slotProps?.ContainerProps?.sx }}
      >
        <Box py={2} {...slotProps?.BoxProps}>
          <Breadcrumbs />
          {children}
        </Box>
      </Container>
      {isFooter && <Footer />}
    </Stack>
  );
};

export default DefaultLayout;
