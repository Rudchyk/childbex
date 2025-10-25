import path from 'path';
import { logger } from './logger.service';
import {
  access,
  readdir,
  readFile,
  mkdir,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'os';
import { packArchive, unpackArchive, unzip } from '../utils';
import {
  brokenImageClusterName,
  clusterByOrientation,
  ClusterResult,
} from './dicom.service';
import { PatientImageCluster } from '../db/models/PatientImageCluster.model';
import { PatientImage } from '../db/models/PatientImage.model';
import { Patient, PatientImageStatus } from '@libs/schemas';

export const IMAGE_RX = /\.(png|jpe?g|webp|gif)$/i;

const { ARCHIVES_ROOT = './archives', UPLOAD_ROOT = './uploads' } = process.env;

export const uploadRoot = path.resolve(UPLOAD_ROOT);

export const archivesRoot = path.resolve(ARCHIVES_ROOT);

export const usePatientAssets = async (patient: Patient, archive: File) => {
  logger.debug(
    {
      archiveName: archive.name,
      type: archive.type,
      size: archive.size,
      lastModified: archive.lastModified,
    },
    'patient archive'
  );
  const ext = path.extname(archive.name).toLowerCase();
  try {
    await access(archivesRoot);
  } catch {
    await mkdir(archivesRoot, { recursive: true });
  }
  const tmp = path.join(
    tmpdir(),
    process.env.npm_package_name || '',
    'uploads',
    archive.name
  );
  const tmpPath = path.dirname(tmp);
  try {
    await access(tmpPath);
  } catch (error) {
    await mkdir(tmpPath, { recursive: true });
  }
  // const archiveFile = path.join(ARCHIVES_ROOT, slug + ext);
  await writeFile(tmp, Buffer.from(await archive.arrayBuffer()));
  const { slug, id: patientId } = patient;
  const destDir = path.join(uploadRoot, slug);
  await mkdir(destDir, { recursive: true });
  switch (ext) {
    case '.zip':
      await unzip(tmp, destDir);
      break;
    default:
      await unpackArchive(tmp, destDir); // .tgz / .tar
      break;
  }
  await unlink(tmp);
  await packArchive(destDir, path.join(archivesRoot, slug + '.tgz'));
  const imagesList = await readdir(destDir);
  const inputFiles = imagesList.map((f) => path.join(destDir, f));
  const result = clusterByOrientation(inputFiles);

  for (const [key, value] of Object.entries(result)) {
    const isBrocken = key === brokenImageClusterName;
    if (value && Array.isArray(value) && value) {
      if (isBrocken) {
        const imageCluster = await PatientImageCluster.create({
          name: key,
          cluster: -1,
          patientId,
          notes: '',
        });
        await PatientImage.bulkCreate(
          value.map(({ reason, file }: ClusterResult['broken'][0]) => {
            const parsedFile = path.parse(file);
            return {
              source: `/uploads/${slug}/${parsedFile.name}`,
              notes: reason,
              clusterId: imageCluster.id,
              isBrocken: true,
              group: -1,
              status: PatientImageStatus.BROKEN,
            };
          })
        );
      } else {
        for (const {
          id,
          group,
          files,
          geometry,
          outliers,
          normal,
          studyDate,
        } of value as ClusterResult['clusters']) {
          const imageCluster = await PatientImageCluster.create({
            name: group || String(id),
            cluster: id,
            patientId,
            studyDate: studyDate ? studyDate.toISOString() : null,
            notes: '',
          });
          await PatientImage.bulkCreate(
            files.map(({ file }) => {
              const parsedFile = path.parse(file);
              return {
                source: `/uploads/${slug}/${parsedFile.name}`,
                clusterId: imageCluster.id,
                details: {
                  geometry,
                  outliers,
                  normal,
                },
              };
            })
          );
        }
      }
    }
  }
};
