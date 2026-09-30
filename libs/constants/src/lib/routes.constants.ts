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
  patientUploadSessions: '/patients/:id/upload-sessions',
  patientImagesCluster: '/patients/clusters/:id',
  patientSlugImagesClustersCluster:
    '/patients/slug/:slug/clusters/cluster/:cluster',
  /** DICOM file of a patient image (authenticated; `id` is the patient id). */
  patientImageFile: '/patients/:id/images/:imageId/file',
  /** Admin resolution of an image (PUT / DELETE). */
  patientImageReviewResolution: '/patients/images/:id/review/resolution',
  /** Finish review of a cluster (completes untouched images as NORMAL). */
  patientImagesClusterFinishReview: '/patients/clusters/:id/review/finish',
  patientImagesReviewsVotes: '/patients/images/:id/review-votes',
  patientImageReviewVote: '/patients/images/:id/review-votes/:voteId',
};

const review = {
  /** Global review freeze: GET state, POST freeze. */
  reviewFreeze: '/review/freeze',
  reviewUnfreeze: '/review/unfreeze',
};

const uploadSessions = {
  uploadSessions: '/upload-sessions',
  uploadSession: '/upload-sessions/:uploadId',
  uploadSessionChunk: '/upload-sessions/:uploadId/chunks/:index',
  uploadSessionComplete: '/upload-sessions/:uploadId/complete',
};

export const apiRoutes = {
  ...security,
  ...patients,
  ...review,
  ...uploadSessions,
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
  llm: '/llm',
  contacts: '/contacts',
  cookies: '/cookies',
  dashboard: '/dashboard',
  dwv: '/dwv',
  patients: '/patients',
  patient: '/patients/:slug',
  patientImagesCluster: '/patients/:slug/:cluster',
};
