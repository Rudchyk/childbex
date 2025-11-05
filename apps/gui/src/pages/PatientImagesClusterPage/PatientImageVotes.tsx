import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import { FC } from 'react';
import { useToggle } from '../../hooks';
import { GetPatientClusterResponse } from '@libs/schemas';
import { UIDialog } from '../../components';

interface PatientImageVotesProps {
  data: GetPatientClusterResponse['images'][0]['votes'];
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
              <TableCell align="right">Vote</TableCell>
              <TableCell align="right">Comment</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                <TableCell component="th" scope="row">
                  {item.reviewerName || item.reviewerId}
                </TableCell>
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
