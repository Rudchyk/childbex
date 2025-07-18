'use server';

import { sequelize } from '@/db';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import {
  PatientImageModel,
  PatientImageTypes,
} from '@/db/models/PatientImage.model';
import { UpdatePatientImageActionStates } from './UpdatePatientImageActionStates.enum';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';

export interface UpdatePatientImageActionState {
  status: UpdatePatientImageActionStates;
  message?: string;
}

export interface UpdatePatientImageData {
  id: string;
  type: PatientImageTypes;
}

export const updatePatientImage = async (
  _: UpdatePatientImageActionState,
  { id, type }: UpdatePatientImageData
): Promise<UpdatePatientImageActionState> => {
  try {
    await sequelize.sync();
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return {
        status: UpdatePatientImageActionStates.FAILED,
        message: 'session does not exist',
      };
    }

    const patientImage = await PatientImageModel.findByPk(id);

    if (!patientImage) {
      return {
        status: UpdatePatientImageActionStates.PATIENT_IMAGE_DOES_NOT_EXISTS,
      };
    }

    await patientImage.update({ type });

    return { status: UpdatePatientImageActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof SequelizeValidationError) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return {
          status: UpdatePatientImageActionStates.INVALID_DATA,
          message: error.message,
        };
      }
      return {
        status: UpdatePatientImageActionStates.FAILED,
        message: error.message,
      };
    }

    return {
      status: UpdatePatientImageActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};
