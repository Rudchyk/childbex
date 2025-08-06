import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  HasManyCreateAssociationMixin,
  HasManyGetAssociationsMixin,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize';
import { sequelize } from '@/db';
import {
  PatientImage as PatientImageAttributes,
  PatientImageReviewVoteTypes,
  PatientImageStatus,
} from '@/types';
import { Patient } from './Patient.model';
import fs from 'fs';
import { User } from './User.model';
import { PatientImageCluster } from './PatientImageCluster.model';
import { PatientImageReviewVote } from './PatientImageReviewVote.model';
import { basicTimestampFields } from '../helpers/timestamps';

export class PatientImage
  extends Model<
    InferAttributes<PatientImage>,
    InferCreationAttributes<
      PatientImage,
      {
        omit:
          | 'id'
          | 'status'
          | 'isBrocken'
          | 'isAbnormal'
          | 'adminResolutionId'
          | 'resolutionComment'
          | 'resolvedAt'
          | 'votesCount'
          | 'normalVotes'
          | 'abnormalVotes'
          | 'uncertainVotes'
          | 'createdAt'
          | 'updatedAt';
      }
    >
  >
  implements PatientImageAttributes
{
  declare id: PatientImageAttributes['id'];
  declare source: PatientImageAttributes['source'];
  declare notes: PatientImageAttributes['notes'];
  declare clusterId: PatientImageAttributes['clusterId'];
  declare isBrocken: PatientImageAttributes['isBrocken'];
  declare isAbnormal: PatientImageAttributes['isAbnormal'];
  declare details: PatientImageAttributes['details'];
  declare status: PatientImageAttributes['status'];
  declare adminResolutionId: PatientImageAttributes['adminResolutionId'];
  declare resolutionComment: PatientImageAttributes['resolutionComment'];
  declare resolvedAt: PatientImageAttributes['resolvedAt'];
  declare votesCount: PatientImageAttributes['votesCount'];
  declare normalVotes: PatientImageAttributes['normalVotes'];
  declare abnormalVotes: PatientImageAttributes['abnormalVotes'];
  declare uncertainVotes: PatientImageAttributes['uncertainVotes'];

  // Sequelize‑generated:
  declare readonly createdAt: PatientImageAttributes['createdAt'];
  declare readonly updatedAt: PatientImageAttributes['updatedAt'];

  declare getPatient: BelongsToGetAssociationMixin<Patient>;
  declare getVotes: HasManyGetAssociationsMixin<PatientImageReviewVote>;
  declare createVote: HasManyCreateAssociationMixin<PatientImageReviewVote>;
  declare getResolver: BelongsToGetAssociationMixin<User>;

  // Статичні асоціації // TODO:?
  declare static associations: {
    patient: Association<PatientImage, Patient>;
    votes: Association<PatientImage, PatientImageReviewVote>;
    resolver: Association<PatientImage, User>;
  };

  // Associations:
  declare patient?: PatientImageAttributes['cluster'];
  declare votes?: PatientImageAttributes['votes'];
  declare resolver?: PatientImageAttributes['resolver'];

  public calculateStatus(): PatientImageStatus {
    const totalVotes = this.votesCount || 0;

    // Якщо немає голосів - зображення нормальне по замовчуванні
    if (totalVotes === 0) {
      return PatientImageStatus.NORMAL;
    }

    const normalCount = this.normalVotes || 0;
    const abnormalCount = this.abnormalVotes || 0;
    const uncertainCount = this.uncertainVotes || 0;

    // Якщо є резолюція адміна
    if (this.resolvedAt) {
      return PatientImageStatus.ADMIN_RESOLVED;
    }

    // Перевіряємо рівність голосів між normal і abnormal
    if (normalCount === abnormalCount && normalCount > 0) {
      return PatientImageStatus.CONFLICTED;
    }

    // Логіка визначення конфлікту (можна налаштувати)
    const significantVotes = normalCount + abnormalCount;
    const conflictThreshold = 0.3; // 30% від загальної кількості значущих голосів

    if (significantVotes >= 3) {
      const minority = Math.min(normalCount, abnormalCount);
      const majorityRatio = minority / significantVotes;

      if (majorityRatio >= conflictThreshold) {
        return PatientImageStatus.CONFLICTED;
      }
    }

    if (abnormalCount > normalCount && abnormalCount > uncertainCount) {
      return PatientImageStatus.ABNORMAL;
    } else if (normalCount > abnormalCount && normalCount > uncertainCount) {
      return PatientImageStatus.NORMAL;
    } else {
      // Якщо uncertain має найбільше голосів або інші рівності
      return PatientImageStatus.CONFLICTED;
    }
  }

  public async updateVoteCounts(): Promise<void> {
    const votes = await this.getVotes();
    this.normalVotes = votes.filter(
      (v) => v.vote === PatientImageReviewVoteTypes.NORMAL
    ).length;
    this.abnormalVotes = votes.filter(
      (v) => v.vote === PatientImageReviewVoteTypes.ABNORMAL
    ).length;
    this.uncertainVotes = votes.filter(
      (v) => v.vote === PatientImageReviewVoteTypes.UNCERTAIN
    ).length;
    this.votesCount = votes.length;
    const status = this.calculateStatus();
    this.status = status;

    switch (status) {
      case PatientImageStatus.ABNORMAL:
        this.isAbnormal = true;
        break;
      default:
        this.isAbnormal = false;
        break;
    }

    await this.save();
  }
}

PatientImage.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    clusterId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: PatientImageCluster,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    isBrocken: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isAbnormal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    details: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(PatientImageStatus)),
      allowNull: false,
      defaultValue: PatientImageStatus.NOT_REVIEWED,
    },
    adminResolutionId: {
      type: DataTypes.UUID,
      references: {
        model: User,
        key: 'id',
      },
      allowNull: true,
    },
    resolutionComment: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    votesCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    normalVotes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    abnormalVotes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    uncertainVotes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    ...basicTimestampFields,
  },
  {
    sequelize,
    tableName: 'patients_images',
    timestamps: true,
    hooks: {
      afterDestroy({ source }) {
        console.log('🚀 ~ afterDestroy ~ source:', source);
        if (fs.existsSync(source)) {
          fs.unlinkSync(source);
        }
      },
      afterUpdate: async (instance) => {
        // Автоматично оновлюємо статус після зміни голосів
        if (
          instance.changed('votesCount') ||
          instance.changed('normalVotes') ||
          instance.changed('abnormalVotes') ||
          instance.changed('uncertainVotes')
        ) {
          const newStatus = instance.calculateStatus();
          if (newStatus !== instance.status) {
            instance.status = newStatus;
            await instance.save({ hooks: false });
          }
        }
      },
    },
  }
);

PatientImageCluster.hasMany(PatientImage, {
  foreignKey: 'clusterId',
  as: 'images',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImage.belongsTo(PatientImageCluster, {
  foreignKey: 'clusterId',
  as: 'images',
});

User.hasMany(PatientImage, {
  foreignKey: 'adminResolutionId',
  as: 'resolver',
});

PatientImage.belongsTo(User, {
  foreignKey: 'adminResolutionId',
  as: 'resolver',
});
