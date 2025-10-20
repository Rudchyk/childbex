import { DataElement } from 'dwv';

export interface DicomLoadErrorEvent {
  error: Error;
  loadid: number;
  loadtype: string;
  source: string;
  type: string;
}

export type DicomLoadErrorEvents = DicomLoadErrorEvent[];

export interface DicomLoadItemEvent {
  data: Record<string, DataElement>;
  isfirstitem: boolean;
  dataid: string;
  loadtype: 'image' | string;
  source: string | File;
  type: 'loaditem';
  warn: unknown;
}

export interface DicomRenderendEvent {
  dataid: string;
  layerid: string;
  srclayerid: string;
  type: 'loadprogress';
}
export interface DicomLoadEvent {
  dataid: string;
  loadtype: 'image' | string;
  source: string | File;
  type: 'load';
}

export interface DicomLoadProgressEvent {
  lengthComputable: boolean;
  loaded: number;
  total: number;
  item: {
    loaded: number;
    total: number;
    source: string | File;
  };
  loadtype: 'image' | string;
  dataid: string;
  type: 'loadprogress';
}

export interface DicomLoadStartEvent {
  dataid: string;
  loadtype: 'image' | string;
  source: string[] | FileList;
  type: 'loadstart';
}
export interface DicomLoadEndEvent {
  dataid: string;
  loadtype: 'image' | string;
  source: string[] | FileList;
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
  dataid: string;
}
