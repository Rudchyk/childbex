export const apiRoute = '/api/v1';

export const apiDocRoute = '/docs';

export const apiRoutes = {
  securityConfig: '/security/config',
  securityVerify: '/security/verify',
  patients: '/patients',
  trashedPatients: '/patients/trash',
  patient: '/patient',
  trashedPatient: '/patient/trash/:id',
  patientById: '/patient/:id',
  patientBySlug: '/patient/:slug',
  patientUpload: '/patient/:id/upload',
  patientAsset: '/patient/asset/:id',
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
};
