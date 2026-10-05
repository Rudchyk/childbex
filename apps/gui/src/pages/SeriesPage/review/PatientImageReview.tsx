import {
  ChipProps,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';
import { format } from 'date-fns';
import { FC } from 'react';
import { PatientImageVotes } from './PatientImageVotes';
import { PatientImageVote } from './PatientImageVote';
import { useAuth } from '../../../auth/useAuth';
import { PatientImageStatus, SeriesImage } from '@libs/schemas';
import { defaultDateFormat } from '@libs/constants';
import { opinionLabels, opinionOf } from './reviewOpinions';

/** The review fields of an image (a Series image or a legacy cluster image). */
export type ReviewPanelImage = Pick<
  SeriesImage,
  | 'id'
  | 'status'
  | 'isAbnormal'
  | 'votesCount'
  | 'normalVotes'
  | 'abnormalVotes'
  | 'uncertainVotes'
  | 'adminResolutionId'
  | 'adminResolutionName'
  | 'resolutionComment'
  | 'votes'
> & {
  resolvedAt?: string | null;
  /** Implicit NORMAL opinions (Series images). */
  implicitNormals?: SeriesImage['implicitNormals'];
  /** Legacy cluster images only. */
  notes?: string;
  reviewState?: SeriesImage['reviewState'];
  reviewStateSource?: SeriesImage['reviewStateSource'];
};

interface PatientImageReviewProps {
  item?: ReviewPanelImage;
}

export const PatientImageReview: FC<PatientImageReviewProps> = ({ item }) => {
  const { hasRole, roles, isDoctor, isAdmin, userId } = useAuth();
  const getStatusColor = (): ChipProps['color'] => {
    switch (item?.status) {
      case PatientImageStatus.NORMAL:
        return 'primary';
      case PatientImageStatus.CONFLICTED:
        return 'error';
      case PatientImageStatus.ADMIN_RESOLVED:
        return 'warning';
      case PatientImageStatus.UNCERTAIN:
        return 'info';
      default:
        return 'default';
    }
  };
  const votesInfo = [
    {
      label: 'Votes',
      value: item?.votesCount,
    },
    {
      label: 'Normal votes',
      value: item?.normalVotes,
    },
    {
      label: 'Abnormal votes',
      value: item?.abnormalVotes,
    },
    {
      label: 'Uncertain votes',
      value: item?.uncertainVotes,
    },
  ];
  const info = [
    ...(item?.reviewState
      ? [
          {
            label: 'Review state',
            value: `${item.reviewState} (${item.reviewStateSource})`,
          },
        ]
      : []),
    {
      label: 'Is abnormal?',
      value: (
        <Typography color={item?.isAbnormal ? 'error' : 'primary'}>
          {item?.isAbnormal ? 'YES' : 'NO'}
        </Typography>
      ),
    },
    {
      label: 'Status',
      value: (
        <Typography color={getStatusColor()} variant="subtitle2">
          {item?.status?.toUpperCase()}
        </Typography>
      ),
    },
  ];
  const resolutionInfo = [
    {
      label: 'Resolver',
      value: item?.adminResolutionName,
    },
    {
      label: 'Comment',
      value: item?.resolutionComment,
    },
    {
      label: 'Resolved at',
      value: item?.resolvedAt
        ? format(item?.resolvedAt, defaultDateFormat)
        : '',
    },
  ];
  const userVote = item?.votes?.find(({ reviewerId }) => reviewerId === userId);
  const myOpinion = item
    ? opinionOf({ votes: item.votes ?? [], implicitNormals: item.implicitNormals ?? [] }, userId)
    : null;
  const opinionsCount = (item?.votes?.length ?? 0) + (item?.implicitNormals?.length ?? 0);

  return (
    <>
      <Stack spacing={1} py={1}>
        {(isDoctor || isAdmin) && !!item?.id && (
          <>
            <Typography px={2} variant="body2" data-testid="my-opinion">
              Your opinion:{' '}
              <strong>
                {myOpinion
                  ? myOpinion.source === 'implicit'
                    ? 'Normal (by default: your completed review)'
                    : opinionLabels[myOpinion.vote]
                  : 'not marked'}
              </strong>
            </Typography>
            <PatientImageVote patientImageId={item.id} userVote={userVote} />
            <Divider />
          </>
        )}
        <Typography px={2} variant="subtitle1">
          Info:
        </Typography>
        <Table size="small" sx={{ mb: 2 }}>
          <TableBody>
            {info.map(({ label, value }, index) => (
              <TableRow key={label + index}>
                <TableCell component="th" scope="row">
                  {label}
                </TableCell>
                <TableCell align="right">{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!!item?.adminResolutionId && (
          <>
            <Typography px={2} variant="subtitle1">
              Resolution info:
            </Typography>
            <Table size="small" sx={{ mb: 2 }}>
              <TableBody>
                {resolutionInfo.map(({ label, value }, index) => (
                  <TableRow key={label + index}>
                    <TableCell component="th" scope="row">
                      {label}
                    </TableCell>
                    <TableCell align="right">{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
        <Stack
          spacing={1}
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography px={2} variant="subtitle1">
            Review info:
          </Typography>
          {!!opinionsCount && (
            <PatientImageVotes
              data={item?.votes ?? []}
              implicitNormals={item?.implicitNormals ?? []}
            />
          )}
        </Stack>
        <Table size="small">
          <TableBody>
            {votesInfo.map(({ label, value }) => (
              <TableRow key={label + value}>
                <TableCell component="th" scope="row">
                  {label}
                </TableCell>
                <TableCell align="right">{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
      {!!item?.notes && (
        <>
          <Typography px={2} variant="subtitle1">
            Notes:
          </Typography>
          {item?.notes}
        </>
      )}
    </>
  );
};
