// 'use client';

// import { FormControlLabel, Stack, Switch } from '@mui/material';
// import {
//   FC,
//   useActionState,
//   useEffect,
//   startTransition,
//   useState,
// } from 'react';
// import { UpdatePatientImageActionStates } from './UpdatePatientImageActionStates.enum';
// import { PatientImage, PatientImageTypes } from '@/types';
// import {
//   updatePatientImage,
//   UpdatePatientImageActionState,
//   UpdatePatientImageData,
// } from './updatePatientImage.actions';
// import { useNotifications } from '@/lib/modules/NotificationsModule';

// interface PatientDWVToolbarProps {
//   currentItem?: PatientImage;
//   onItemUpdate: (source: string, type: PatientImageTypes) => void;
// }

// export const PatientDWVToolbar: FC<PatientDWVToolbarProps> = ({
//   currentItem: _currentItem,
//   onItemUpdate,
// }) => {
//   const [state, formAction] = useActionState<
//     UpdatePatientImageActionState,
//     UpdatePatientImageData
//   >(updatePatientImage, {
//     status: UpdatePatientImageActionStates.IDLE,
//   });
//   const { notifyError, notifySuccess, notifyWarning } = useNotifications();
//   const [currentItem, setCurrentItem] = useState(_currentItem);
//   const handleChange = () => {
//     if (currentItem) {
//       startTransition(() => {
//         const data = {
//           id: currentItem.id,
//           type:
//             currentItem.type === PatientImageTypes.ANOMALY
//               ? PatientImageTypes.NORMAL
//               : PatientImageTypes.ANOMALY,
//         };
//         formAction(data);
//       });
//     }
//   };
//   useEffect(() => {
//     switch (state.status) {
//       case UpdatePatientImageActionStates.PATIENT_IMAGE_DOES_NOT_EXISTS:
//         notifyWarning('Patient image does not exist!');
//         break;
//       case UpdatePatientImageActionStates.FAILED:
//         notifyError(`Failed to create patient! ${state.message}`);
//         break;
//       case UpdatePatientImageActionStates.INVALID_DATA:
//         notifyError(`Failed validating your submission! ${state.message}`);
//         break;
//       case UpdatePatientImageActionStates.SUCCESS:
//         notifySuccess('Patient image is updated successfully!');
//         if (state.source && state.type && currentItem) {
//           onItemUpdate(state.source, state.type);
//           setCurrentItem({
//             ...currentItem,
//             type: state.type,
//           });
//         }
//         break;
//       default:
//         break;
//     }
//   }, [state]);

//   useEffect(() => {
//     setCurrentItem(_currentItem);
//   }, [_currentItem]);

//   if (!currentItem) {
//     return null;
//   }

//   return (
//     <Stack direction="row" justifyContent="center">
//       <FormControlLabel
//         control={
//           <Switch
//             onChange={handleChange}
//             checked={currentItem.type === PatientImageTypes.ANOMALY}
//           />
//         }
//         label="Anomaly"
//       />
//     </Stack>
//   );
// };
