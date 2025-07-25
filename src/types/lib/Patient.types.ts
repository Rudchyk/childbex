import type { Timestamps, SoftDeletion } from './Model.types';
import type { User } from './User.types';
import type { PatientImage } from './PatientImage.types';
import type { ForeignKey, NonAttribute } from 'sequelize';

export interface Patient extends Timestamps, SoftDeletion {
  id: string;
  name: string;
  slug: string;
  creatorId: ForeignKey<User['id']>;
  notes: string | null;

  // Associations:
  clusters?: NonAttribute<PatientImage[]>;
  creator?: NonAttribute<User>;
}
