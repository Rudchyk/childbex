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
import { toSlugIfCyr, untar } from '@/lib/utils';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';
import path from 'path';
import fs from 'fs';
import tar from 'tar-fs';
import { ARCHIVES_ROOT, UPLOAD_ROOT } from '@/lib/constants/constants';

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
    const { name, slug: validatedSlug, notes, archive } = validated;
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

    if (archive) {
      const ext = path.extname(archive.name).toLowerCase();
      if (!fs.existsSync(ARCHIVES_ROOT)) {
        fs.mkdirSync(ARCHIVES_ROOT, { recursive: true });
      }
      const archiveFile = path.join(ARCHIVES_ROOT, slug + ext);
      fs.writeFileSync(archiveFile, Buffer.from(await archive.arrayBuffer()));
      const destDir = path.join(UPLOAD_ROOT, slug);
      fs.mkdirSync(destDir, { recursive: true });
      switch (ext) {
        case '.zip':
          // await unzip(archiveFile, destDir);
          break;
        default:
          await untar(archiveFile, destDir); // .tgz / .tar
          break;
      }
      tar.pack(destDir).pipe(fs.createWriteStream(`${slug}.tar`));
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
