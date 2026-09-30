import { Type, type Static } from '@sinclair/typebox';

/**
 * Images of one Series of the patient to check. The server verifies that
 * every image belongs to that Series of that patient before anything is
 * sent to the LLM service.
 */
export const LLMServiceCheckItemsRequestBodySchema = Type.Object(
  {
    patientId: Type.String(),
    seriesId: Type.String(),
    imageIds: Type.Array(Type.String(), { minItems: 1, maxItems: 10000 }),
  },
  { additionalProperties: false }
);

export type LLMServiceCheckItemsRequestBody = Static<
  typeof LLMServiceCheckItemsRequestBodySchema
>;
