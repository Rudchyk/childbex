import { FromSchema, JSONSchema } from 'json-schema-to-ts';
import type { OpenAPIV3 } from 'openapi-types';
import { S } from '../../utils/schema-helpers.js';

export const NameSchema = S.string();

export type Name = FromSchema<typeof NameSchema>;

export const NamePropertySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  $id: 'name',
  properties: {
    name: NameSchema,
  },
} as const satisfies JSONSchema | OpenAPIV3.SchemaObject;

export type NameProperty = FromSchema<typeof NamePropertySchema>;
