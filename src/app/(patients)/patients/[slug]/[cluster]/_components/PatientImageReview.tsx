import { defaultDateFormat } from '@/lib/constants/dates';
import { PatientImage, PatientImageStatus, UserRoles } from '@/types';
import {
  Chip,
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
import { useSession } from 'next-auth/react';
import { PatientImageVote } from './PatientImageVote/PatientImageVote';

interface PatientImageReviewProps {
  item?: PatientImage;
}

export const PatientImageReview: FC<PatientImageReviewProps> = ({ item }) => {
  const session = useSession();
  const isDoctor = session?.data?.user?.role === UserRoles.DOCTOR || true;
  const getStatusColor = (): ChipProps['color'] => {
    switch (item?.status) {
      case PatientImageStatus.NORMAL:
        return 'primary';
      case PatientImageStatus.CONFLICTED:
        return 'error';
      case PatientImageStatus.ADMIN_RESOLVED:
        return 'warning';
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
        <Chip color={getStatusColor()} label={item?.status?.toUpperCase()} />
      ),
    },
  ];
  const resolutionInfo = [
    {
      label: 'Resolver',
      value: item?.resolver?.email,
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
  const userVote = item?.votes?.find(
    ({ reviewerId }) => reviewerId === session?.data?.user.id
  );
  return (
    <>
      <Stack spacing={1} py={1}>
        {isDoctor && !!item?.id && (
          <>
            <PatientImageVote patientImageId={item.id} userVote={userVote} />
            <Divider />
          </>
        )}
        <Typography px={2} variant="subtitle1">
          Info:
        </Typography>
        <Table size="small">
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

            <Table size="small">
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
        <Stack spacing={1} direction="row" justifyContent="space-between">
          <Typography px={2} variant="subtitle1">
            Review info:
          </Typography>
          {!!item?.votes?.length && <PatientImageVotes data={item.votes} />}
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
