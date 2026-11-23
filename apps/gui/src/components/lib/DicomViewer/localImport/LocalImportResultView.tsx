import { FC, useMemo } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { formatBytes } from './localImport.files';
import {
  QUIET_SKIP_REASONS,
  skipReasonLabels,
  stackWarningLabels,
  type LocalDicomSeries,
  type LocalImportResult,
  type LocalMediaFile,
  type SkipReason,
} from './localImport.types';

/** Paths listed per skip reason (the counts are always complete). */
const MAX_LISTED_PATHS = 20;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** DICOM DA (`YYYYMMDD`) as `YYYY-MM-DD`. */
const formatStudyDate = (value?: string) =>
  value && /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;

const shortUid = (uid: string) => (uid.length > 24 ? `…${uid.slice(-20)}` : uid);

export type LocalOpenTarget =
  | { kind: 'series'; series: LocalDicomSeries }
  | { kind: 'media'; media: LocalMediaFile };

/** Key of an opened Series or file (`openedKey`). */
export const openTargetKey = (target: LocalOpenTarget) =>
  target.kind === 'series' ? target.series.key : `media:${target.media.path}`;

/**
 * What opens without asking: a single complete stack (or a single picture
 * or video) with nothing to review. Parts of a Series, stacks that may load
 * incompletely, failed archives and skipped files are always shown first.
 */
export const targetToOpenDirectly = (result: LocalImportResult): LocalOpenTarget | undefined => {
  const nothingToReview =
    !result.failedArchives.length &&
    !result.incompleteSources.length &&
    result.skipped.every((s) => QUIET_SKIP_REASONS.includes(s.reason));
  if (!nothingToReview) return undefined;
  const [series] = result.series;
  if (result.series.length === 1 && !result.mediaFiles.length) {
    return !series.part && !series.warnings.length ? { kind: 'series', series } : undefined;
  }
  if (!result.series.length && result.mediaFiles.length === 1) {
    return { kind: 'media', media: result.mediaFiles[0] };
  }
  return undefined;
};

interface LocalImportResultViewProps {
  result: LocalImportResult;
  /** The Series or file last opened in the viewer (`openTargetKey`). */
  openedKey?: string;
  onOpen: (target: LocalOpenTarget) => void;
  onReset: () => void;
}

export const LocalImportResultView: FC<LocalImportResultViewProps> = ({
  result,
  openedKey,
  onOpen,
  onReset,
}) => {
  const seriesCount = useMemo(
    () => new Set(result.series.map((s) => `${s.studyInstanceUid}|${s.seriesInstanceUid}`)).size,
    [result.series]
  );
  const partDifferences = useMemo(
    () => [...new Set(result.series.flatMap((s) => s.part?.differences ?? []))],
    [result.series]
  );
  const hasRepeatedPositions = result.series.some((s) =>
    s.warnings.includes('repeated-positions')
  );
  const missingImages = result.incompleteSources.reduce((total, s) => total + s.count, 0);
  const skippedByReason = useMemo(() => {
    const groups = new Map<SkipReason, string[]>();
    for (const { path, reason } of result.skipped) {
      const paths = groups.get(reason) ?? [];
      paths.push(path);
      groups.set(reason, paths);
    }
    return [...groups.entries()];
  }, [result.skipped]);
  const studies = useMemo(() => {
    const byStudy = new Map<string, LocalDicomSeries[]>();
    for (const series of result.series) {
      const list = byStudy.get(series.studyInstanceUid) ?? [];
      list.push(series);
      byStudy.set(series.studyInstanceUid, list);
    }
    return [...byStudy.values()];
  }, [result.series]);
  const warnings = skippedByReason.filter(([reason]) => !QUIET_SKIP_REASONS.includes(reason));
  const hasUnreadable = result.skipped.some((s) => s.reason === 'unreadable');

  return (
    <Stack spacing={2} sx={{ width: '100%' }} data-testid="local-import-result">
      <Typography variant="body2" role="status">
        {plural(result.fileCount, 'file')} checked: {plural(result.instanceCount, 'DICOM image')} in{' '}
        {plural(seriesCount, 'Series', 'Series')} ({plural(studies.length, 'Study', 'Studies')}),{' '}
        {!!result.mediaFiles.length &&
          `${plural(result.mediaFiles.length, 'other picture or video', 'other pictures or videos')}, `}
        {result.skipped.length.toLocaleString('en-US')} skipped.
      </Typography>

      {!result.series.length && !result.mediaFiles.length && (
        <Alert severity="error">
          No DICOM images that can be displayed were found. Choose a folder or an archive that
          contains DICOM image files.
        </Alert>
      )}

      {result.failedArchives.map((archive) => (
        <Alert severity="error" key={archive.path}>
          <AlertTitle>{archive.path} could not be opened</AlertTitle>
          {archive.message}
        </Alert>
      ))}

      {result.usedDropFallback && hasUnreadable && (
        <Alert severity="info">
          This browser cannot read dropped folders. Use <strong>Choose folder</strong> instead.
        </Alert>
      )}

      {!!skippedByReason.length && (
        <Alert severity={warnings.length ? 'warning' : 'info'}>
          <AlertTitle>{plural(result.skipped.length, 'file')} skipped</AlertTitle>
          {skippedByReason.map(([reason, paths]) => (
            <Box component="details" key={reason} sx={{ mt: 0.5 }}>
              <summary>
                {skipReasonLabels[reason]}: {paths.length.toLocaleString('en-US')}
              </summary>
              <Box component="ul" sx={{ m: 0, pl: 3, wordBreak: 'break-all' }}>
                {paths.slice(0, MAX_LISTED_PATHS).map((path) => (
                  <li key={path}>{path}</li>
                ))}
                {paths.length > MAX_LISTED_PATHS && (
                  <li>…and {(paths.length - MAX_LISTED_PATHS).toLocaleString('en-US')} more</li>
                )}
              </Box>
            </Box>
          ))}
        </Alert>
      )}

      {result.series.length > 1 && (
        <Alert severity="info">
          Several Series were found. Open one at a time: images of different Series are never
          combined into one stack.
        </Alert>
      )}

      {!!partDifferences.length && (
        <Alert severity="warning" data-testid="local-import-parts">
          <AlertTitle>Some Series are offered in parts</AlertTitle>
          The viewer cannot show all images of these Series in one stack (they differ in{' '}
          {partDifferences.join(', ')}). Open each part separately; each part is only part of
          its Series. The DICOM UIDs are unchanged.
        </Alert>
      )}

      {!!missingImages && (
        <Alert severity="warning" data-testid="local-import-incomplete">
          <AlertTitle>Images may be missing</AlertTitle>
          {plural(missingImages, 'file or archive', 'files or archives')} that may contain
          images could not be read ({result.incompleteSources
            .map(({ source }) => (source ? `folder ${source}` : 'files chosen on their own'))
            .join(', ')}
          ). Which Series they belong to is unknown, so every Series from the same folder or
          selection is marked <strong>May be missing images</strong>: it may not be complete.
        </Alert>
      )}

      {hasRepeatedPositions && (
        <Alert severity="warning">
          {stackWarningLabels['repeated-positions']} Such stacks do not open automatically;
          the viewer reports how many images it could load.
        </Alert>
      )}

      {studies.map((seriesOfStudy) => {
        const study = seriesOfStudy[0];
        return (
          <Box key={study.studyInstanceUid} data-testid="local-import-study">
            <Typography variant="subtitle2">
              Study {formatStudyDate(study.studyDate) ?? 'without date'}
              {study.studyDescription ? ` · ${study.studyDescription}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary" title={study.studyInstanceUid}>
              Study Instance UID {shortUid(study.studyInstanceUid)}
            </Typography>
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Series</TableCell>
                  <TableCell>Modality</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Images</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {seriesOfStudy.map((series) => (
                    <TableRow
                      key={series.key}
                      data-testid="local-import-series"
                      title={series.seriesInstanceUid}
                    >
                      <TableCell>{series.seriesNumber ?? '—'}</TableCell>
                      <TableCell>{series.modality ?? '—'}</TableCell>
                      <TableCell>
                        {series.seriesDescription ?? 'No description'}
                        {series.part && (
                          <Chip
                            size="small"
                            color="warning"
                            label={`Part ${series.part.index} of ${series.part.count}`}
                            title={`Differs in: ${series.part.differences.join(', ')}`}
                            sx={{ ml: 1 }}
                          />
                        )}
                        {series.warnings.map((warning) => (
                          <Chip
                            key={warning}
                            size="small"
                            color="warning"
                            label={
                              warning === 'source-incomplete'
                                ? 'May be missing images'
                                : 'May load incompletely'
                            }
                            title={stackWarningLabels[warning]}
                            sx={{ ml: 1 }}
                          />
                        ))}
                        {series.key === openedKey && (
                          <Chip size="small" label="Last opened" sx={{ ml: 1 }} />
                        )}
                        {!!series.part?.values.length && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {series.part.values.join(' · ')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {series.instances.length.toLocaleString('en-US')}
                      </TableCell>
                      <TableCell align="right">{formatBytes(series.totalBytes)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => onOpen({ kind: 'series', series })}
                          aria-label={[
                            `Open Series ${series.seriesNumber ?? ''} ${series.seriesDescription ?? ''}`.trim(),
                            series.part && `part ${series.part.index} of ${series.part.count}`,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        );
      })}

      {!!result.mediaFiles.length && (
        <Box data-testid="local-import-media">
          <Typography variant="subtitle2">Other pictures and videos</Typography>
          <Typography variant="caption" color="text.secondary">
            Not DICOM: shown as plain pictures, without measurements in millimetres.
          </Typography>
          <Table size="small" sx={{ mt: 1 }}>
            <TableBody>
              {result.mediaFiles.map((media) => (
                <TableRow key={media.path}>
                  <TableCell sx={{ wordBreak: 'break-all' }}>
                    {media.path}
                    {`media:${media.path}` === openedKey && (
                      <Chip size="small" label="Last opened" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell>{media.kind === 'image' ? 'Picture' : 'Video'}</TableCell>
                  <TableCell align="right">{formatBytes(media.file.size)}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => onOpen({ kind: 'media', media })}
                      aria-label={`Open ${media.path}`}
                    >
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <Box>
        <Button variant="outlined" onClick={onReset}>
          Choose other files
        </Button>
      </Box>
    </Stack>
  );
};
