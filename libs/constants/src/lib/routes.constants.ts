export const apiRoute = '/api/v1';

export const apiDocRoute = '/docs';

export const apiDocFullRoute = apiRoute + apiDocRoute;

const security = {
  securityConfig: '/security/config',
  securityVerify: '/security/verify',
};

const llmService = {
  llmServiceHealth: '/llm/health',
  llmServiceCheckItems: '/llm/check-items',
  llmServiceInference: '/llm/inference',
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
  ...llmService,
};

export const guiRoutes = {
  home: '/',
  about: '/about',
  playground: '/playground',
  brief: '/brief',
  error: '/error',
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
