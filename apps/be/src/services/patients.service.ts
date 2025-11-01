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
import fs from 'fs';
import { packArchive, unpackArchive, unzip } from '../utils';
import {
  brokenImageClusterName,
  clusterByOrientation,
  ClusterResult,
} from './dicom.service';
import { PatientImageCluster } from '../db/models/PatientImageCluster.model';
import { PatientImage } from '../db/models/PatientImage.model';
import { Patient, PatientImageStatus } from '@libs/schemas';
import { format } from 'date-fns';
import { brotliCompressSync, constants, brotliCompress } from 'node:zlib';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-expect-error
import { zstdCompressSync, zstdCompress } from 'node:zlib';
import {
  brotliCompressFolder,
  zstdCompressFolder,
} from '../utils/lib/compress-folder';

export const IMAGE_RX = /\.(png|jpe?g|webp|gif)$/i;

const { ARCHIVES_ROOT = './archives', UPLOAD_ROOT = './uploads' } = process.env;

export const uploadRoot = path.resolve(UPLOAD_ROOT);

export const archivesRoot = path.resolve(ARCHIVES_ROOT);

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
  const ext = path.extname(archive.name).toLowerCase();
  try {
    await access(archivesRoot);
  } catch {
    await mkdir(archivesRoot, { recursive: true });
  }
  const tmp = path.join(tmpdir(), 'childbex', 'uploads', archive.name);
  const tmpPath = path.dirname(tmp);
  try {
    await access(tmpPath);
  } catch (error) {
    await mkdir(tmpPath, { recursive: true });
  }
  await writeFile(tmp, Buffer.from(await archive.arrayBuffer()));
  const { id: patientId } = patient;
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
  await packArchive(destDir, path.join(archivesRoot, archiveName + '.tgz'));
  await brotliCompressFolder(
    destDir,
    path.join(archivesRoot, archiveName + '.br')
  );
  await zstdCompressFolder(
    destDir,
    path.join(archivesRoot, archiveName + '.zst')
  );

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

        const folder = path.join(destDir, imageCluster.id);
        try {
          await access(folder);
        } catch (error) {
          await mkdir(folder, { recursive: true });
        }
        await PatientImage.bulkCreate(
          value.map(({ reason, file }: ClusterResult['broken'][0]) => {
            const parsedFile = path.parse(file);
            const originPath = path.join(destDir, parsedFile.name);
            fs.copyFile(
              originPath,
              path.join(folder, parsedFile.name),
              (err) => {
                if (err) {
                  logger.error(err, 'copyFile');
                }
                fs.unlink(originPath, (err) => {
                  if (err) {
                    logger.error(err, 'unlink');
                  }
                });
              }
            );
            return {
              source: `/uploads/${patientId}/${imageCluster.id}/${parsedFile.name}`,
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
          const folder = path.join(destDir, imageCluster.id);
          try {
            await access(folder);
          } catch (error) {
            await mkdir(folder, { recursive: true });
          }
          await PatientImage.bulkCreate(
            files.map(({ file }) => {
              const parsedFile = path.parse(file);
              const originPath = path.join(destDir, parsedFile.name);
              fs.copyFile(
                originPath,
                path.join(folder, parsedFile.name),
                (err) => {
                  if (err) {
                    logger.error(err, 'copyFile');
                  }
                  fs.unlink(originPath, (err) => {
                    if (err) {
                      logger.error(err, 'unlink');
                    }
                  });
                }
              );
              return {
                source: `/uploads/${patientId}/${imageCluster.id}/${parsedFile.name}`,
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
