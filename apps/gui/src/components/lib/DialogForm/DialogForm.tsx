import { FC, ReactElement, useRef } from 'react';
import { UIDialog, UIDialogProps } from '../UIDialog/UIDialog';

export interface DialogFormProps extends Partial<UIDialogProps> {
  open: boolean;
  title?: string;
  onDialogClose: () => void;
  form: ReactElement;
  isLoading?: boolean;
}

export const DialogForm: FC<DialogFormProps> = ({
  form,
  isLoading = false,
  onDialogClose,
  children,
  ...other
}: DialogFormProps) => {
  const dialogEl = useRef<HTMLDivElement>(null);
  const handleSubmitClick = () => {
    const formElement = dialogEl.current?.querySelector('form');

    formElement?.dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true })
    );
  };

  return (
    <UIDialog
      {...other}
      ref={dialogEl}
      onDialogClose={onDialogClose}
      slotProps={{
        buttonCancelProps: {
          onClick: onDialogClose,
          children: 'Cancel',
          ...other.slotProps?.buttonCancelProps,
        },
        buttonProps: {
          children: 'Send',
          loading: isLoading,
          ...other.slotProps?.buttonProps,
        },
        dialogContentProps: {
          dividers: true,
        },
      }}
      onButtonClick={handleSubmitClick}
    >
      {children}
      {form}
    </UIDialog>
  );
};
