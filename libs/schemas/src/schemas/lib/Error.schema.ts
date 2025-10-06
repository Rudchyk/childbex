import { FromSchema, JSONSchema } from 'json-schema-to-ts';
import type { OpenAPIV3 } from 'openapi-types';
import { S } from '../../utils/schema-helpers.js';

export const ErrorSchema = {
  type: 'object',
  description: 'Error Object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    message: S.string({
      description: 'Error message',
    }),
    errors: {
      type: 'object',
      additionalProperties: true,
      description: 'The list of errors',
    },
    status: S.number(),
    statusCode: S.number(),
    expose: S.boolean(),
  },
} as const satisfies JSONSchema | OpenAPIV3.SchemaObject;

export type Error = FromSchema<typeof ErrorSchema>;
