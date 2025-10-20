import { Box, Link, Typography } from '@mui/material';
import { getDwvVersion } from 'dwv';

export const DicomViewerFooter = () => {
  return (
    <Box component="footer" sx={{ display: 'flex', justifyContent: 'center' }}>
      <Typography variant="caption">
        Powered by{' '}
        <Link
          href="https://github.com/ivmartel/dwv"
          title="dwv on github"
          color="inherit"
        >
          dwv
        </Link>{' '}
        {getDwvVersion()}
      </Typography>
    </Box>
  );
};
