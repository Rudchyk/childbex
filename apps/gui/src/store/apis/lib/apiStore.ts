import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  createApi,
  fetchBaseQuery,
} from '@reduxjs/toolkit/query/react';
import { apiRoute, apiRoutes } from '@libs/constants';
import {
  CreatePatientRequestBody,
  GetPatientsResponse,
  Patient,
  IDProperty,
  UpdatePatientRequestBody,
  TrashedPatientsActionParam,
  SlugProperty,
  GetPatientResponse,
  UpdatePatientAssetRequestBody,
  GetPatientClusterResponse,
  GetPatientClusterParams,
  PatientImageReviewVoteRequestBody,
  PatientImageReviewVoteParams,
} from '@libs/schemas';
import { generatePath } from 'react-router-dom';

export enum TagTypesEnum {
  DATA = 'data',
  DEV = 'development',
  PATIENTS = 'patients',
  PATIENT = 'patient',
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

export const apiStore = createApi({
  reducerPath: 'apiStore',
  baseQuery: baseQueryWithReauth,
  tagTypes: Object.values(TagTypesEnum),
  endpoints: (builder) => ({
    getPatients: builder.query<GetPatientsResponse, void>({
      query: () => apiRoutes.patients,
      providesTags: [TagTypesEnum.PATIENTS],
    }),
    getTrashedPatients: builder.query<GetPatientsResponse, void>({
      query: () => apiRoutes.trashedPatients,
      providesTags: [TagTypesEnum.PATIENTS],
    }),
    addPatient: builder.mutation<Patient, CreatePatientRequestBody>({
      query: (body) => ({
        url: apiRoutes.patients,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.PATIENTS],
    }),
    deletePatient: builder.mutation<Patient, IDProperty>({
      query: ({ id }) => ({
        url: generatePath(apiRoutes.patient, { id }),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.PATIENTS],
    }),
    updatePatient: builder.mutation<
      Patient,
      IDProperty & UpdatePatientRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generatePath(apiRoutes.patient, { id }),
        body,
        method: 'PATCH',
      }),
      invalidatesTags: [TagTypesEnum.PATIENTS],
    }),
    uploadPatientAssets: builder.mutation<
      Patient,
      IDProperty & { body: FormData }
    >({
      query: ({ id, body }) => ({
        url: generatePath(apiRoutes.patientAssetsUpload, { id }),
        body,
        method: 'POST',
      }),
      invalidatesTags: [TagTypesEnum.PATIENTS],
    }),
    deleteOrRestoreTrashedPatient: builder.mutation<
      Patient,
      IDProperty & TrashedPatientsActionParam
    >({
      query: ({ id, ...params }) => ({
        url: generatePath(apiRoutes.trashedPatient, { id }),
        params,
        method: 'POST',
      }),
      invalidatesTags: [TagTypesEnum.PATIENTS],
    }),
    getPatientBySlug: builder.query<GetPatientResponse, SlugProperty>({
      query: ({ slug }) => ({
        url: generatePath(apiRoutes.patientSlug, { slug }),
      }),
      providesTags: [TagTypesEnum.PATIENT],
    }),
    updatePatientImagesCluster: builder.mutation<
      void,
      IDProperty & UpdatePatientAssetRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generatePath(apiRoutes.patientImagesCluster, { id }),
        body,
        method: 'PATCH',
      }),
      invalidatesTags: [TagTypesEnum.PATIENT],
    }),
    getPatientImagesCluster: builder.query<
      GetPatientClusterResponse,
      GetPatientClusterParams
    >({
      query: ({ slug, cluster }) => ({
        url: generatePath(apiRoutes.patientSlugImagesClustersCluster, {
          slug,
          cluster,
        }),
      }),
      providesTags: [TagTypesEnum.PATIENT],
    }),
    addPatientImageReviewVote: builder.mutation<
      void,
      IDProperty & PatientImageReviewVoteRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generatePath(apiRoutes.patientImagesReviewsVotes, {
          id,
        }),
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.PATIENT],
    }),
    updatePatientImageReviewVote: builder.mutation<
      void,
      PatientImageReviewVoteParams & PatientImageReviewVoteRequestBody
    >({
      query: ({ id, voteId, ...body }) => ({
        url: generatePath(apiRoutes.patientImageReviewVote, {
          id,
          voteId,
        }),
        method: 'PATCH',
        body,
      }),
      invalidatesTags: [TagTypesEnum.PATIENT],
    }),
  }),
});

export const {
  useGetPatientsQuery,
  useAddPatientMutation,
  useDeletePatientMutation,
  useUpdatePatientMutation,
  useUploadPatientAssetsMutation,
  useGetTrashedPatientsQuery,
  useDeleteOrRestoreTrashedPatientMutation,
  useGetPatientBySlugQuery,
  useUpdatePatientImagesClusterMutation,
  useGetPatientImagesClusterQuery,
  useAddPatientImageReviewVoteMutation,
  useUpdatePatientImageReviewVoteMutation,
} = apiStore;
