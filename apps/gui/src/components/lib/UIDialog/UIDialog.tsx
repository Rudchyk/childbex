import Dialog, { DialogProps } from '@mui/material/Dialog';
import DialogActions, { DialogActionsProps } from '@mui/material/DialogActions';
import DialogContent, { DialogContentProps } from '@mui/material/DialogContent';
import DialogTitle, { DialogTitleProps } from '@mui/material/DialogTitle';
import { Button, ButtonProps, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { forwardRef, ReactNode } from 'react';

export interface UIDialogProps {
  open: boolean;
  onDialogClose: () => void;
  onButtonClick?: () => void;
  title?: ReactNode | string;
  slotProps?: {
    dialogProps?: Partial<DialogProps>;
    dialogTitleProps?: DialogTitleProps;
    dialogContentProps?: DialogContentProps;
    dialogActionsProps?: DialogActionsProps;
    buttonCancelProps?: ButtonProps;
    buttonProps?: ButtonProps;
  };
  isButtonClose?: boolean;
  isButtonCancel?: boolean;
  isButtonPrimary?: boolean;
  children?: ReactNode;
}

export const UIDialog = forwardRef<HTMLDivElement, UIDialogProps>(
  function UIDialog(
    {
      open,
      onDialogClose,
      slotProps = {},
      title,
      isButtonClose = true,
      isButtonCancel = true,
      isButtonPrimary = true,
      children,
      onButtonClick,
    },
    ref
  ) {
    const {
      dialogProps,
      dialogTitleProps,
      dialogContentProps,
      dialogActionsProps,
      buttonCancelProps = {
        children: 'Cancel',
        onClick: onDialogClose,
      },
      buttonProps = { children: 'Ok' },
    } = slotProps;
    return (
      <Dialog ref={ref} {...dialogProps} open={open} onClose={onDialogClose}>
        <DialogTitle
          {...dialogTitleProps}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            ...(dialogTitleProps?.sx || {}),
          }}
        >
          {title}
          {isButtonClose && (
            <IconButton
              edge="end"
              color="inherit"
              onClick={onDialogClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>
        {children && (
          <DialogContent
            {...dialogContentProps}
            sx={(theme) => {
              return {
                [theme.breakpoints.down('sm')]: {
                  pl: 1,
                  pr: 1,
                },
              };
            }}
          >
            {children}
          </DialogContent>
        )}
        <DialogActions {...dialogActionsProps}>
          {isButtonCancel && <Button {...buttonCancelProps} />}
          {isButtonPrimary && (
            <Button
              variant="contained"
              color="primary"
              {...buttonProps}
              onClick={onButtonClick}
            />
          )}
        </DialogActions>
      </Dialog>
    );
  }
);
