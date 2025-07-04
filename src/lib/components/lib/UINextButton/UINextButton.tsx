import { Button, ButtonProps } from '@mui/material';
import { FC } from 'react';
import NextLink from 'next/link';

export interface UINextButtonProps extends Omit<ButtonProps, 'href'> {
  href: string;
}

export const UINextButton: FC<UINextButtonProps> = ({
  href,
  ...buttonProps
}) => {
  return <Button component={NextLink} href={href} {...buttonProps} />;
};
