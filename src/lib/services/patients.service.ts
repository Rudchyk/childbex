import { syncDb } from '@/db';
import { Patient } from '@/db/models/Patient.model';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import { User } from '@/db/models/User.model';
import { FindOptions, IncludeOptions } from 'sequelize';

export const findExtendedPatients = async (
  props?: FindOptions<Patient>
): Promise<Patient[]> => {
  await syncDb();
  const result = await Patient.findAll({
    ...props,
    include: [
      {
        model: User,
        as: 'creator',
      },
      {
        model: PatientImageCluster,
        as: 'clusters',
      },
    ],
  });
  return result.map((item) => item.toJSON());
};

interface FindExtendedPatientOptions {
  patientImageClusterOptions?: IncludeOptions;
}

export const findExtendedPatient = async (
  slug: Patient['slug'],
  options?: FindExtendedPatientOptions
) => {
  await syncDb();
  const result = await Patient.findOne({
    where: {
      slug,
    },
    include: [
      {
        model: User,
        as: 'creator',
      },
      {
        model: PatientImageCluster,
        as: 'clusters',
        ...options?.patientImageClusterOptions,
      },
    ],
  });
  return result;
};
