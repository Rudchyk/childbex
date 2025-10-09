import { Type, type Static } from '@sinclair/typebox';

export const ErrorSchema = Type.Object({
  message: Type.String({
    description: 'Error message',
  }),
  errors: Type.Optional(
    Type.Object(
      {},
      {
        description: 'The list of errors',
        additionalProperties: true,
      }
    )
  ),
  status: Type.Optional(Type.Number()),
  statusCode: Type.Optional(Type.Number()),
  expose: Type.Optional(Type.Boolean()),
});

export type Error = Static<typeof ErrorSchema>;
