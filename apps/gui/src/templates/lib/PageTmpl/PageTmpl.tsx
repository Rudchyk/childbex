import { ReactNode, FC, ReactElement } from 'react';
import { Box, BoxProps } from '@mui/material';
import { useLoaderData } from 'react-router-dom';
import { LoaderData } from '../../../types';
import { PageTitle, PageTitleProps } from '../../../components';

export interface PageTmplProps {
  customTitle?: string | ReactElement;
  children?: ReactNode;
  isBreadcrumbs?: boolean;
  contentBoxProps?: BoxProps;
  pageTitleProps?: PageTitleProps;
}

export const PageTmpl: FC<PageTmplProps> = ({
  children,
  pageTitleProps,
  customTitle,
  contentBoxProps,
}) => {
  const data = useLoaderData() as LoaderData;

  return (
    <>
      {customTitle ?? <PageTitle {...pageTitleProps}>{data?.title}</PageTitle>}
      <Box py={2} {...contentBoxProps}>
        {children}
      </Box>
    </>
  );
};

export default PageTmpl;
