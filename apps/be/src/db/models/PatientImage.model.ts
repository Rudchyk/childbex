import {
  Association,
  DataTypes,
  HasManyCreateAssociationMixin,
  HasManyGetAssociationsMixin,
  Model,
} from 'sequelize';
import { sequelize } from '../sequelize';
import {
  PatientImageStatus,
  PatientImage as IPatientImage,
  ReviewState,
  ReviewStateSource,
} from '@libs/schemas';
import { PatientImageReviewVote } from './PatientImageReviewVote.model';
import { timestampFields } from '../helpers/timestamps';
import { afterCommit } from '../helpers/after-commit';
import { access, unlink } from 'node:fs/promises';
import { logger } from '../../services/logger.service';
import path from 'path';
import { uploadRoot } from '../../services/patients.service';
import type { PatientImageDicomMetadata } from '../../services/dicom.metadata';

/** The API shape plus the backend-internal DICOM metadata and series. */
type PatientImageAttributes = IPatientImage &
  PatientImageDicomMetadata & { seriesId: string };

export type PatientImageCreationAttributes = Pick<
  IPatientImage,
  'notes' | 'source'
> &
  Partial<PatientImageDicomMetadata> & { id?: string; seriesId: string };

export class PatientImage
  extends Model<PatientImageAttributes, PatientImageCreationAttributes>
  implements PatientImageAttributes
{
  declare id: IPatientImage['id'];
  declare source: IPatientImage['source'];
  declare notes: IPatientImage['notes'];
  declare isBrocken: IPatientImage['isBrocken'];
  declare isAbnormal: IPatientImage['isAbnormal'];
  declare status: IPatientImage['status'];
  declare adminResolutionId: IPatientImage['adminResolutionId'];
  declare adminResolutionName: IPatientImage['adminResolutionName'];
  declare resolutionComment: IPatientImage['resolutionComment'];
  declare resolvedAt: IPatientImage['resolvedAt'];
  declare votesCount: IPatientImage['votesCount'];
  declare normalVotes: IPatientImage['normalVotes'];
  declare abnormalVotes: IPatientImage['abnormalVotes'];
  declare uncertainVotes: IPatientImage['uncertainVotes'];
  // Effective review state (ground truth for review / ML labels). The fields
  // above (status, isAbnormal, the counters and the resolution fields) are
  // compatibility caches; all are written only by review.service.ts.
  declare reviewState: ReviewState;
  declare reviewStateSource: ReviewStateSource;

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
  /**
   * The DICOM Series: the image's place in the hierarchy (and its owner:
   * Series -> Study -> Patient). `source` is only where the file is stored.
   */
  declare seriesId: string;

  // Sequelize‑generated:
  declare readonly createdAt: IPatientImage['createdAt'];
  declare readonly updatedAt: IPatientImage['updatedAt'];

  declare getVotes: HasManyGetAssociationsMixin<PatientImageReviewVote>;
  declare createVote: HasManyCreateAssociationMixin<PatientImageReviewVote>;

  // Статичні асоціації
  declare static associations: {
    votes: Association<PatientImage, PatientImageReviewVote>;
  };

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
    // Migrations 202609302010-review-semantics-schema / -review-state-required.
    reviewState: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: ReviewState.NOT_REVIEWED,
    },
    reviewStateSource: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: ReviewStateSource.NONE,
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
    // Migrations 202609291200-study-series and 202610010000-drop-patient-
    // image-clusters. Referenced by table name: the Series model is not
    // imported here (it would create an import cycle).
    seriesId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'series', key: 'id' },
      onDelete: 'CASCADE',
    },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'patients_images',
    timestamps: true,
    indexes: [
      { name: 'patients_images_series_id', fields: ['seriesId'] },
      // DICOM instance identity (NULLs allowed); migration
      // 202609301800-patient-image-sop-unique.
      {
        name: 'patients_images_sop_instance_uid_unique',
        unique: true,
        fields: ['sopInstanceUid'],
      },
      { name: 'patients_images_file_sha256', fields: ['fileSha256'] },
    ],
    hooks: {
      async afterDestroy({ source }, options) {
        const root = uploadRoot.replace('uploads', '');
        const url = path.join(root, source);
        // Only once the deletion is committed (never after a rollback).
        await afterCommit(options.transaction, async () => {
          try {
            await access(url);
            await unlink(url);
          } catch {
            return;
          }
        });
      },
    },
  }
);

