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
  source: string | File;
  type: string;
  warn: unknown;
}

export interface DicomLoadProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
  item: {
    loaded: number;
    total: number;
    source: string;
  };
  loadtype: string;
  loadid: number;
  type: 'loadprogress';
}

export interface DicomLoadStartEvent {
  source: string[];
  loadtype: string;
  loadid: number;
  type: 'loadstart';
}
export interface DicomLoadEndEvent {
  source: string[];
  loadtype: string;
  loadid: number;
  type: 'loadend';
}
export interface DicomPositionChangeEvent {
  type: 'positionchange';
  value: [[number, number, number], [number, number, number], number];
  diffDims: number[];
  data: {
    imageUid: string;
  };
  srclayerid: string;
  dataid: number;
}
