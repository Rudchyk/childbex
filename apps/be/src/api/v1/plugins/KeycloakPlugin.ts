import { HTTPError, RouterPlugin } from 'fets';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';
import { security as securityService } from '../../../services/security.service';
import {
  basicAuthCredentials,
  parseBasicAuthAuthorization,
} from '../../../validators';

export const KeycloakPlugin: RouterPlugin<unknown, any> = {
  onRouterInit(props) {
    console.log('Keycloak plugin initialized');
  },
  onRoute(props) {
    const route = props.route.path;
    const method = props.route.method?.toLowerCase();
    if (method) {
      const spec = props.openAPIDocument.paths?.[route]?.[method];
      if (spec) {
        const security = spec.security;
        const isAuth = security?.find(
          (securityDef) => securityDef[SecuritiesKeysEnum.KEYCLOAK]
        );
        // if (isAuth) {
        // }
      }
    }

    return props;
  },
  onRouteHandle({ route, request }) {
    const isKeycloak = route.security?.find(
      (securityDef) => securityDef[SecuritiesKeysEnum.KEYCLOAK]
    );
    if (isKeycloak) {
      securityService?.keycloak.protect();
    }
  },
};
