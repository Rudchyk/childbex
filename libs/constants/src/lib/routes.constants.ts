export const apiRoute = '/api/v1';

export const apiDocRoute = '/docs';

const security = {
  securityConfig: '/security/config',
  securityVerify: '/security/verify',
};

const patients = {
  patients: '/patients',
  trashedPatients: '/patients/trash',
  trashedPatient: '/patients/:id/trash',
  patient: '/patients/:id',
  patientSlug: '/patients/slug/:slug',
  patientAssetsUpload: '/patients/:id/upload',
  patientImagesCluster: '/patients/clusters/:id',
  patientSlugImagesClustersCluster:
    '/patients/slug/:slug/clusters/cluster/:cluster',
  patientImagesReviewsVotes: '/patients/images/:id/review-votes',
  patientImageReviewVote: '/patients/images/:id/review-votes/:voteId',
};

export const apiRoutes = {
  ...security,
  ...patients,
};

export const guiRoutes = {
  home: '/',
  about: '/about',
  playground: '/playground',
  brief: '/brief',
  privacy: '/privacy',
  terms: '/terms',
  disclaimer: '/disclaimer',
  compliance: '/compliance',
  contacts: '/contacts',
  cookies: '/cookies',
  dashboard: '/dashboard',
  dwv: '/dwv',
  patients: '/patients',
  patient: '/patients/:slug',
  patientImagesCluster: '/patients/:slug/:cluster',
};
