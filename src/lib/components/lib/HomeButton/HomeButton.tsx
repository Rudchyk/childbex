import { FC } from 'react';
import { UINextButton, UINextButtonProps } from '../UINextButton/UINextButton';

type HomeButtonProps = Omit<UINextButtonProps, 'href'>;

export const HomeButton: FC<HomeButtonProps> = (props) => (
  <UINextButton color="inherit" size="small" href="/" {...props}>
    Home
  </UINextButton>
);
