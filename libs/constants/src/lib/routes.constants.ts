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
  /** DICOM file of a patient image (authenticated; `id` is the patient id). */
  patientImageFile: '/patients/:id/images/:imageId/file',
  /** Admin resolution of an image (PUT / DELETE). */
  patientImageReviewResolution: '/patients/images/:id/review/resolution',
  patientImagesReviewsVotes: '/patients/images/:id/review-votes',
  patientImageReviewVote: '/patients/images/:id/review-votes/:voteId',
};

/** Patient -> Study -> Series (the GUI's hierarchy; ids, never DICOM UIDs). */
const hierarchy = {
  patientStudies: '/patients/:patientId/studies',
  patientStudySeries: '/patients/:patientId/studies/:studyId/series',
  patientSeries: '/patients/:patientId/series/:seriesId',
  /**
   * Complete review of a Series by the current reviewer: every presented
   * image without the reviewer's vote is the reviewer's implicit NORMAL.
   */
  patientSeriesCompleteReview: '/patients/:patientId/series/:seriesId/review/complete',
  /** The current reviewer's vote on many images of a Series (atomic). */
  patientSeriesReviewVotes: '/patients/:patientId/series/:seriesId/review/votes',
};

/** ML dataset snapshots (dashboard:admin). */
const datasetSnapshots = {
  datasetSnapshots: '/dataset-snapshots',
  datasetSnapshot: '/dataset-snapshots/:id',
  datasetSnapshotPreview: '/dataset-snapshots/:id/preview',
  datasetSnapshotFinalize: '/dataset-snapshots/:id/finalize',
  datasetSnapshotArchive: '/dataset-snapshots/:id/archive',
  datasetSnapshotItems: '/dataset-snapshots/:id/items',
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
  ...hierarchy,
  ...review,
  ...datasetSnapshots,
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
  /** Removed cluster page: old bookmarks get a notice (never linked). */
  legacyClusterPage: '/patients/:slug/:cluster',
  patientStudy: '/patients/:patientId/studies/:studyId',
  patientSeries: '/patients/:patientId/studies/:studyId/series/:seriesId',
};
