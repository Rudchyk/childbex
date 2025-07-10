'use server';

import { syncDb } from '@/db';
import { DeletePatientActionStates } from './DeletePatientActionStates.enum';
import { PatientModel } from '@/db/models/Patient.model';

export interface DeleteProfileActionState {
  status: DeletePatientActionStates;
  message?: string;
}

export const deleteProfile = async (
  _: DeleteProfileActionState,
  id: string
): Promise<DeleteProfileActionState> => {
  try {
    await syncDb();

    const result = await PatientModel.findByPk(id);

    if (!result) {
      return {
        status: DeletePatientActionStates.PATIENT_DO_NOT_EXIST,
      };
    }

    await result.destroy();

    return { status: DeletePatientActionStates.SUCCESS };
  } catch (error) {
    return {
      status: DeletePatientActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};
