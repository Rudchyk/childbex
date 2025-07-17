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
export interface DicomPositionChangeEvent {
  type: 'positionchange';
  value: [
    [256, 256, 3],
    [2.9231640624999784, -121.71183593750001, -864.7530000000002],
    181
  ];
  diffDims: number[];
  data: {
    imageUid: string;
  };
  srclayerid: string;
  dataid: number;
}
