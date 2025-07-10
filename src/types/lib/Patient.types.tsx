import { ModelTimestamps, ModelSoftDeleted } from './Model.types';
import { User } from './User.types';

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

export interface ExtendedPatient extends Patient {
  creator: User;
}
