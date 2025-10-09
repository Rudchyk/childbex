import { TypographyProps, Typography, Stack, StackProps } from '@mui/material';
import { FC, ReactNode } from 'react';

export interface PageTitleProps {
  titleTypographyProps?: TypographyProps;
  titleStackProps?: StackProps;
  titleActions?: ReactNode;
  children?: ReactNode;
}

export const PageTitle: FC<PageTitleProps> = ({
  titleStackProps,
  titleTypographyProps,
  titleActions,
  children,
}) => {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      {...titleStackProps}
    >
      <Typography variant="h3" component="h1" py={2} {...titleTypographyProps}>
        {children}
      </Typography>
      {titleActions}
    </Stack>
  );
};

export default PageTitle;
