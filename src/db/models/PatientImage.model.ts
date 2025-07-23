import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  ForeignKey,
  HasManyCreateAssociationMixin,
  HasManyGetAssociationsMixin,
  Model,
  Optional,
} from 'sequelize';
import { sequelize } from '@/db';
import {
  PatientImageModelAttributes,
  PatientImageReviewVoteTypes,
  PatientImageStatus,
} from '@/types';
import { PatientModel } from './Patient.model';
import fs from 'fs';
import { UserModel } from './User.model';
import { PatientImageReviewVoteModel } from './PatientImageReview.model';

export * from '@/types/lib/PatientImage.types';

export type PatientImageModelCreationAttributes = Optional<
  PatientImageModelAttributes,
  | 'id'
  | 'status'
  | 'votesCount'
  | 'normalVotes'
  | 'abnormalVotes'
  | 'uncertainVotes'
  | 'isReview'
>;

export class PatientImageModel
  extends Model<
    PatientImageModelAttributes,
    PatientImageModelCreationAttributes
  >
  implements PatientImageModelAttributes
{
  declare id: string;
  declare source: string;
  declare patientId: ForeignKey<PatientModel['id']>;
  declare notes?: string | null;
  declare group?: string | null;
  declare cluster?: number | null;
  declare isBrocken?: boolean | null;
  declare isAbnormal?: boolean | null;
  declare isReview: boolean;
  declare details?: object | null;
  declare status: PatientImageStatus;
  declare adminResolutionId?: ForeignKey<UserModel['id']> | null;
  declare resolutionComment?: string | null;
  declare resolvedAt?: Date | null;
  declare votesCount: number;
  declare normalVotes: number;
  declare abnormalVotes: number;
  declare uncertainVotes: number;

  declare getPatient: BelongsToGetAssociationMixin<PatientModel>;
  declare getVotes: HasManyGetAssociationsMixin<PatientImageReviewVoteModel>;
  declare createVote: HasManyCreateAssociationMixin<PatientImageReviewVoteModel>;
  declare getAdminResolver: BelongsToGetAssociationMixin<UserModel>;

  // Статичні асоціації
  declare static associations: {
    patient: Association<PatientImageModel, PatientModel>;
    votes: Association<PatientImageModel, PatientImageReviewVoteModel>;
    adminResolver: Association<PatientImageModel, UserModel>;
  };

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

    // Визначення результату по більшості
    if (abnormalCount > normalCount && abnormalCount > uncertainCount) {
      return PatientImageStatus.ABNORMAL;
    } else if (normalCount >= abnormalCount && normalCount >= uncertainCount) {
      // Нормальне зображення має пріоритет при рівності голосів
      return PatientImageStatus.NORMAL;
    } else {
      return PatientImageStatus.NORMAL; // По замовчуванні нормальне
    }
  }

  public async updateVoteCounts(): Promise<void> {
    const votes = await this.getVotes();
    this.normalVotes = votes.filter(
      (v) => v.value === PatientImageReviewVoteTypes.NORMAL
    ).length;
    this.abnormalVotes = votes.filter(
      (v) => v.value === PatientImageReviewVoteTypes.ABNORMAL
    ).length;
    this.uncertainVotes = votes.filter(
      (v) => v.value === PatientImageReviewVoteTypes.UNCERTAIN
    ).length;
    this.votesCount = votes.length;
    const status = this.calculateStatus();
    this.status = status;

    switch (status) {
      case PatientImageStatus.ABNORMAL:
        this.isAbnormal = true;
        break;
      case PatientImageStatus.NORMAL:
        this.isAbnormal = false;
        break;
      default:
        this.isAbnormal = null;
        break;
    }

    await this.save();
  }
}

PatientImageModel.init(
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
    patientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: PatientModel,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    cluster: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    group: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isBrocken: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isAbnormal: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isReview: {
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
      defaultValue: PatientImageStatus.NORMAL,
    },
    adminResolutionId: {
      type: DataTypes.UUID,
      references: {
        model: UserModel,
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
  },
  {
    sequelize,
    tableName: 'patients_images',
    timestamps: false,
    hooks: {
      afterDestroy({ source }) {
        fs.unlinkSync(source);
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

PatientModel.hasMany(PatientImageModel, {
  foreignKey: 'patientId',
  as: 'images',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageModel.belongsTo(PatientModel, {
  foreignKey: 'patientId',
  as: 'patient',
});

UserModel.hasMany(PatientImageModel, {
  foreignKey: 'adminResolutionId',
  as: 'adminResolver',
});

PatientImageModel.belongsTo(UserModel, {
  foreignKey: 'adminResolutionId',
  as: 'adminResolver',
});
