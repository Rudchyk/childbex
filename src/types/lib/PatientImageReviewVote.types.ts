import { ModelTimestamps } from './Model.types';

export enum PatientImageReviewVoteTypes {
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  UNCERTAIN = 'uncertain',
}

export interface PatientImageReviewVote extends ModelTimestamps {
  id: string;
  patientImageId: string;
  reviewerId: string;
  value: PatientImageReviewVoteTypes;
  comment?: string | null;
}

export type PatientImageReviewVoteModelAttributes = PatientImageReviewVote;
