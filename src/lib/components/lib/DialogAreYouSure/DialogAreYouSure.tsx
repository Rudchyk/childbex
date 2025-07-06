import { FC } from 'react';
import { UIDialog, UIDialogProps } from '../UIDialog/UIDialog';

export interface DialogAreYouSureProps extends Partial<UIDialogProps> {
  open: boolean;
  onAgree: () => void;
  onDisagree: () => void;
}

export const DialogAreYouSure: FC<DialogAreYouSureProps> = ({
  title = 'Are you sure?',
  onAgree,
  onDisagree,
  ...other
}) => {
  return (
    <UIDialog
      {...other}
      title={title}
      isButtonClose={false}
      onDialogClose={onDisagree}
      slotProps={{
        buttonCancelProps: {
          onClick: onDisagree,
          children: 'Disagree',
        },
        buttonProps: {
          children: 'Agree',
        },
      }}
      onButtonClick={onAgree}
    />
  );
};
