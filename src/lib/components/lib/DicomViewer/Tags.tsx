'use client';

import { ToggleButton } from '@mui/material';
import { FC } from 'react';
import { useToggle } from 'usehooks-ts';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import { UIDialog } from '../UIDialog/UIDialog';
import { App } from 'dwv';

interface TagsProps {
  dataLoaded: boolean;
  app: App;
}

export const Tags: FC<TagsProps> = ({ dataLoaded }) => {
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
        ddd
        {/* <TagsTable data={metaData} /> */}
      </UIDialog>
    </>
  );
};
