'use server';

import { sequelize } from '@/db';
import {
  addPatientFormDataSchema,
  AddPatientFormData,
} from './addPatientForm.schema';
import { ValidationError } from 'yup';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import { PatientModel } from '@/db/models/Patient.model';
import { AddPatientActionStates } from './AddPatientActionStates.enum';
import { toSlugIfCyr } from '@/lib/utils';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';

export interface AddPatientActionState {
  status: AddPatientActionStates;
  message?: string;
}

export const addPatient = async (
  _: AddPatientActionState,
  data: AddPatientFormData
): Promise<AddPatientActionState> => {
  try {
    await sequelize.sync();
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return {
        status: AddPatientActionStates.FAILED,
        message: 'session does not exist',
      };
    }

    const validated = await addPatientFormDataSchema.validate(data);
    const { name, slug: validatedSlug, notes } = validated;
    const slug = validatedSlug || toSlugIfCyr(name);
    const existedPatient = await PatientModel.findOne({
      where: {
        slug: slug,
      },
    });

    if (existedPatient) {
      return {
        status: AddPatientActionStates.PATIENT_EXISTS,
      };
    }

    await PatientModel.create({
      slug,
      name,
      notes,
      creator_id: session.user.id,
    });

    return { status: AddPatientActionStates.SUCCESS };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        status: AddPatientActionStates.INVALID_DATA,
        message: error.message,
      };
    }
    if (error instanceof SequelizeValidationError) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        return {
          status: AddPatientActionStates.PATIENT_IN_TRASH,
          message: error.message,
        };
      }
      return {
        status: AddPatientActionStates.FAILED,
        message: error.message,
      };
    }

    return {
      status: AddPatientActionStates.FAILED,
      message: (error as Error).message,
    };
  }
};
