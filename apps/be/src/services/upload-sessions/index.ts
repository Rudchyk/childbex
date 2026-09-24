import { Patient } from '../../db/models/Patient.model';
import { importPatientArchiveFile, uploadRoot } from '../patients.service';
import { readUploadSessionConfig } from './upload-session.config';
import { UploadSessionService } from './upload-session.service';

export * from './upload-session.errors';
export { UploadSessionService } from './upload-session.service';

/** Application-wide upload session service (single backend instance). */
export const uploadSessionService = new UploadSessionService(
  readUploadSessionConfig(),
  {
    importArchive: importPatientArchiveFile,
    patientExists: async (patientId) =>
      !!(await Patient.findByPk(patientId, { attributes: ['id'] })),
    publicRoots: [uploadRoot],
  }
);
