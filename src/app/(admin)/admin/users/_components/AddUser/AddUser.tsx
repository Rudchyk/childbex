'use client';

import { Tooltip } from '@mui/material';
import { ToolbarButton, Toolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from 'usehooks-ts';
import { DialogForm } from '@/lib/components';

export const AddUser = () => {
  const [open, toggleOpen] = useToggle(false);
  const title = 'Add user';
  return (
    <>
      <Toolbar>
        <Tooltip title={title}>
          <ToolbarButton onClick={toggleOpen}>
            <AddIcon fontSize="small" />
          </ToolbarButton>
        </Tooltip>
      </Toolbar>
      <DialogForm
        title={title}
        open={open}
        onDialogClose={toggleOpen}
        // form={<AddAccountForm onSubmit={onSubmit} onError={onError} />}
        form={<>1111</>}
      />
    </>
  );
};
