export interface DicomLoadErrorEvent {
  error: Error;
  loadid: number;
  loadtype: string;
  source: string;
  type: string;
}

export type DicomLoadErrorEvents = DicomLoadErrorEvent[];

export interface DicomLoadItemEvent {
  data: object;
  isfirstitem: boolean;
  loadid: number;
  loadtype: string;
  source: string;
  type: string;
  warn: unknown;
}
