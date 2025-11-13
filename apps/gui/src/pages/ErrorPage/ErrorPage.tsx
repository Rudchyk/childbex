import { Box } from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { ErrorTmpl } from '../../templates';
import { useRouteError } from 'react-router-dom';

interface CustomError {
  status?: number;
  message?: string;
  stack?: string;
}

const Component = () => {
  const error = useRouteError() as CustomError;

  return (
    <DefaultLayout>
      <ErrorTmpl
        title={error.message || 'Nothing here'}
        sx={{ flexGrow: 1 }}
        justifyContent="center"
        text={error.status}
      >
        {error.stack ? (
          <Box
            component="pre"
            sx={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}
          >
            {JSON.stringify(error.stack, null, 2)}
          </Box>
        ) : (
          ''
        )}
      </ErrorTmpl>
    </DefaultLayout>
  );
};

export default Component;
