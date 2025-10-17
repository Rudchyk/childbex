import { HTTPError, RouterPlugin, Type } from 'fets';

export const BasicAuthenticationPlugin: RouterPlugin<any, any> = {
  onRouteHandle({ route, request }) {
    // if (
    //   route.security?.find(securityDef => securityDef['myExampleAuth']) &&
    //   request.headers.get('authorization') !== `Bearer ${TOKEN}`
    // ) {
    //   throw new HTTPError(
    //     401,
    //     'Unauthorized',
    //     {},
    //     {
    //       message: 'Invalid bearer token',
    //     },
    //   );
    // }
  },
};
