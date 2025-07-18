export enum PatientImageTypes {
  ANOMALY = 'anomaly',
  NORMAL = 'normal',
}

export interface PatientImage {
  id: string;
  source: string;
  type: PatientImageTypes;
  patient_id: string;
  notes?: string | null;
}

export type PatientImageModelAttributes = PatientImage;
