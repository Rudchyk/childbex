import Keycloak from 'keycloak-js';

export async function initKeycloak() {
  if (window.keycloak) {
    return window.keycloak;
  }

  const keycloak = new Keycloak({
    url: 'https://auth.rudchyk.tech/',
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
