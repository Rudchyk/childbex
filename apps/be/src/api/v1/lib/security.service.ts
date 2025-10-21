import { SecuritiesKeysEnum } from './SecuritiesKeysEnum';

export const keycloakSecurity = {
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK]: [],
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: [],
    },
  ],
};
