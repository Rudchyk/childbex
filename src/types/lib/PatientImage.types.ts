export enum PatientImageTypes {
  ANOMALY = 'anomaly',
  NORMAL = 'normal',
}

export enum PatientImageStates {
  BROKEN = 'broken',
  USABLE = 'usable',
}

export interface PatientImage {
  id: string;
  source: string;
  type: PatientImageTypes;
  patient_id: string;
  notes?: string | null;
  state: PatientImageStates;
  cluster?: string | null;
  geometry?: string | null;
}

export type PatientImageModelAttributes = PatientImage;
