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
import {
  getInternalServerRequestError,
  getInvalidRequestError,
  getNotFoundError,
  readJsonBody,
} from '../lib/helpers';
import { AxiosError } from 'axios';
import { Value } from '@libs/schemas';
import { findSeriesImageSources } from '../../../services/hierarchy.service';

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
    const body = await readJsonBody(request);
    if (!Value.Check(LLMServiceCheckItemsRequestBodySchema, body)) {
      throw getInvalidRequestError();
    }
    // Every image must belong to that Series of that patient (Series ->
    // Study -> Patient); ids supplied by a client are never trusted. The
    // same 404 whether an id is unknown or someone else's.
    const sources = await findSeriesImageSources(
      body.patientId,
      body.seriesId,
      body.imageIds
    );
    if (!sources) {
      throw getNotFoundError('images');
    }
    try {
      const result = await llmService.checkItems(sources);
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
