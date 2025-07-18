import { ModelTimestamps, ModelSoftDeleted } from './Model.types';
import { User } from './User.types';
import { PatientImage } from './PatientImage.types';

export interface Patient {
  id: string;
  name: string;
  slug: string;
  creator_id: string;
  notes?: string | null;
}

export type PatientModelAttributes = Patient &
  ModelTimestamps &
  ModelSoftDeleted;

export interface ExtendedPatient extends PatientModelAttributes {
  creator: User;
  images?: PatientImage[];
}
