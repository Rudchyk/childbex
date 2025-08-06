'use server';

import { syncDb } from '@/db';
import { Patient } from '@/db/models/Patient.model';
import { TrashedPatientsActionStates } from './TrashedPatientsActionStates.enum';
import { TrashedPatientsActionTypes } from './TrashedPatientsActionTypes.enum';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import fs from 'fs';
import path from 'path';
import { UPLOAD_ROOT } from '@/lib/constants/constants';

export interface TrashedPatientsActionState {
  status: TrashedPatientsActionStates;
  message?: string;
}

export interface TrashedPatientsData {
  id: string;
  type: TrashedPatientsActionTypes;
}

export const trashedPatients = async (
  _: TrashedPatientsActionState,
  data: TrashedPatientsData
): Promise<TrashedPatientsActionState> => {
  try {
    await syncDb();
    const { id, type } = data;

    const result = await Patient.findByPk(id, { paranoid: false });

    if (!result) {
      return {
        status: TrashedPatientsActionStates.PATIENT_DO_NOT_EXIST,
      };
    }

    switch (type) {
      case TrashedPatientsActionTypes.DELETE:
        const destDir = path.join(UPLOAD_ROOT, result.slug);
        try {
          if (fs.existsSync(destDir)) {
            fs.rmdirSync(destDir, { recursive: true });
          }
        } catch (error) {
          console.info(
            '[rmdirSync]',
            destDir,
            (error as Error | SequelizeValidationError).message
          );
        }
        await result.destroy({ force: true });
        break;
      case TrashedPatientsActionTypes.RESTORE:
        await result.restore();
        break;
      default:
        throw new Error('Action does not exist!');
    }

    return { status: TrashedPatientsActionStates.SUCCESS };
  } catch (error) {
    console.error('trashedPatients', error);
    return {
      status: TrashedPatientsActionStates.FAILED,
      message: (error as Error | SequelizeValidationError).message,
    };
  }
};
