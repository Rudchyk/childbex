import { Tooltip } from '@mui/material';
import { ToolbarButton } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
// import { useToggle } from 'usehooks-ts';
// import { DialogForm } from '@/lib/components';
// import { useNotifications } from '@/lib/modules/NotificationsModule';
// import { startTransition, useActionState, useEffect, useState } from 'react';
// import { AddPatientActionStates } from './AddPatientActionStates.enum';
// import { addPatient, AddPatientActionState } from './addPatient.actions';
// import { SubmitHandler } from 'react-hook-form';
// import { AddPatientFormData } from './addPatientForm.schema';
// import { AddPatientForm } from './AddPatientForm';
// import { useRouter } from 'next/navigation';

export const AddPatient = () => {
  const title = 'Add patient';
  // const [loading, setLoading] = useState(false);
  // const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  // const [state, formAction] = useActionState<
  //   AddPatientActionState,
  //   AddPatientFormData
  // >(addPatient, {
  //   status: AddPatientActionStates.IDLE,
  // });
  // const onSubmit: SubmitHandler<AddPatientFormData> = async (formData) => {
  //   setLoading(true);
  //   startTransition(() => {
  //     return formAction(formData);
  //   });
  // };

  return (
    <>
      <Tooltip title={title}>
        <ToolbarButton onClick={toggleOpen}>
          <AddIcon fontSize="small" />
        </ToolbarButton>
      </Tooltip>
      {/* <DialogForm
        isLoading={loading}
        title={title}
        open={open}
        isButtonCancel={!loading}
        isButtonClose={!loading}
        onDialogClose={loading ? () => {} : toggleOpen}
        form={<AddPatientForm onSubmit={onSubmit} loading={loading} />}
      /> */}
    </>
  );
};
