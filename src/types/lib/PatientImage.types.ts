export enum PatientImageStatus {
  PENDING = 'pending',
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  CONFLICTED = 'conflicted',
  ADMIN_RESOLVED = 'admin_resolved',
}

export interface PatientImage {
  id: string;
  source: string;
  patientId: string;
  notes?: string | null;
  group?: string | null;
  cluster?: number | null;
  isBrocken?: boolean | null;
  isAbnormal?: boolean | null;
  isReview: boolean;
  details?: object | null;
  status: PatientImageStatus;
  adminResolutionId?: string | null;
  resolutionComment?: string | null;
  resolvedAt?: Date | null;
  votesCount: number;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;
}

export type PatientImageModelAttributes = PatientImage;
