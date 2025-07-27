'use client';

import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import { useToggle } from 'usehooks-ts';
import { UIDialog } from '@/lib/components';
import { FC } from 'react';
import { PatientImageReviewVote } from '@/types';

interface PatientImageVotesProps {
  data: PatientImageReviewVote[];
}

export const PatientImageVotes: FC<PatientImageVotesProps> = ({ data }) => {
  const title = 'Votes';
  const [open, toggleOpen] = useToggle(false);

  return (
    <>
      <Button variant="contained" onClick={toggleOpen}>
        {title}
      </Button>
      <UIDialog
        title={title}
        isButtonPrimary={false}
        open={open}
        onDialogClose={toggleOpen}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Reviewer</TableCell>
              <TableCell>Role</TableCell>
              <TableCell align="right">Vote</TableCell>
              <TableCell align="right">Comment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                <TableCell component="th" scope="row">
                  {item.reviewer?.email || item.reviewerId}
                </TableCell>
                <TableCell align="right">{item.reviewer?.role}</TableCell>
                <TableCell align="right">{item.vote.toUpperCase()}</TableCell>
                <TableCell align="right">{item.comment}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </UIDialog>
    </>
  );
};
