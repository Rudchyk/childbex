import { ChangeEvent, FC, useCallback, useState } from 'react';
import { Box } from '@mui/material';
import { VisuallyHiddenInput } from '../VisuallyHiddenInput/VisuallyHiddenInput';

export interface DicomViewerDropboxProps {
  isShow: boolean;
  onLoadFiles: (files: File[]) => void;
}

export const DicomViewerDropbox: FC<DicomViewerDropboxProps> = ({
  isShow,
  onLoadFiles,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target && event.target.files) {
      onLoadFiles(event.target.files as unknown as File[]);
    }
  };
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault(); // !important
      if (!isDragging) {
        setIsDragging(true);
      }
    },
    [isDragging]
  );

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length) {
      onLoadFiles(droppedFiles);
    }
  }, []);

  if (!isShow) {
    return null;
  }

  return (
    <Box
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        p: 2,
        height: '100%',
        border: '5px dashed #e8eaf6',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:hover': {
          borderColor: '#3f51b5',
        },
      }}
    >
      <Box>
        Drag and drop data here or{' '}
        <label htmlFor="input-file">
          <a style={{ textDecoration: 'underline' }} id="input-file-link">
            click here
          </a>
        </label>
        <VisuallyHiddenInput
          id="input-file"
          type="file"
          onChange={onChange}
          multiple={true}
        />
      </Box>
    </Box>
  );
};
