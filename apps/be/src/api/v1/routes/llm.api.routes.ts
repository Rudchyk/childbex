import { Response } from 'fets';
import { router } from '../apiRouter';
import {
  defaultResponses,
  unauthorizedResponse,
  LLMServiceCheckItemsRequestBodySchema,
  LLMServiceCheckItemsResponseSchema,
  LLMServiceInferenceRequestBodySchema,
  LLMServiceInferenceResponseSchema,
  LLMServiceHealthResponseSchema,
} from '../schemas/schemas';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';
import { Tags } from '../lib/tags.service';
import { apiRoutes } from '@libs/constants';
import { llmService } from '../../../services/llm.service';
import { getKeycloakSecurity } from '../lib/security.service';

const tags = [Tags.LLM_SERVICE];

router.route({
  method: 'GET',
  path: apiRoutes.llmServiceHealth,
  tags,
  schemas: {
    responses: {
      200: LLMServiceHealthResponseSchema,
      ...defaultResponses,
    },
  },
  async handler() {
    const result = await llmService.getHealth();
    return Response.json(result);
  },
});

router.route({
  method: 'POST',
  path: apiRoutes.llmServiceCheckItems,
  tags,
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: [],
    },
  ],
  schemas: {
    request: {
      json: LLMServiceCheckItemsRequestBodySchema,
    },
    responses: {
      200: LLMServiceCheckItemsResponseSchema,
      ...unauthorizedResponse,
      ...defaultResponses,
    },
  },
  handler: async (request) => {
    const items = await request.json();
    const result = await llmService.checkItems(items);
    return Response.json(result);
  },
});

router.route({
  method: 'POST',
  path: apiRoutes.llmServiceInference,
  tags,
  ...getKeycloakSecurity(),
  schemas: {
    request: {
      json: LLMServiceInferenceRequestBodySchema,
    },
    responses: {
      200: LLMServiceInferenceResponseSchema,
      ...unauthorizedResponse,
      ...defaultResponses,
    },
  },
  handler: async (request) => {
    const props = await request.json();
    const result = await llmService.getInference(props);
    return Response.json(result);
  },
});
