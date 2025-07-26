'use client';

import { Button } from '@mui/material';
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
      <Button onClick={toggleOpen}>{title}</Button>
      <UIDialog title={title} open={open} onDialogClose={toggleOpen}>
        {data.map((item) => `${item.reviewer?.email}: ${item.vote}`)}
      </UIDialog>
    </>
  );
};
