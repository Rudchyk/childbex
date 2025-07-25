import type { ForeignKey } from 'sequelize';
import type { Timestamps } from './Model.types';
import type { PatientImage } from './PatientImage.types';
import type { Patient } from './Patient.types';

export const patientBrokenImageClusterName = 'broken';

export interface PatientImageCluster extends Timestamps {
  id: string;
  cluster: number;
  name: typeof patientBrokenImageClusterName | string;
  patientId: ForeignKey<Patient['id']>;
  notes: string | null;
  studyDate: Date | null;
  inReview: boolean;

  // Associations:
  images?: PatientImage[];
  patient?: Patient;
}
