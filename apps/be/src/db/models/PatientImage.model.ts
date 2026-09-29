import {
  Association,
  BelongsToGetAssociationMixin,
  DataTypes,
  ForeignKey,
  HasManyCreateAssociationMixin,
  HasManyGetAssociationsMixin,
  Model,
} from 'sequelize';
import { sequelize } from '../sequelize';
import {
  PatientImageReviewVoteTypes,
  PatientImageStatus,
  PatientImage as IPatientImage,
} from '@libs/schemas';
import { Patient } from './Patient.model';
import { PatientImagesCluster } from './PatientImagesCluster.model';
import { PatientImageReviewVote } from './PatientImageReviewVote.model';
import { timestampFields } from '../helpers/timestamps';
import { access, unlink } from 'node:fs/promises';
import { logger } from '../../services/logger.service';
import path from 'path';
import { uploadRoot } from '../../services/patients.service';
import type { PatientImageDicomMetadata } from '../../services/dicom.metadata';

/** The API shape plus the backend-internal DICOM metadata and series. */
type PatientImageAttributes = IPatientImage &
  PatientImageDicomMetadata & { seriesId: string | null };

export type PatientImageCreationAttributes = Pick<
  IPatientImage,
  'details' | 'clusterId' | 'notes' | 'source'
> &
  Partial<PatientImageDicomMetadata> & { seriesId?: string | null };

export class PatientImage
  extends Model<PatientImageAttributes, PatientImageCreationAttributes>
  implements PatientImageAttributes
{
  declare id: IPatientImage['id'];
  declare source: IPatientImage['source'];
  declare notes: IPatientImage['notes'];
  declare clusterId: ForeignKey<IPatientImage['clusterId']>;
  declare isBrocken: IPatientImage['isBrocken'];
  declare isAbnormal: IPatientImage['isAbnormal'];
  declare details: IPatientImage['details'];
  declare status: IPatientImage['status'];
  declare adminResolutionId: IPatientImage['adminResolutionId'];
  declare adminResolutionName: IPatientImage['adminResolutionName'];
  declare resolutionComment: IPatientImage['resolutionComment'];
  declare resolvedAt: IPatientImage['resolvedAt'];
  declare votesCount: IPatientImage['votesCount'];
  declare normalVotes: IPatientImage['normalVotes'];
  declare abnormalVotes: IPatientImage['abnormalVotes'];
  declare uncertainVotes: IPatientImage['uncertainVotes'];

  // DICOM metadata (backend-internal, null for images imported before it
  // was recorded):
  declare studyInstanceUid: PatientImageDicomMetadata['studyInstanceUid'];
  declare seriesInstanceUid: PatientImageDicomMetadata['seriesInstanceUid'];
  declare sopInstanceUid: PatientImageDicomMetadata['sopInstanceUid'];
  declare sopClassUid: PatientImageDicomMetadata['sopClassUid'];
  declare modality: PatientImageDicomMetadata['modality'];
  declare imageType: PatientImageDicomMetadata['imageType'];
  declare seriesNumber: PatientImageDicomMetadata['seriesNumber'];
  declare instanceNumber: PatientImageDicomMetadata['instanceNumber'];
  declare frameOfReferenceUid: PatientImageDicomMetadata['frameOfReferenceUid'];
  declare seriesDescription: PatientImageDicomMetadata['seriesDescription'];
  declare convolutionKernel: PatientImageDicomMetadata['convolutionKernel'];
  declare imagePositionPatient: PatientImageDicomMetadata['imagePositionPatient'];
  declare imageOrientationPatient: PatientImageDicomMetadata['imageOrientationPatient'];
  declare slicePosition: PatientImageDicomMetadata['slicePosition'];
  declare rows: PatientImageDicomMetadata['rows'];
  declare columns: PatientImageDicomMetadata['columns'];
  declare pixelSpacing: PatientImageDicomMetadata['pixelSpacing'];
  declare sliceThickness: PatientImageDicomMetadata['sliceThickness'];
  declare rescaleSlope: PatientImageDicomMetadata['rescaleSlope'];
  declare rescaleIntercept: PatientImageDicomMetadata['rescaleIntercept'];
  declare photometricInterpretation: PatientImageDicomMetadata['photometricInterpretation'];
  declare bitsStored: PatientImageDicomMetadata['bitsStored'];
  declare pixelRepresentation: PatientImageDicomMetadata['pixelRepresentation'];
  declare numberOfFrames: PatientImageDicomMetadata['numberOfFrames'];
  declare transferSyntaxUid: PatientImageDicomMetadata['transferSyntaxUid'];
  declare fileSha256: PatientImageDicomMetadata['fileSha256'];
  /** BIGINT: read back as a string by the pg driver. */
  declare fileSize: PatientImageDicomMetadata['fileSize'];
  /** DICOM series (backend-internal; null until linked). */
  declare seriesId: string | null;

  // Sequelize‑generated:
  declare readonly createdAt: IPatientImage['createdAt'];
  declare readonly updatedAt: IPatientImage['updatedAt'];

  declare getPatient: BelongsToGetAssociationMixin<Patient>;
  declare getVotes: HasManyGetAssociationsMixin<PatientImageReviewVote>;
  declare createVote: HasManyCreateAssociationMixin<PatientImageReviewVote>;

  // Статичні асоціації
  declare static associations: {
    patient: Association<PatientImage, Patient>;
    cluster: Association<PatientImage, PatientImagesCluster>;
    votes: Association<PatientImage, PatientImageReviewVote>;
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
      unique: true,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    clusterId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: PatientImagesCluster,
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
      type: DataTypes.STRING,
      allowNull: true,
    },
    adminResolutionName: {
      type: DataTypes.STRING,
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
    // DICOM metadata, see migration 202609281200-patient-image-dicom-metadata.
    studyInstanceUid: { type: DataTypes.STRING(64), allowNull: true },
    seriesInstanceUid: { type: DataTypes.STRING(64), allowNull: true },
    sopInstanceUid: { type: DataTypes.STRING(64), allowNull: true },
    sopClassUid: { type: DataTypes.STRING(64), allowNull: true },
    modality: { type: DataTypes.STRING(16), allowNull: true },
    imageType: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true },
    seriesNumber: { type: DataTypes.INTEGER, allowNull: true },
    instanceNumber: { type: DataTypes.INTEGER, allowNull: true },
    frameOfReferenceUid: { type: DataTypes.STRING(64), allowNull: true },
    seriesDescription: { type: DataTypes.TEXT, allowNull: true },
    convolutionKernel: { type: DataTypes.TEXT, allowNull: true },
    imagePositionPatient: {
      type: DataTypes.ARRAY(DataTypes.DOUBLE),
      allowNull: true,
    },
    imageOrientationPatient: {
      type: DataTypes.ARRAY(DataTypes.DOUBLE),
      allowNull: true,
    },
    slicePosition: { type: DataTypes.DOUBLE, allowNull: true },
    rows: { type: DataTypes.INTEGER, allowNull: true },
    columns: { type: DataTypes.INTEGER, allowNull: true },
    pixelSpacing: { type: DataTypes.ARRAY(DataTypes.DOUBLE), allowNull: true },
    sliceThickness: { type: DataTypes.DOUBLE, allowNull: true },
    rescaleSlope: { type: DataTypes.DOUBLE, allowNull: true },
    rescaleIntercept: { type: DataTypes.DOUBLE, allowNull: true },
    photometricInterpretation: { type: DataTypes.STRING(16), allowNull: true },
    bitsStored: { type: DataTypes.SMALLINT, allowNull: true },
    pixelRepresentation: { type: DataTypes.SMALLINT, allowNull: true },
    numberOfFrames: { type: DataTypes.INTEGER, allowNull: true },
    transferSyntaxUid: { type: DataTypes.STRING(64), allowNull: true },
    fileSha256: { type: DataTypes.CHAR(64), allowNull: true },
    fileSize: { type: DataTypes.BIGINT, allowNull: true },
    // Migration 202609291200-study-series. Referenced by table name: the
    // Series model is not imported here (it would create an import cycle).
    seriesId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'series', key: 'id' },
      onDelete: 'NO ACTION',
    },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'patients_images',
    timestamps: true,
    indexes: [{ name: 'patients_images_series_id', fields: ['seriesId'] }],
    hooks: {
      async afterDestroy({ source }) {
        const root = uploadRoot.replace('uploads', '');
        const url = path.join(root, source);
        try {
          await access(url);
          await unlink(url);
        } catch {
          return;
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

PatientImagesCluster.hasMany(PatientImage, {
  foreignKey: 'clusterId',
  as: 'images',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImage.belongsTo(PatientImagesCluster, {
  foreignKey: 'clusterId',
  as: 'cluster',
});
