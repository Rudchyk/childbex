import { ReactNode, FC } from 'react';
import {
  Box,
  SxProps,
  Theme,
  Typography,
  Stack,
  StackProps,
  Container,
} from '@mui/material';

export interface ErrorTmplProps extends StackProps {
  title: string;
  text?: string | number;
  button?: ReactNode | null;
  children?: ReactNode;
  sx?: SxProps<Theme>;
  height?: number | string;
}

export const ErrorTmpl: FC<ErrorTmplProps> = ({
  children,
  title,
  text,
  button = null,
  ...stackProps
}) => {
  return (
    <Stack
      spacing={3}
      component={Container}
      {...stackProps}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'center',
        ...stackProps.sx,
      }}
    >
      <Typography variant="h3" component="p" align="center">
        {title}
      </Typography>
      {text && (
        <Typography
          variant="h1"
          sx={{ fontSize: '220px' }}
          component="p"
          align="center"
        >
          {text}
        </Typography>
      )}
      {children}
      {button && <Box sx={{ textAlign: 'center' }}>{button}</Box>}
    </Stack>
  );
};

export default ErrorTmpl;
