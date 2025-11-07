import path from 'path';
import { logger } from './logger.service';
import { readdir, mkdir, writeFile, unlink, constants } from 'node:fs/promises';
import { tmpdir } from 'os';
import fs from 'fs';
import { unpackArchive, unzip } from '../utils';
import {
  brokenImageClusterName,
  clusterByOrientation,
  ClusterResult,
} from './dicom.service';
import { PatientImagesCluster } from '../db/models/PatientImagesCluster.model';
import { PatientImage } from '../db/models/PatientImage.model';
import { Patient, PatientImageStatus } from '@libs/schemas';
import { format } from 'date-fns';
import { brotliCompressFolder } from '../utils/lib/compress-folder';

export const IMAGE_RX = /\.(png|jpe?g|webp|gif)$/i;

const { ARCHIVES_ROOT = './archives', UPLOAD_ROOT = './uploads' } = process.env;

export const uploadRoot = path.resolve(UPLOAD_ROOT);

export const archivesRoot = path.resolve(ARCHIVES_ROOT);

const moveFile = (destDir: string, folder: string, name: string) => {
  const originPath = path.join(destDir, name);
  const destPath = path.join(folder, name);
  fs.rename(originPath, destPath, (err) => {
    if (err) {
      logger.error(err, 'rename');
      if (err.code === 'EXDEV') {
        // Cross-device: copy then delete
        fs.copyFile(originPath, destPath, constants.COPYFILE_EXCL, (err) => {
          if (err) {
            logger.error(err, 'copyFile');
          }
          fs.unlink(originPath, (err) => {
            if (err) {
              logger.error(err, 'unlink');
            }
          });
        });
      } else if (err.code === 'EEXIST') {
        fs.unlink(destPath, (err) => {
          if (err) {
            logger.error(err, 'unlink');
          }
          fs.rename(originPath, destPath, (err) => {
            if (err) {
              logger.error(err, 'rename');
            }
          });
        });
      } else {
        logger.error(err, 'unlink');
      }
    }
  });
};

export const usePatientAssets = async (patient: Patient, archive: File) => {
  logger.debug(
    {
      uploadRoot,
      archivesRoot,
      archiveName: archive.name,
      type: archive.type,
      size: archive.size,
      lastModified: archive.lastModified,
    },
    'patient archive'
  );
  const { id: patientId } = patient;
  const ext = path.extname(archive.name).toLowerCase();
  await mkdir(archivesRoot, { recursive: true });
  const tmp = path.join(tmpdir(), 'childbex', 'uploads', archive.name);
  const tmpPath = path.dirname(tmp);
  await mkdir(tmpPath, { recursive: true });
  await writeFile(tmp, Buffer.from(await archive.arrayBuffer()));
  const destDir = path.join(uploadRoot, patientId);
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
  const archiveName = [format(new Date(), 'yyyyMMddHHmmss'), patientId].join(
    '-'
  );
  await brotliCompressFolder(
    destDir,
    path.join(archivesRoot, archiveName + '.br')
  );

  const imagesList = await readdir(destDir);
  const inputFiles = imagesList.map((f) => path.join(destDir, f));
  const result = clusterByOrientation(inputFiles);

  for (const [key, value] of Object.entries(result)) {
    const isBrocken = key === brokenImageClusterName;
    if (value && Array.isArray(value) && value) {
      if (isBrocken) {
        const imageCluster = await PatientImagesCluster.create({
          name: key,
          cluster: -1,
          patientId,
          notes: '',
        });

        const folder = path.join(destDir, imageCluster.id);
        await mkdir(folder, { recursive: true });
        await PatientImage.bulkCreate(
          value.map(({ reason, file }: ClusterResult['broken'][0]) => {
            const parsedFile = path.parse(file);
            moveFile(destDir, folder, parsedFile.name);
            return {
              source: `/uploads/${patientId}/${imageCluster.id}/${parsedFile.name}`,
              notes: reason,
              clusterId: imageCluster.id,
              isBrocken: true,
              group: -1,
              status: PatientImageStatus.BROKEN,
            };
          }),
          { ignoreDuplicates: true }
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
          const imageCluster = await PatientImagesCluster.create({
            name: group || String(id),
            cluster: id,
            patientId,
            studyDate: studyDate ? studyDate.toISOString() : null,
            notes: '',
          });
          const folder = path.join(destDir, imageCluster.id);
          await mkdir(folder, { recursive: true });
          await PatientImage.bulkCreate(
            files.map(({ file }) => {
              const parsedFile = path.parse(file);
              moveFile(destDir, folder, parsedFile.name);
              return {
                source: `/uploads/${patientId}/${imageCluster.id}/${parsedFile.name}`,
                clusterId: imageCluster.id,
                details: {
                  geometry,
                  outliers,
                  normal,
                },
              };
            }),
            {
              ignoreDuplicates: true,
            }
          );
        }
      }
    }
  }
};
