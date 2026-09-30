import { HTTPError } from 'fets';
import { router } from '../apiRouter';
import { defaultResponses, unauthorizedResponse } from '../schemas/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';

/**
 * The removed cluster API (migration 202610010000-drop-patient-image-
 * clusters): 410 Gone with guidance. There is no redirect: a cluster could
 * hold images of several DICOM Series, so no Series can be named for it.
 */
const legacyClusterRoutes = [
  ['GET', '/patients/slug/{slug}/clusters/cluster/{cluster}'],
  ['PATCH', '/patients/clusters/{id}'],
  ['DELETE', '/patients/clusters/{id}'],
  ['POST', '/patients/clusters/{id}/review/finish'],
] as const;

export const clustersRemovedError = () =>
  new HTTPError(
    410,
    'Gone',
    {},
    {
      code: 'CLUSTERS_REMOVED',
      message:
        'Image clusters were replaced by DICOM Studies and Series: use ' +
        'GET /patients/{patientId}/studies, ' +
        'GET /patients/{patientId}/studies/{studyId}/series and ' +
        'GET /patients/{patientId}/series/{seriesId}.',
    }
  );

for (const [method, path] of legacyClusterRoutes) {
  router.route({
    description: 'Removed (image clusters were replaced by Studies/Series): 410 Gone',
    method,
    path: path.replace(/\{(\w+)\}/g, ':$1'),
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      responses: {
        410: { description: 'Gone: CLUSTERS_REMOVED' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    handler() {
      throw clustersRemovedError();
    },
  });
}
