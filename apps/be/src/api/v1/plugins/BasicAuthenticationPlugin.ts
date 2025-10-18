import { HTTPError, RouterPlugin } from 'fets';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';
import { security as securityService } from '../../../services/security.service';
import {
  basicAuthCredentials,
  parseBasicAuthAuthorization,
} from '../../../validators';

export const BasicAuthenticationPlugin: RouterPlugin<unknown, any> = {
  onRouteHandle({ route, request }) {
    const isBasicAuth = route.security?.find(
      (securityDef) => securityDef[SecuritiesKeysEnum.BASIC_AUTH]
    );
    if (isBasicAuth) {
      const authHeader =
        request.headers.get('authorization') ||
        request.headers.get('Authorization');
      if (!authHeader) {
        throw new HTTPError(
          401,
          'Unauthorized',
          {
            'WWW-Authenticate': 'Basic realm="Authorization Required"',
          },
          {
            message: 'Authorization Required',
          }
        );
      }
      const [login, password] = parseBasicAuthAuthorization(authHeader);

      if (
        login !== basicAuthCredentials[0] ||
        password !== basicAuthCredentials[1]
      ) {
        throw new HTTPError(
          401,
          'Unauthorized',
          {
            'WWW-Authenticate': 'Basic realm="Authorization Required"',
          },
          {
            message: 'Access Denied (incorrect credentials)',
          }
        );
      }
    }
  },
};
