import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
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
  PatientImageReviewVoteRequestBody,
  PatientImageReviewVoteParams,
  LLMServiceHealthResponse,
  LLMServiceCheckItemsResponse,
  LLMServiceCheckItemsRequestBody,
  LLMServiceInferenceResponse,
  LLMServiceInferenceRequestBody,
  PatientStudiesResponse,
  PatientStudiesParams,
  StudySeriesResponse,
  PatientStudyParams,
  PatientSeriesResponse,
  PatientSeriesParams,
  FinishReviewResponse,
  FinishSeriesReviewRequestBody,
} from '@libs/schemas';
import { generatePath } from 'react-router-dom';
import { createReauthBaseQuery, keycloakRefresher } from '../../../auth/reauth';

export enum TagTypesEnum {
  DATA = 'data',
  DEV = 'development',
  PATIENTS = 'patients',
  PATIENT = 'patient',
  LLM_SERVICE = 'LLM Service',
}

// https://nx.dev/docs/technologies/react/guides/use-environment-variables-in-react
export const apiBaseUrl = import.meta.env.VITE_PUBLIC_API || apiRoute;

const baseQuery = fetchBaseQuery({
  baseUrl: apiBaseUrl,
  prepareHeaders: (headers) => {
    const token = window.keycloak?.token;
    // Never send "Bearer undefined" after the token was cleared.
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

// Tokens are refreshed before they expire; on 401 one shared refresh and a
// single retry. A failed refresh ends the session and the existing sign-in
// flow redirects (no page reloads).
const baseQueryWithReauth = createReauthBaseQuery(baseQuery, {
  getAuth: () => window.keycloak,
  refresher: keycloakRefresher,
});

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
    getPatient: builder.query<Patient, IDProperty>({
      query: ({ id }) => generatePath(apiRoutes.patient, { id }),
      providesTags: [TagTypesEnum.PATIENT],
    }),
    getPatientBySlug: builder.query<GetPatientResponse, SlugProperty>({
      query: ({ slug }) => ({
        url: generatePath(apiRoutes.patientSlug, { slug }),
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
    // Patient -> Study -> Series (review data changes invalidate PATIENT).
    getPatientStudies: builder.query<PatientStudiesResponse, PatientStudiesParams>(
      {
        query: ({ patientId }) =>
          generatePath(apiRoutes.patientStudies, { patientId }),
        providesTags: [TagTypesEnum.PATIENT],
      }
    ),
    getStudySeries: builder.query<StudySeriesResponse, PatientStudyParams>({
      query: ({ patientId, studyId }) =>
        generatePath(apiRoutes.patientStudySeries, { patientId, studyId }),
      providesTags: [TagTypesEnum.PATIENT],
    }),
    getPatientSeries: builder.query<PatientSeriesResponse, PatientSeriesParams>(
      {
        query: ({ patientId, seriesId }) =>
          generatePath(apiRoutes.patientSeries, { patientId, seriesId }),
        providesTags: [TagTypesEnum.PATIENT],
      }
    ),
    finishSeriesReview: builder.mutation<
      FinishReviewResponse,
      PatientSeriesParams & FinishSeriesReviewRequestBody
    >({
      query: ({ patientId, seriesId, presentedImageIds }) => ({
        url: generatePath(apiRoutes.patientSeriesFinishReview, {
          patientId,
          seriesId,
        }),
        method: 'POST',
        body: { presentedImageIds },
      }),
      invalidatesTags: [TagTypesEnum.PATIENT],
    }),
    llmServiceHealth: builder.mutation<LLMServiceHealthResponse, void>({
      query: () => ({
        url: apiRoutes.llmServiceHealth,
        method: 'GET',
      }),
      invalidatesTags: [TagTypesEnum.LLM_SERVICE],
    }),
    llmServiceCheckItems: builder.mutation<
      LLMServiceCheckItemsResponse,
      LLMServiceCheckItemsRequestBody
    >({
      query: (body) => ({
        url: apiRoutes.llmServiceCheckItems,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.LLM_SERVICE],
    }),
    llmServiceInference: builder.mutation<
      LLMServiceInferenceResponse,
      LLMServiceInferenceRequestBody
    >({
      query: (body) => ({
        url: apiRoutes.llmServiceInference,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.LLM_SERVICE],
    }),
  }),
});

export const {
  useGetPatientsQuery,
  useAddPatientMutation,
  useDeletePatientMutation,
  useUpdatePatientMutation,
  useGetTrashedPatientsQuery,
  useDeleteOrRestoreTrashedPatientMutation,
  useGetPatientQuery,
  useGetPatientBySlugQuery,
  useAddPatientImageReviewVoteMutation,
  useUpdatePatientImageReviewVoteMutation,
  useGetPatientStudiesQuery,
  useGetStudySeriesQuery,
  useGetPatientSeriesQuery,
  useFinishSeriesReviewMutation,
  useLlmServiceHealthMutation,
  useLlmServiceCheckItemsMutation,
  useLlmServiceInferenceMutation,
} = apiStore;
