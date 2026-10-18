'use client';

import { ReactNode, FC } from 'react';
import { Box, BoxProps, Container, ContainerProps, Stack } from '@mui/material';
import {
  Header,
  Footer,
  Breadcrumbs,
  BreadcrumbItem,
} from '../../../components';

export interface DefaultLayoutProps {
  children: ReactNode;
  slotProps?: {
    ContainerProps?: ContainerProps;
    BoxProps?: BoxProps;
  };
  isHeader?: boolean;
  isFooter?: boolean;
  isContainer?: boolean;
  /** The page's breadcrumb trail after Home (see Breadcrumbs). */
  breadcrumbs?: BreadcrumbItem[];
}

export const DefaultLayout: FC<DefaultLayoutProps> = ({
  children,
  isHeader = true,
  isFooter = true,
  isContainer = true,
  slotProps,
  breadcrumbs,
}) => {
  return (
    <Stack height="100%">
      {isHeader && <Header />}
      {isContainer ? (
        <Container
          maxWidth="lg"
          component="main"
          {...slotProps?.ContainerProps}
          sx={{ flexGrow: 1, ...slotProps?.ContainerProps?.sx }}
        >
          <Box py={2} height="100%" {...slotProps?.BoxProps}>
            <Breadcrumbs items={breadcrumbs} />
            {children}
          </Box>
        </Container>
      ) : (
        children
      )}
      {isFooter && <Footer />}
    </Stack>
  );
};

export default DefaultLayout;
