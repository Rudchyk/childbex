import type { Timestamps, SoftDeletion } from './Model.types';
import type { User } from './User.types';
import type { PatientImageCluster } from './PatientImageCluster.types';
import type { ForeignKey, NonAttribute } from 'sequelize';

export interface Patient extends Timestamps, SoftDeletion {
  id: string;
  name: string;
  slug: string;
  creatorId: ForeignKey<User['id']>;
  notes: string | null;

  // Associations:
  clusters?: NonAttribute<PatientImageCluster[]>;
  creator?: NonAttribute<User>;
}
