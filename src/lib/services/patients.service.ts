import { syncDb } from '@/db';
import { Patient } from '@/db/models/Patient.model';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import { User } from '@/db/models/User.model';
import { FindOptions } from 'sequelize';

export const findExtendedPatients = async (
  props?: FindOptions<Patient>
): Promise<Patient[]> => {
  await syncDb();
  return await Patient.findAll({
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
};

export const findExtendedPatient = async (slug: Patient['slug']) => {
  await syncDb();
  return await Patient.findOne({
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
      },
    ],
  });
};
