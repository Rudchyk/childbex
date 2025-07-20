'use server';

import { sequelize } from '@/db';
import {
  addPatientFormDataSchema,
  AddPatientFormData,
} from './addPatientForm.schema';
import { ValidationError } from 'yup';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import { PatientModel } from '@/db/models/Patient.model';
import {
  PatientImageModel,
  PatientImageModelCreationAttributes,
  PatientImageStates,
} from '@/db/models/PatientImage.model';
import { AddPatientActionStates } from './AddPatientActionStates.enum';
import { toSlugIfCyr, unpackArchive, packArchive } from '@/lib/utils';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';
import path from 'path';
import fs from 'fs';
import { ARCHIVES_ROOT, UPLOAD_ROOT } from '@/lib/constants/constants';
import { clusterByOrientation } from '@/lib/services/dicom.service';
import { tmpdir } from 'os';

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
        slug,
      },
      paranoid: false,
    });

    if (existedPatient) {
      if (existedPatient.isSoftDeleted()) {
        return {
          status: AddPatientActionStates.PATIENT_IN_TRASH,
        };
      } else {
        return {
          status: AddPatientActionStates.PATIENT_EXISTS,
        };
      }
    }

    const patient = await PatientModel.create({
      slug,
      name,
      notes,
      creator_id: session.user.id,
    });

    if (archive) {
      const ext = path.extname(archive.name).toLowerCase();
      if (!fs.existsSync(ARCHIVES_ROOT)) {
        fs.mkdirSync(ARCHIVES_ROOT, { recursive: true });
      }
      const tmp = path.join(
        tmpdir(),
        process.env.npm_package_name || '',
        'uploads',
        archive.name
      );
      const tmpPath = path.dirname(tmp);
      if (!fs.existsSync(tmpPath)) {
        fs.mkdirSync(tmpPath, { recursive: true });
      }
      // const archiveFile = path.join(ARCHIVES_ROOT, slug + ext);
      fs.writeFileSync(tmp, Buffer.from(await archive.arrayBuffer()));
      const destDir = path.join(UPLOAD_ROOT, slug);
      fs.mkdirSync(destDir, { recursive: true });
      switch (ext) {
        case '.zip':
          // await unzip(archiveFile, destDir);
          break;
        default:
          await unpackArchive(tmp, destDir); // .tgz / .tar
          break;
      }
      fs.unlinkSync(tmp);
      await packArchive(destDir, path.join(ARCHIVES_ROOT, slug + '.tgz'));
      const imagesList = fs.readdirSync(destDir);
      const inputFiles = imagesList.map((f) => path.join(destDir, f));
      const result = clusterByOrientation(inputFiles);
      const brokenItemsMapping = Object.fromEntries(
        (result?.broken || []).map((item) => {
          const parsedFile = path.parse(item.file);
          return [parsedFile.name, item.reason];
        })
      );
      const usableItemsMapping: Record<
        string,
        { geometry: string; cluster: string }
      > = {};
      result?.clusters.forEach(({ files = [], id, geometry }) => {
        files.forEach(({ file }) => {
          const parsedFile = path.parse(file);
          usableItemsMapping[parsedFile.name] = {
            cluster: String(id),
            geometry: JSON.stringify(geometry),
          };
        });
      });
      const patientImages = imagesList.map((imageName) => {
        const base: PatientImageModelCreationAttributes = {
          source: `/uploads/${slug}/${imageName}`,
          patient_id: patient.id,
          state: PatientImageStates.USABLE,
        };
        const reason = brokenItemsMapping[imageName];
        if (reason) {
          base.state = PatientImageStates.BROKEN;
          base.notes = reason;
        } else {
          const usable = usableItemsMapping[imageName];
          base.cluster = usable?.cluster;
          base.geometry = usable?.geometry;
        }

        return base as PatientImageModelCreationAttributes;
      });

      await PatientImageModel.bulkCreate(patientImages);
    }
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
          status: AddPatientActionStates.INVALID_DATA,
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
