import { ForeignKey } from 'sequelize';
import { Timestamps } from './Model.types';
import { PatientImage } from './PatientImage.types';
import { User } from './User.types';

export enum PatientImageReviewVoteTypes {
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  UNCERTAIN = 'uncertain',
}

export interface PatientImageReviewVote extends Timestamps {
  id: string;
  patientImageId: ForeignKey<PatientImage['id']>;
  reviewerId: ForeignKey<User['id']>;
  vote: PatientImageReviewVoteTypes;
  comment: string | null;

  // Associations:
  image?: PatientImage;
  reviewer?: User;
}
