import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const apiService = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getHello: builder.query<{ message: string }, void>({
      query: () => '/hello',
    }),
  }),
});

export const { useGetHelloQuery } = apiService;
