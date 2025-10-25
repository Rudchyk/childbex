import { SecuritiesKeysEnum } from './SecuritiesKeysEnum';

export const getKeycloakSecurity = (roles?: [string]) => ({
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK]: roles ?? [],
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: roles ?? [],
    },
  ],
});
