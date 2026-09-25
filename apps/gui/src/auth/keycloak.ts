import Keycloak from 'keycloak-js';

let initPromise: Promise<Keycloak> | undefined;

/**
 * Initialises keycloak-js once. The promise is shared so concurrent callers
 * (e.g. React StrictMode running effects twice) never create two instances
 * with separate tokens and refresh timers.
 */
export function initKeycloak(): Promise<Keycloak> {
  if (window.keycloak) {
    return Promise.resolve(window.keycloak);
  }
  initPromise ??= createKeycloak().catch((error) => {
    initPromise = undefined;
    throw error;
  });
  return initPromise;
}

async function createKeycloak() {
  const keycloak = new Keycloak({
    url: 'https://auth.childbex.com/',
    realm: 'childbex',
    clientId: 'dashboard',
  });

  await keycloak.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
  });

  window.keycloak = keycloak;

  return keycloak;
}
