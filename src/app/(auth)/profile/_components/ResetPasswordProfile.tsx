import { FC } from 'react';

interface ResetPasswordProfileProps {
  id: string;
}

export const ResetPasswordProfile: FC<ResetPasswordProfileProps> = ({ id }) => {
  return <>ResetPassword {id}</>;
};
