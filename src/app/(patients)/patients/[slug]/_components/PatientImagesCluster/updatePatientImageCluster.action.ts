'use server';

import { syncDb } from '@/db';
import { UpdatePatientImageClusterActionStates } from './UpdatePatientImageClusterActionStates.enum';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import * as Yup from 'yup';

export interface UpdatePatientImageClusterActionState {
  status: UpdatePatientImageClusterActionStates;
  message?: string;
}

export interface UpdatePatientImageClusterData {
  id: string;
  inReview: boolean;
}

export const updatePatientImageCluster = async (
  _: UpdatePatientImageClusterActionState,
  data: UpdatePatientImageClusterData
): Promise<UpdatePatientImageClusterActionState> => {
  try {
    await syncDb();

    const patient = await PatientImageCluster.findByPk(data.id);

    if (!patient) {
      return {
        status: UpdatePatientImageClusterActionStates.DO_NOT_EXIST,
      };
    }
    const schema = Yup.boolean().required();
    const inReview = await schema.validate(data.inReview);

    if (inReview === patient.inReview) {
      return {
        status: UpdatePatientImageClusterActionStates.NOTHING_TO_UPDATE,
      };
    }

    await patient.update({ inReview });

    return { status: UpdatePatientImageClusterActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof Yup.ValidationError) {
      return {
        status: UpdatePatientImageClusterActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    return {
      status: UpdatePatientImageClusterActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};
