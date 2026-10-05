# ChildBEx production operations

This directory contains repository-owned production runtime and deployment definitions.

## Runtime services

- `childbex-app.service` — Node.js application.
- `childbex-ml.service` — Python/FastAPI ML service.

The services are deliberately independent. App deployment must not restart ML, and ML deployment must not restart the app.

## Release layout

Application:

```text
/srv/childbex/releases/<git-sha>/
/var/www/childbex/app -> /srv/childbex/releases/<git-sha>
```

ML service:

```text
/srv/childbex/ml-releases/<git-sha>/
/srv/childbex/ml-current -> /srv/childbex/ml-releases/<git-sha>
```

Persistent medical data and model files must remain outside disposable code releases.

## Build runtime

Server-side application builds use the isolated build runtime:

- Node 24.5.0
- npm 11.10.1
- `NX_DAEMON=false`
- `NX_SKIP_NATIVE_FILE_CACHE=true`

The latter is required because Nx 21.6.3 native-file caching was confirmed to hang on the production host.

Production application runtime remains the system Node runtime used by `childbex-app.service`.

ML releases use the isolated Python 3.13 runtime managed under `/opt/childbex-ml`.

## Deploy commands

After installing the operational files:

```bash
sudo /usr/local/sbin/childbex-app-deploy
sudo /usr/local/sbin/childbex-ml-deploy
```

Each command:

1. fetches `origin/main`;
2. resolves the target commit SHA;
3. prepares a versioned release;
4. atomically switches the active symlink;
5. restarts only its own systemd service;
6. performs a local health check;
7. rolls back to the previous release on activation failure;
8. re-fetches `origin/main` and reports whether production is still current.

## Install/update operational files

```bash
sudo bash ops/install/install-production-deploy.sh
```

The installer updates deploy scripts and systemd unit definitions but does not trigger a deployment.

## Secrets and persistent data

Do not commit:

- `/srv/secrets/childbex/app/.env`
- database credentials
- Keycloak secrets
- backup credentials
- model artifacts containing sensitive or large binary data

Application releases link the existing production environment file from `/srv/secrets/childbex/app/.env`.

Model artifacts belong under `/srv/data/childbex/models` (or another explicitly managed persistent model path), not inside disposable code releases.


## GitHub Actions production deploy

Production deployment is exposed through the manual-only workflow:

```text
.github/workflows/production-deploy.yml
```

The workflow uses `workflow_dispatch` and requires an explicit target selection:

- `app`
- `ml`

It intentionally does **not** deploy automatically on pushes to `main` yet.

The GitHub `production` environment must provide these secrets:

- `CHILDBEX_PROD_SSH_HOST`
- `CHILDBEX_PROD_SSH_PORT`
- `CHILDBEX_PROD_SSH_USER`
- `CHILDBEX_PROD_SSH_PRIVATE_KEY`
- `CHILDBEX_PROD_SSH_KNOWN_HOSTS`

The SSH account should be a dedicated deployment identity with passwordless sudo restricted to the two repository-owned deploy entry points:

```text
/usr/local/sbin/childbex-app-deploy
/usr/local/sbin/childbex-ml-deploy
```

Do not place production application secrets or model data in GitHub Actions.
