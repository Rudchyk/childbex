import { FromSchema } from 'fets';
import { TrashedPatientsActionTypes } from '@libs/constants';

export const TrashedPatientsActionParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: Object.values(TrashedPatientsActionTypes),
      default: TrashedPatientsActionTypes.DELETE,
    },
  },
} as const;

export type TrashedPatientsActionParam = FromSchema<
  typeof TrashedPatientsActionParamSchema
>;
