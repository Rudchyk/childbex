import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  Model,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../sequelize';
import {
  PatientImageReviewVote as IPatientImageReviewVote,
  PatientImageReviewVoteTypes,
} from '@libs/schemas';
import { PatientImage } from './PatientImage.model';
import { timestampFields } from '../helpers/timestamps';

export type PatientImageReviewVoteCreationAttributes = Omit<
  IPatientImageReviewVote,
  'id' | 'createdAt' | 'updatedAt'
>;

export class PatientImageReviewVote
  extends Model<
    IPatientImageReviewVote,
    PatientImageReviewVoteCreationAttributes
  >
  implements IPatientImageReviewVote
{
  declare id: IPatientImageReviewVote['id'];
  declare patientImageId: IPatientImageReviewVote['patientImageId'];
  declare reviewerId: IPatientImageReviewVote['reviewerId'];
  declare reviewerName: IPatientImageReviewVote['reviewerName'];
  declare vote: IPatientImageReviewVote['vote'];
  declare comment: IPatientImageReviewVote['comment'];

  // Sequelize‑generated:
  declare readonly createdAt: IPatientImageReviewVote['createdAt'];
  declare readonly updatedAt: IPatientImageReviewVote['updatedAt'];

  declare getPatientImage: BelongsToGetAssociationMixin<PatientImage>;

  declare static associations: {
    votes: Association<PatientImageReviewVote, PatientImage>;
  };
}

PatientImageReviewVote.init(
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
        model: PatientImage,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    reviewerId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    reviewerName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    vote: {
      type: DataTypes.ENUM(...Object.values(PatientImageReviewVoteTypes)),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'patient_image_review_votes',
    hooks: {
      afterCreate: async (vote) => {
        // Оновлюємо лічильники голосів в PatientImage
        const patientImage = await vote.getPatientImage();
        await patientImage.updateVoteCounts();
      },
      afterUpdate: async (vote) => {
        if (vote.changed('vote')) {
          const patientImage = await vote.getPatientImage();
          await patientImage.updateVoteCounts();
        }
      },
      afterDestroy: async (vote) => {
        const patientImage = await PatientImage.findByPk(vote.patientImageId);
        if (patientImage) {
          await patientImage.updateVoteCounts();
        }
      },
    },
    indexes: [
      {
        unique: true,
        fields: ['patientImageId', 'reviewerId'],
      },
    ],
  }
);

PatientImage.hasMany(PatientImageReviewVote, {
  foreignKey: 'patientImageId',
  as: 'votes',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageReviewVote.belongsTo(PatientImage, {
  foreignKey: 'patientImageId',
  as: 'patientImage',
});
