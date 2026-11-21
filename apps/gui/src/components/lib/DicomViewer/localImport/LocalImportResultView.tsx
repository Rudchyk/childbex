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
  type LocalDicomSeries,
  type LocalImportResult,
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

/** The Series that would be opened without asking (nothing to review). */
export const seriesToOpenDirectly = (result: LocalImportResult) =>
  result.series.length === 1 &&
  !result.failedArchives.length &&
  result.skipped.every((s) => QUIET_SKIP_REASONS.includes(s.reason))
    ? result.series[0]
    : undefined;

interface LocalImportResultViewProps {
  result: LocalImportResult;
  /** The Series last opened in the viewer. */
  openedKey?: string;
  onOpen: (series: LocalDicomSeries) => void;
  onReset: () => void;
}

export const LocalImportResultView: FC<LocalImportResultViewProps> = ({
  result,
  openedKey,
  onOpen,
  onReset,
}) => {
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
        {plural(result.series.length, 'Series', 'Series')} ({plural(studies.length, 'Study', 'Studies')}),{' '}
        {result.skipped.length.toLocaleString('en-US')} skipped.
      </Typography>

      {!result.series.length && (
        <Alert severity="error">
          No DICOM images that can be displayed were found. Choose a folder or ZIP archive that
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
                        {series.hasMixedImageSizes && (
                          <Chip
                            size="small"
                            color="warning"
                            label="Mixed image sizes"
                            title="Images of different sizes cannot all be shown in one stack"
                            sx={{ ml: 1 }}
                          />
                        )}
                        {series.key === openedKey && (
                          <Chip size="small" label="Last opened" sx={{ ml: 1 }} />
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
                          onClick={() => onOpen(series)}
                          aria-label={`Open Series ${series.seriesNumber ?? ''} ${series.seriesDescription ?? ''}`.trim()}
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

      <Box>
        <Button variant="outlined" onClick={onReset}>
          Choose other files
        </Button>
      </Box>
    </Stack>
  );
};
