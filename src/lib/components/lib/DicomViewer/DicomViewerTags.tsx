'use client';

import { ToggleButton } from '@mui/material';
import { FC } from 'react';
import { useToggle } from 'usehooks-ts';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import { UIDialog } from '../UIDialog/UIDialog';
import { DicomViewerTagsTable } from './DicomViewerTagsTable';

interface DicomViewerTagsProps {
  dataLoaded: boolean;
  data: Record<string, unknown>;
}

export const DicomViewerTags: FC<DicomViewerTagsProps> = ({
  dataLoaded,
  data,
}) => {
  const [open, toggleOpen] = useToggle(false);
  return (
    <>
      <ToggleButton
        size="small"
        value="tags"
        title="Tags"
        disabled={!dataLoaded}
        onClick={toggleOpen}
      >
        <LibraryBooksIcon />
      </ToggleButton>
      <UIDialog open={open} onDialogClose={toggleOpen} title="DICOM Tags">
        <DicomViewerTagsTable data={data} />
      </UIDialog>
    </>
  );
};
