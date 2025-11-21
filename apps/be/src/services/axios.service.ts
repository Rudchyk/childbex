import axios, { AxiosError, CreateAxiosDefaults } from 'axios';
import axiosRetry, { IAxiosRetryConfig } from 'axios-retry';
import axiosThrottle from 'axios-request-throttle';

export const defaultAxiosTimeout = 1000 * 60 * 5;

export const axiosWithRetry = axios.create();

export const getErrorMsg = (error: AxiosError) =>
  error?.response?.data ? error.response.data : error?.message;

export const getDefaultRetryTime = (retryCount: number, x = 2, t = 60000) =>
  Math.min(1000 * Math.pow(x, retryCount), t);

export const axiosRetryDefaultOptions: IAxiosRetryConfig = {
  retries: 5,
  retryDelay: (retryCount, error) =>
    error?.response?.headers?.['Retry-After']
      ? Number(error.response.headers['Retry-After']) * 1000
      : getDefaultRetryTime(retryCount),
  retryCondition: (error) => true,
  onRetry(retryCount, error, requestConfig) {
    const paramsMsg = requestConfig?.params
      ? `, params: ${JSON.stringify(requestConfig.params)}`
      : '';
    console.log(
      `[${requestConfig?.method}] Retry attempt ${retryCount} to ${
        requestConfig?.baseURL
      }${requestConfig?.url}${paramsMsg}: ${getErrorMsg(error)}`
    );
  },
};

axiosRetry(axiosWithRetry, axiosRetryDefaultOptions);

export const limitedAxios = axios.create();

axiosThrottle.use(limitedAxios, { requestsPerSecond: 5 });

axiosRetry(limitedAxios, axiosRetryDefaultOptions);

export interface LimitedAxiosProps {
  config?: CreateAxiosDefaults;
  requestsPerSecond?: number;
  retryCondition?: (error: AxiosError<unknown, any>) => boolean;
  isRetry?: boolean;
  retryConfig?: IAxiosRetryConfig;
}

export const getLimitedAxios = ({
  config,
  requestsPerSecond = 10,
  isRetry = true,
  retryConfig = axiosRetryDefaultOptions,
}: LimitedAxiosProps) => {
  const client = axios.create(config);

  if (isRetry) {
    axiosRetry(client, retryConfig);
  }

  axiosThrottle.use(client, { requestsPerSecond });

  return client;
};
