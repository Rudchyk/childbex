import { AxiosInstance } from 'axios';
import { logger } from './logger.service';
import { getLimitedAxios } from './axios.service';
import { apiRoutes } from '@libs/constants';
import {
  LLMServiceCheckItemsRequestBody,
  LLMServiceCheckItemsResponse,
  LLMServiceHealthResponse,
  LLMServiceInferenceResponse,
  LLMServiceInferenceRequestBody,
} from '@libs/schemas';

class LLMService {
  client?: AxiosInstance;

  constructor() {
    const { LLM_SERVICE_URL } = process.env;
    logger.info(LLM_SERVICE_URL, 'process.env.LLM_SERVICE_URL');
    if (LLM_SERVICE_URL) {
      this.client = getLimitedAxios({
        config: {
          baseURL: LLM_SERVICE_URL,
          timeout: 1000 * 60 * 5,
        },
      });
    } else {
      logger.warn('LLM service was not initialized');
    }
  }

  async getHealth(): Promise<LLMServiceHealthResponse> {
    if (!this.client) {
      throw new Error('LLM Service client is not initialized');
    }
    const { data } = await this.client.get<LLMServiceHealthResponse>(
      apiRoutes.llmServiceHealth
    );
    return data;
  }

  async getInference(
    props: LLMServiceInferenceRequestBody
  ): Promise<LLMServiceInferenceResponse> {
    if (!this.client) {
      throw new Error('LLM Service client is not initialized');
    }
    const { data } = await this.client.post<LLMServiceInferenceResponse>(
      apiRoutes.llmServiceInference,
      props
    );
    return data;
  }

  async checkItems(
    items: LLMServiceCheckItemsRequestBody
  ): Promise<LLMServiceCheckItemsResponse> {
    try {
      if (!this.client) {
        throw new Error('LLM Service client is not initialized');
      }
      const { data } = await this.client.post<LLMServiceCheckItemsResponse>(
        apiRoutes.llmServiceCheckItems,
        items
      );
      return data;
    } catch (error) {
      logger.error(error, 'LLMService checkItems error:');
      return {
        items: [],
      };
    }
  }
}

export const llmService = new LLMService();
