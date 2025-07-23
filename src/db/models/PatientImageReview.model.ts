import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  ForeignKey,
  Model,
  NonAttribute,
  Optional,
} from 'sequelize';
import { sequelize } from '@/db';
import {
  PatientImageReviewVoteModelAttributes,
  PatientImageReviewVoteTypes,
} from '@/types';
import { PatientImageModel } from './PatientImage.model';
import { UserModel } from './User.model';

export * from '@/types/lib/PatientImageReviewVote.types';

export type PatientImageReviewVoteModelCreationAttributes = Optional<
  PatientImageReviewVoteModelAttributes,
  'id'
>;

export class PatientImageReviewVoteModel
  extends Model<
    PatientImageReviewVoteModelAttributes,
    PatientImageReviewVoteModelCreationAttributes
  >
  implements PatientImageReviewVoteModelAttributes
{
  declare id: string;
  declare patientImageId: ForeignKey<PatientImageModel['id']>;
  declare reviewerId: ForeignKey<UserModel['id']>;
  declare value: PatientImageReviewVoteTypes;
  declare comment?: string | null;

  // Асоціації
  declare patientImage?: NonAttribute<PatientImageModel>;
  declare user?: NonAttribute<UserModel>;

  declare getPatientImage: BelongsToGetAssociationMixin<PatientImageModel>;

  declare static associations: {
    patientImage: Association<PatientImageReviewVoteModel, PatientImageModel>;
    reviewer: Association<PatientImageReviewVoteModel, UserModel>;
  };
}

PatientImageReviewVoteModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    patientImageId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: PatientImageModel,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    reviewerId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: UserModel,
        key: 'id',
      },
    },
    value: {
      type: DataTypes.ENUM(...Object.values(PatientImageReviewVoteTypes)),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'patients_images',
    hooks: {
      afterCreate: async (vote) => {
        // Оновлюємо лічильники голосів в PatientImage
        const patientImage = await vote.getPatientImage();
        await patientImage.updateVoteCounts();
      },
      afterUpdate: async (vote) => {
        if (vote.changed('value')) {
          const patientImage = await vote.getPatientImage();
          await patientImage.updateVoteCounts();
        }
      },
      afterDestroy: async (vote) => {
        const patientImage = await PatientImageModel.findByPk(
          vote.patientImageId
        );
        if (patientImage) {
          await patientImage.updateVoteCounts();
        }
      },
    },
  }
);

PatientImageModel.hasMany(PatientImageReviewVoteModel, {
  foreignKey: 'patientImageId',
  as: 'patientImage',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageReviewVoteModel.belongsTo(PatientImageModel, {
  foreignKey: 'patientImageId',
  as: 'patientImage',
});

UserModel.hasMany(PatientImageReviewVoteModel, {
  foreignKey: 'reviewerId',
  as: 'reviewer',
});

PatientImageReviewVoteModel.belongsTo(UserModel, {
  foreignKey: 'reviewerId',
  as: 'reviewer',
});
