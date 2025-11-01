import { Grant } from 'keycloak-connect';
import { SecuritiesKeysEnum } from './SecuritiesKeysEnum';
import { Ctx } from './types';
import { getUnauthorizedError } from './helpers';

export const getKeycloakSecurity = (roles?: [string]) => ({
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK]: roles ?? [],
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: roles ?? [],
    },
  ],
});

export const getSecurityContentFromResponse = (ctx: Ctx) => {
  const context = ctx;
  const grant = context.req.kauth?.grant as Grant;
  const access_token = grant?.access_token;
  const content = access_token?.content;
  if (!content) {
    throw getUnauthorizedError();
  }
  return content;
};
