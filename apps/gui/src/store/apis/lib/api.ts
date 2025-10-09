import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  createApi,
  fetchBaseQuery,
} from '@reduxjs/toolkit/query/react';
import { apiRoutes } from '@libs/constants';
import { NameOptionalProperty } from '@libs/schemas';

export enum TagTypesEnum {
  DATA = 'data',
}

const baseQuery = fetchBaseQuery({
  baseUrl: apiBaseUrl,
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
    getTDAStoredData: builder.mutation<
      TDAStoreData,
      { [SERVICE_ID_KEY]: string; begin: string; end: string }
    >({
      query: ({ serviceId, ...params }) => ({
        url: generateOpenapiPath(routesMapping.api.tda.store, { serviceId }),
        method: 'GET',
        params,
      }),
      invalidatesTags: [TagTypesEnum.TDA],
    }),
    updateTDAStoredDataItem: builder.mutation<
      void,
      { [SERVICE_ID_KEY]: string; [ID_KEY]: string } & Record<string, unknown>
    >({
      query: ({ serviceId, id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.tda.storeItem, {
          serviceId,
          id,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.TDA],
    }),
    createFundSnapshotAsset: builder.mutation<
      void,
      IdProperty & FundSnapshotAssetBase
    >({
      query: ({ id, ...body }) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.snapshots.snapshotAssets.root,
          { id }
        ),
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_SNAPSHOTS, TagTypesEnum.FUNDS],
    }),
    updateFundSnapshotAsset: builder.mutation<
      void,
      FundSnapshotAssetPathParams & UpdateFundSnapshotAssetRequestBody
    >({
      query: ({ snapshot_asset_id, ...body }) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.snapshots.snapshotAssets.asset,
          { snapshot_asset_id }
        ),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_SNAPSHOTS, TagTypesEnum.FUNDS],
    }),
    deleteFundSnapshotAsset: builder.mutation<
      void,
      FundSnapshotAssetPathParams
    >({
      query: ({ snapshot_asset_id }) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.snapshots.snapshotAssets.asset,
          { snapshot_asset_id }
        ),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_SNAPSHOTS, TagTypesEnum.FUNDS],
    }),
    getChainsList: builder.query<ChainsList, void>({
      query: () => routesMapping.api.chains.root,
      providesTags: [TagTypesEnum.CHAINS],
    }),
    getChainsBalances: builder.mutation<ChainsBalances, GetChainsBalancesProps>(
      {
        query: ({ body, ...params }) => ({
          url: routesMapping.api.chains.balances,
          params,
          method: 'POST',
          body,
        }),
        invalidatesTags: [TagTypesEnum.CHAINS],
      }
    ),
    getChainsWallets: builder.query<ChainsWallets, void>({
      query: () => routesMapping.api.chains.wallets,
      providesTags: [TagTypesEnum.CHAINS_WALLETS],
    }),
    createChainWallet: builder.mutation<void, ChainWalletBase>({
      query: (body) => ({
        url: routesMapping.api.chains.wallets,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.CHAINS_WALLETS],
    }),
    updateChainWallet: builder.mutation<
      void,
      IdProperty & UpdateChainWalletRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.chains.wallet, { id }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.CHAINS_WALLETS],
    }),
    deleteChainWallet: builder.mutation<void, IdProperty>({
      query: (params) => ({
        url: generateOpenapiPath(routesMapping.api.chains.wallet, params),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.CHAINS_WALLETS],
    }),
    getFundsStatistic: builder.mutation<FundsStatisticResponse, Interval>({
      query: (params) => ({
        url: routesMapping.api.funds.statistic.root,
        method: 'GET',
        params,
      }),
    }),
    getFundsSnapshots: builder.query<FundsSnapshot[], void>({
      query: () => routesMapping.api.funds.snapshots.root,
      providesTags: [TagTypesEnum.FUNDS_SNAPSHOTS],
    }),
    updateFundSnapshot: builder.mutation<
      void,
      IdProperty & UpdateFundSnapshotRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.snapshots.snapshot, {
          id,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_SNAPSHOTS, TagTypesEnum.FUNDS],
    }),
    getFundsExchanges: builder.query<ExtendedFundExchanges, void>({
      query: () => routesMapping.api.funds.exchanges.root,
      providesTags: [TagTypesEnum.FUNDS_EXCHANGES],
    }),
    addFundExchange: builder.mutation<void, AddFundExchangeRequestBody>({
      query: (body) => ({
        url: routesMapping.api.funds.exchanges.root,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
    }),
    deleteFundExchange: builder.mutation<void, EcnProperty>({
      query: (params) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.exchanges.exchange,
          params
        ),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
    }),
    updateFundExchange: builder.mutation<
      void,
      EcnProperty & UpdateFundExchangeRequestBody
    >({
      query: ({ ecn, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.exchanges.exchange, {
          ecn,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
    }),
    addFundExchangeFund: builder.mutation<void, AddFundExchangeFundRequestBody>(
      {
        query: (body) => ({
          url: routesMapping.api.funds.exchanges.funds,
          method: 'POST',
          body,
        }),
        invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
      }
    ),
    deleteFundExchangeFund: builder.mutation<void, FundExchangeFundPathParams>({
      query: (params) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.exchanges.fund,
          params
        ),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
    }),
    updateFundExchangeFund: builder.mutation<
      void,
      FundExchangeFundPathParams & UpdateFundExchangeFundRequestBody
    >({
      query: ({ ecn, fund_id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.exchanges.fund, {
          ecn,
          fund_id,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_EXCHANGES, TagTypesEnum.FUNDS],
    }),
    getFunds: builder.mutation<FundsResponse, void>({
      query: () => ({
        url: routesMapping.api.funds.root,
        method: 'GET',
      }),
    }),
    getHistoricFunds: builder.mutation<FundsResponse, DateProperty>({
      query: (params) => ({
        url: routesMapping.api.funds.historic.root,
        method: 'GET',
        params,
      }),
    }),
    getFundsAccounts: builder.query<FundsAccounts, void>({
      query: () => routesMapping.api.funds.accounts.root,
      providesTags: [TagTypesEnum.FUNDS_ACCOUNTS],
    }),
    addFundAccount: builder.mutation<void, AddFundAccountRequestBody>({
      query: (body) => ({
        url: routesMapping.api.funds.accounts.root,
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    deleteFundAccount: builder.mutation<void, IdProperty>({
      query: (params) => ({
        url: generateOpenapiPath(
          routesMapping.api.funds.accounts.account,
          params
        ),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    updateFundAccount: builder.mutation<
      void,
      IdProperty & UpdateFundAccountRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.accounts.account, {
          id,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    addFundAccountFund: builder.mutation<
      void,
      IdProperty & AddFundAccountFundRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.accounts.funds, {
          id,
        }),
        method: 'POST',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    deleteFundAccountFund: builder.mutation<void, FundAccountFundPathParams>({
      query: (params) => ({
        url: generateOpenapiPath(routesMapping.api.funds.accounts.fund, params),
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    updateFundAccountFund: builder.mutation<
      void,
      FundAccountFundPathParams & UpdateFundAccountFundRequestBody
    >({
      query: ({ id, fund_id, ...body }) => ({
        url: generateOpenapiPath(routesMapping.api.funds.accounts.fund, {
          id,
          fund_id,
        }),
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.FUNDS_ACCOUNTS, TagTypesEnum.FUNDS],
    }),
    getSecurity: builder.query<Security, void>({
      query: () => routesMapping.api.security.root,
    }),
    getLoans: builder.query<Loans, void>({
      query: () => routesMapping.api.loans.root,
    }),
    getConfig: builder.query<Config, void>({
      query: () => routesMapping.api.config.root,
      providesTags: [TagTypesEnum.CONFIG],
    }),
    getTradingAssets: builder.query<TradingAssets, void>({
      query: () => routesMapping.api['trading-assets'],
      providesTags: [TagTypesEnum.TRADING_ASSETS],
    }),
    getAccounts: builder.query<GetAccountsResponse, void>({
      query: () => routesMapping.api.accounts.root,
      providesTags: [TagTypesEnum.ACCOUNTS],
    }),
    getExchanges: builder.query<string[], void>({
      query: () => routesMapping.api.exchanges,
    }),
    updateAccounts: builder.mutation<void, UpdateAccountsRequestBody>({
      query: (body) => ({
        url: routesMapping.api.accounts.root,
        method: 'PUT',
        body,
      }),
      invalidatesTags: [
        TagTypesEnum.ACCOUNTS,
        TagTypesEnum.IGNORED_ACCOUNTS,
        TagTypesEnum.ASSETS_PLATFORMS,
      ],
    }),
    updateAccount: builder.mutation<
      void,
      IdProperty & UpdateAccountsRequestBodyItem
    >({
      query: ({ id, ...body }) => ({
        url: routesMapping.api.accounts.account,
        method: 'PUT',
        body,
        params: { id },
      }),
      invalidatesTags: [
        TagTypesEnum.ACCOUNTS,
        TagTypesEnum.IGNORED_ACCOUNTS,
        TagTypesEnum.ASSETS_PLATFORMS,
      ],
    }),
    deleteAllAccounts: builder.mutation<void, void>({
      query: () => ({
        url: routesMapping.api.accounts.root,
        method: 'DELETE',
      }),
      invalidatesTags: [
        TagTypesEnum.ACCOUNTS,
        TagTypesEnum.IGNORED_ACCOUNTS,
        TagTypesEnum.ASSETS_PLATFORMS,
      ],
    }),
    deleteAccount: builder.mutation<void, DeleteAccountParams>({
      query: (params) => ({
        url: routesMapping.api.accounts.account,
        method: 'DELETE',
        params,
      }),
      invalidatesTags: [
        TagTypesEnum.ACCOUNTS,
        TagTypesEnum.IGNORED_ACCOUNTS,
        TagTypesEnum.ASSETS_PLATFORMS,
      ],
    }),
    getIgnoredAccounts: builder.query<GetIgnoredAccountsResponse, void>({
      query: () => routesMapping.api.ignoredAccounts.root,
      providesTags: [TagTypesEnum.IGNORED_ACCOUNTS],
    }),
    updateIgnoredAccounts: builder.mutation<
      void,
      UpdateIgnoredAccountsRequestBody
    >({
      query: (body) => ({
        url: routesMapping.api.ignoredAccounts.root,
        method: 'PUT',
        body,
      }),
      invalidatesTags: [TagTypesEnum.IGNORED_ACCOUNTS, TagTypesEnum.ACCOUNTS],
    }),
    updateIgnoredAccount: builder.mutation<
      void,
      IdProperty & UpdateIgnoredAccountsRequestBodyItem
    >({
      query: ({ id, ...body }) => ({
        url: routesMapping.api.ignoredAccounts.account,
        method: 'PUT',
        body,
        params: { id },
      }),
      invalidatesTags: [TagTypesEnum.IGNORED_ACCOUNTS, TagTypesEnum.ACCOUNTS],
    }),
    deleteAllIgnoredAccounts: builder.mutation<void, void>({
      query: () => ({
        url: routesMapping.api.ignoredAccounts.root,
        method: 'DELETE',
      }),
      invalidatesTags: [TagTypesEnum.IGNORED_ACCOUNTS, TagTypesEnum.ACCOUNTS],
    }),
    deleteIgnoredAccount: builder.mutation<void, DeleteAccountParams>({
      query: (params) => ({
        url: routesMapping.api.ignoredAccounts.account,
        method: 'DELETE',
        params,
      }),
      invalidatesTags: [TagTypesEnum.IGNORED_ACCOUNTS, TagTypesEnum.ACCOUNTS],
    }),
    getBalances: builder.mutation<Balances, GetBalancesParams>({
      query: (params) => ({
        url: routesMapping.api.balances.root,
        method: 'GET',
        params,
      }),
    }),
    getRecentBalances: builder.mutation<EcnBalances, void>({
      query: () => ({
        url: routesMapping.api.balances.recent,
        method: 'GET',
      }),
      invalidatesTags: [TagTypesEnum.TRADING_ASSETS, TagTypesEnum.TRES_WALLETS],
    }),
    useBalancesPlayground: builder.mutation<any, UseBalancesPlaygroundParams>({
      query: (params) => ({
        url: routesMapping.api.balances.playground,
        method: 'GET',
        params,
      }),
    }),
    getPnL: builder.mutation<GetPnlResponse, GetPnLQueryParams>({
      query: (params) => ({
        url: routesMapping.api.pnl,
        method: 'GET',
        params,
      }),
    }),
    getAssetsPlatforms: builder.query<AssetsPlatforms, void>({
      query: () => routesMapping.api['assets-platforms'],
      providesTags: [TagTypesEnum.ASSETS_PLATFORMS],
    }),
    updateAssetsPlatforms: builder.mutation<
      void,
      UpdateAssetsPlatformsRequestBody
    >({
      query: (body) => ({
        url: routesMapping.api['assets-platforms'],
        method: 'PATCH',
        body,
      }),
      invalidatesTags: [TagTypesEnum.ASSETS_PLATFORMS],
    }),
    getExchangeRates: builder.mutation<Prices, ExchangeRatesRequestBody>({
      query: (body) => ({
        url: routesMapping.api.exchangeRates.root,
        method: 'POST',
        body,
      }),
    }),
    getExchangeRate: builder.mutation<Price, GetExchangeRateParams>({
      query: (params) => ({
        url: generateOpenapiPath(
          routesMapping.api.exchangeRates.exchangeRate,
          params as any
        ),
        method: 'GET',
      }),
    }),
  }),
});

export const {
  useGetSecurityQuery,
  useGetBalancesMutation,
  useGetTradingAssetsQuery,
  useGetAssetsPlatformsQuery,
  useUpdateAssetsPlatformsMutation,
  useUseBalancesPlaygroundMutation,
  useGetConfigQuery,
  useGetPnLMutation,
  useGetAccountsQuery,
  useUpdateAccountsMutation,
  useDeleteAccountMutation,
  useGetRecentBalancesMutation,
  useDeleteAllAccountsMutation,
  useGetExchangesQuery,
  useDeleteAllIgnoredAccountsMutation,
  useDeleteIgnoredAccountMutation,
  useUpdateIgnoredAccountsMutation,
  useGetIgnoredAccountsQuery,
  useUpdateAccountMutation,
  useUpdateIgnoredAccountMutation,
  useGetLoansQuery,
  useGetExchangeRateMutation,
  useGetExchangeRatesMutation,
  useAddFundAccountMutation,
  useDeleteFundAccountMutation,
  useGetFundsAccountsQuery,
  useUpdateFundAccountMutation,
  useAddFundAccountFundMutation,
  useDeleteFundAccountFundMutation,
  useUpdateFundAccountFundMutation,
  useGetFundsMutation,
  useAddFundExchangeMutation,
  useDeleteFundExchangeMutation,
  useUpdateFundExchangeMutation,
  useGetFundsExchangesQuery,
  useGetHistoricFundsMutation,
  useAddFundExchangeFundMutation,
  useDeleteFundExchangeFundMutation,
  useUpdateFundExchangeFundMutation,
  useUpdateFundSnapshotMutation,
  useGetFundsSnapshotsQuery,
  useGetFundsStatisticMutation,
  useGetChainsListQuery,
  useGetChainsBalancesMutation,
  useGetChainsWalletsQuery,
  useCreateChainWalletMutation,
  useDeleteChainWalletMutation,
  useUpdateChainWalletMutation,
  useUpdateFundSnapshotAssetMutation,
  useDeleteFundSnapshotAssetMutation,
  useCreateFundSnapshotAssetMutation,
  useGetTDAStoredDataMutation,
  useUpdateTDAStoredDataItemMutation,
} = api;
