import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '@/db';
import {
  PatientImageReviewVote as PatientImageReviewVoteAttributes,
  PatientImageReviewVoteTypes,
} from '@/types';
import { PatientImage } from './PatientImage.model';
import { User } from './User.model';
import { basicTimestampFields } from '../helpers/timestamps';

export class PatientImageReviewVote
  extends Model<
    InferAttributes<PatientImageReviewVote>,
    InferCreationAttributes<
      PatientImageReviewVote,
      {
        omit: 'id' | 'createdAt' | 'updatedAt';
      }
    >
  >
  implements PatientImageReviewVoteAttributes
{
  declare id: PatientImageReviewVoteAttributes['id'];
  declare patientImageId: PatientImageReviewVoteAttributes['patientImageId'];
  declare reviewerId: PatientImageReviewVoteAttributes['reviewerId'];
  declare vote: PatientImageReviewVoteAttributes['vote'];
  declare comment: PatientImageReviewVoteAttributes['comment'];

  // Sequelize‑generated:
  declare readonly createdAt: PatientImageReviewVoteAttributes['createdAt'];
  declare readonly updatedAt: PatientImageReviewVoteAttributes['updatedAt'];

  // Associations:
  declare image?: NonAttribute<PatientImage>;
  declare reviewer?: NonAttribute<User>;

  declare getPatientImage: BelongsToGetAssociationMixin<PatientImage>;

  declare static associations: {
    image: Association<PatientImageReviewVote, PatientImage>;
    reviewer: Association<PatientImageReviewVote, User>;
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
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    vote: {
      type: DataTypes.ENUM(...Object.values(PatientImageReviewVoteTypes)),
      allowNull: false,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ...basicTimestampFields,
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
  }
);

PatientImage.hasMany(PatientImageReviewVote, {
  foreignKey: 'patientImageId',
  as: 'image',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageReviewVote.belongsTo(PatientImage, {
  foreignKey: 'patientImageId',
  as: 'image',
});

User.hasMany(PatientImageReviewVote, {
  foreignKey: 'reviewerId',
  as: 'reviewer',
});

PatientImageReviewVote.belongsTo(User, {
  foreignKey: 'reviewerId',
  as: 'reviewer',
});
