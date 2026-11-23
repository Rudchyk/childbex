import { DataElement } from 'dwv';

/**
 * dwv's `error` / `abort` event of a load: `source` is the failed file or
 * URL (missing when the whole load failed); aborts carry no `error`, which
 * is an Error, a string (failed request) or a reader event. Its message can
 * carry DICOM values: only show it through `presentLoadError`.
 */
export interface DicomLoadErrorEvent {
  error?: unknown;
  dataid?: string;
  loadtype?: string;
  source?: string | File;
  type: string;
}

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
  data?: {
    imageUid: string;
  };
  srclayerid: string;
  dataid: string;
}
