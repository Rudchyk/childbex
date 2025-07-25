'use server';

import { sequelize } from '@/db';
import {
  addPatientFormDataSchema,
  AddPatientFormData,
} from './addPatientForm.schema';
import { ValidationError } from 'yup';
import { ValidationError as SequelizeValidationError } from 'sequelize';
import { Patient } from '@/db/models/Patient.model';
import { AddPatientActionStates } from './AddPatientActionStates.enum';
import { toSlugIfCyr, unpackArchive, packArchive } from '@/lib/utils';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/auth.options';
import path from 'path';
import fs from 'fs';
import { ARCHIVES_ROOT, UPLOAD_ROOT } from '@/lib/constants/constants';
import {
  clusterByOrientation,
  ClusterResult,
} from '@/lib/services/dicom.service';
import { tmpdir } from 'os';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import { patientBrokenImageClusterName, PatientImageStatus } from '@/types';
import { PatientImage } from '@/db/models/PatientImage.model';

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

    const existedPatient = await Patient.findOne({
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

    const patient = await Patient.create({
      slug,
      name,
      notes,
      creatorId: session.user.id,
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

      for (const [key, value] of Object.entries(result)) {
        const isBrocken = key === patientBrokenImageClusterName;
        if (value && Array.isArray(value) && value) {
          if (isBrocken) {
            const imageCluster = await PatientImageCluster.create({
              name: key,
              id: -1,
              patientId: patient.id,
            });
            await PatientImage.bulkCreate(
              value.map(({ reason, file }: ClusterResult['broken'][0]) => ({
                source: `/uploads/${slug}/${file}`,
                notes: reason,
                clusterId: imageCluster.id,
                isBrocken: true,
                group: -1,
                status: PatientImageStatus.BROKEN,
              }))
            );
          } else {
            for (const {
              id,
              group,
              files,
              geometry,
              outliers,
              normal,
            } of value as ClusterResult['clusters']) {
              const imageCluster = await PatientImageCluster.create({
                name: group || String(id),
                id,
                patientId: patient.id,
              });
              await PatientImage.bulkCreate(
                files.map(({ file }) => ({
                  source: `/uploads/${slug}/${file}`,
                  clusterId: imageCluster.id,
                  details: {
                    geometry,
                    outliers,
                    normal,
                  },
                }))
              );
            }
          }
        }
      }
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
