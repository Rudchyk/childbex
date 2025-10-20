import { ToggleButton } from '@mui/material';
import { FC } from 'react';
import { useToggle } from '../../../hooks';
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
      <UIDialog
        open={open}
        isButtonCancel={false}
        isButtonPrimary={false}
        onDialogClose={toggleOpen}
        title="DICOM Tags"
        slotProps={{
          dialogProps: {
            maxWidth: 'lg',
          },
        }}
      >
        <DicomViewerTagsTable data={data} />
      </UIDialog>
    </>
  );
};
