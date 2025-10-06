import type { JSONSchema } from 'json-schema-to-ts';

export const S = {
  string: <T extends Record<string, unknown>>(opts?: T) =>
    ({ type: 'string', ...(opts ?? {}) } as const),

  number: <T extends Record<string, unknown>>(opts?: T) =>
    ({ type: 'number', ...(opts ?? {}) } as const),

  boolean: <T extends Record<string, unknown>>(opts?: T) =>
    ({ type: 'boolean', ...(opts ?? {}) } as const),

  array: <Items extends JSONSchema, T extends Record<string, unknown>>(
    items: Items,
    opts?: T
  ) => ({ type: 'array', items, ...(opts ?? {}) } as const),
} as const;
