import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material';
import { FC } from 'react';
import { useToggle } from '../../../hooks';
import { SeriesImage } from '@libs/schemas';
import { UIDialog } from '../../../components';
import { opinionLabels } from './reviewOpinions';

interface PatientImageVotesProps {
  data: SeriesImage['votes'];
  /** Reviewers whose completed review makes the image Normal by default. */
  implicitNormals?: SeriesImage['implicitNormals'];
}

/** Every reviewer's own opinion: explicit votes and implicit Normals. */
export const PatientImageVotes: FC<PatientImageVotesProps> = ({
  data,
  implicitNormals = [],
}) => {
  const title = 'Opinions';
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
                <TableCell align="right">{opinionLabels[item.vote]}</TableCell>
                <TableCell align="right">{item.comment}</TableCell>
              </TableRow>
            ))}
            {implicitNormals.map((item) => (
              <TableRow key={'implicit-' + item.reviewerId}>
                <TableCell component="th" scope="row">
                  {item.reviewerName || item.reviewerId}
                </TableCell>
                <TableCell align="right">Normal (by default)</TableCell>
                <TableCell align="right">
                  <em>Completed review, not marked</em>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </UIDialog>
    </>
  );
};
