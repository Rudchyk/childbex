export const apiRoute = '/api/v1';

export const apiDocRoute = '/docs';

export const apiRoutes = {
  securityConfig: '/security/config',
  securityVerify: '/security/verify',
  patients: '/patients',
  patient: '/patients/:id',
  patientBySlug: '/patients/:slug',
  patientUpload: '/patients/:id/upload',
  trashedPatients: '/patients/trash',
  trashedPatient: '/patients/trash/:id',
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
};
