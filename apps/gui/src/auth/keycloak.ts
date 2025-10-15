import Keycloak from 'keycloak-js';

export async function initKeycloak() {
  if (window.keycloak) {
    return window.keycloak;
  }

  const keycloak = new Keycloak({
    url: 'https://rudchyk.pp.ua:8443',
    realm: 'dev-childbex',
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
