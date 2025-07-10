'use server';

import { syncDb } from '@/db';
import { PatientModel, Patient } from '@/db/models/Patient.model';
import { UpdatePatientActionStates } from './UpdatePatientActionStates.enum';
import * as Yup from 'yup';
import { toSlugIfCyr } from '@/lib/utils';

export interface UpdatePatientActionState {
  status: UpdatePatientActionStates;
  message?: string;
}

export interface UpdatePatientData {
  id: string;
  data: Partial<Pick<Patient, 'name' | 'notes' | 'slug'>>;
}

export const updatePatient = async (
  _: UpdatePatientActionState,
  { id, data }: UpdatePatientData
): Promise<UpdatePatientActionState> => {
  try {
    await syncDb();

    const Patient = await PatientModel.findByPk(id);

    if (!Patient) {
      return {
        status: UpdatePatientActionStates.PATIENT_DO_NOT_EXIST,
      };
    }

    const update: UpdatePatientData['data'] = {};
    const checkStringProp = async (key: 'name' | 'notes') => {
      if (data[key]) {
        const schema = Yup.string().required();
        const validated = await schema.validate(data[key]);
        update[key] = validated;
      }
    };

    for (const element of ['name', 'notes']) {
      await checkStringProp(element as 'name' | 'notes');
    }

    if ('slug' in data) {
      const schema = Yup.string().required();
      const slug = await schema.validate(data.slug);
      update.slug = toSlugIfCyr(slug);
    }

    if (!Object.keys(update).length) {
      return { status: UpdatePatientActionStates.NOTHING_TO_UPDATE };
    }

    await Patient.update(update);

    return { status: UpdatePatientActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof Yup.ValidationError) {
      return {
        status: UpdatePatientActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    return {
      status: UpdatePatientActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};
