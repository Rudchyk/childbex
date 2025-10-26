import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  createApi,
  fetchBaseQuery,
} from '@reduxjs/toolkit/query/react';
import { apiRoute, apiRoutes } from '@libs/constants';
import { GetPatientsResponse, Patients } from '@libs/schemas';

export enum TagTypesEnum {
  DATA = 'data',
  DEV = 'development',
  PATIENTS = 'patients',
}

const getAPIHeaders = () => {
  if (window.keycloak) {
    return {
      authorization: `Bearer ${window.keycloak.token}`,
    };
  }
  return undefined;
};

// https://nx.dev/docs/technologies/react/guides/use-environment-variables-in-react
const baseUrl = import.meta.env.VITE_PUBLIC_API || apiRoute;

const baseQuery = fetchBaseQuery({
  baseUrl,
  prepareHeaders: (headers, { getState }) => {
    const headersConfig = getAPIHeaders();
    if (headersConfig) {
      Object.entries(headersConfig).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }

    return headers;
  },
});

// https://redux-toolkit.js.org/rtk-query/usage/customizing-queries#automatic-re-authorization-by-extending-fetchbasequery
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);

  if (result.error) {
    if (result.error.status === 'FETCH_ERROR') {
      const isTokenExpired = await window.keycloak?.isTokenExpired();

      if (isTokenExpired) {
        await window.keycloak?.updateToken(5);
        const result = await baseQuery(args, api, extraOptions);
        return result;
      }

      window.location.reload();
      return result;
    }
  }

  return result;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: Object.values(TagTypesEnum),
  endpoints: (builder) => ({
    getPatients: builder.query<GetPatientsResponse, void>({
      query: () => apiRoutes.patients,
      providesTags: [TagTypesEnum.PATIENTS],
    }),
  }),
});

export const { useGetPatientsQuery } = api;
