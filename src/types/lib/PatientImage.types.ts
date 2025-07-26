import { Timestamps } from './Model.types';
import type { PatientImageCluster } from './PatientImageCluster.types';
import type { PatientImageReviewVote } from './PatientImageReviewVote.types';
import type { User } from './User.types';
import type { ForeignKey } from 'sequelize';

export enum PatientImageStatus {
  NOT_REVIEWED = 'not_reviewed',
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  CONFLICTED = 'conflicted',
  ADMIN_RESOLVED = 'admin_resolved',
  BROKEN = 'broken',
}

export interface PatientImage extends Timestamps {
  id: string;
  source: string;
  notes: string | null;
  clusterId: ForeignKey<PatientImageCluster['id']>;
  isBrocken: boolean | null;
  isAbnormal: boolean | null;
  details: object | null;
  status: PatientImageStatus;
  adminResolutionId: ForeignKey<User['id']> | null;
  resolutionComment: string | null;
  resolvedAt: Date | null;
  votesCount: number;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;

  // Associations:
  cluster?: PatientImageCluster[];
  votes?: PatientImageReviewVote[];
  resolver?: User;
}
