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
  LLMServiceInferenceRequestBody,
} from '../schemas/schemas';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';
import { Tags } from '../lib/tags.service';
import { apiRoutes } from '@libs/constants';
import { llmService } from '../../../services/llm.service';
import { getKeycloakSecurity } from '../lib/security.service';
import { getInternalServerRequestError } from '../lib/helpers';
import { AxiosError } from 'axios';
import { PatientImage } from '../../../db/models/PatientImage.model';

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
    try {
      const itemsIds = await request.json();
      const items = await PatientImage.findAll({
        where: { id: itemsIds },
      });
      const result = await llmService.checkItems(items.map((i) => i.source));
      return Response.json(result);
    } catch (error) {
      const err = error as AxiosError<any>;
      throw getInternalServerRequestError(
        err.response?.data ? err.response.data.detail : err.message
      );
    }
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
    let body: LLMServiceInferenceRequestBody = {};
    const contentLength = request.headers.get('content-length');
    if (contentLength && +contentLength > 2) {
      body = await request.json();
    }
    try {
      const result = await llmService.getInference(body);
      return Response.json(result);
    } catch (error) {
      const err = error as AxiosError;
      throw getInternalServerRequestError(
        err.response?.data ? JSON.stringify(err.response.data) : err.message
      );
    }
  },
});
