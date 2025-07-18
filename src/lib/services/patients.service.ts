import { syncDb } from '@/db';
import { PatientModel } from '@/db/models/Patient.model';
import { PatientImageModel } from '@/db/models/PatientImage.model';
import { UserModel } from '@/db/models/User.model';
import { ExtendedPatient, PatientModelAttributes } from '@/types';
import { FindOptions } from 'sequelize';

export const findExtendedPatients = async (
  props?: FindOptions<PatientModelAttributes>
): Promise<ExtendedPatient[]> => {
  await syncDb();
  const result = await PatientModel.findAll({
    ...props,
    include: [
      {
        model: UserModel,
        as: 'creator',
      },
      {
        model: PatientImageModel,
        as: 'images',
        separate: true,
        order: [['source', 'ASC']],
      },
    ],
  });
  return result.map((r) => r.toJSON());
};

export const findExtendedPatient = async (
  slug: PatientModelAttributes['slug']
): Promise<ExtendedPatient | undefined> => {
  await syncDb();
  const result = await PatientModel.findOne({
    where: {
      slug,
    },
    include: [
      {
        model: UserModel,
        as: 'creator',
      },
      {
        model: PatientImageModel,
        as: 'images',
        separate: true,
        order: [['source', 'ASC']],
      },
    ],
  });

  return result?.toJSON() as ExtendedPatient;
};
