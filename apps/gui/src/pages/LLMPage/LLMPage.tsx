import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { useLlmServiceInferenceMutation } from '../../store/apis';
import { Alert, Button, Stack, useMediaQuery, useTheme } from '@mui/material';
import { LLMHealth } from './LLMHealth';
import ErrorIcon from '@mui/icons-material/Error';
import { getErrorMessage } from '../../utils';
import CheckIcon from '@mui/icons-material/Check';
import ComputerIcon from '@mui/icons-material/Computer';

export const Component = () => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const [llmServiceInference, { data, isError, error, isLoading }] =
    useLlmServiceInferenceMutation();
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack direction={matches ? 'column' : 'row'} spacing={2} mb={2}>
          <LLMHealth />
          <Button
            variant="contained"
            color="secondary"
            startIcon={<ComputerIcon />}
            onClick={() => llmServiceInference({})}
            loading={isLoading}
          >
            Check LLM inference
          </Button>
        </Stack>
        {isError && error ? (
          <Alert icon={<ErrorIcon fontSize="inherit" />} severity="error">
            {getErrorMessage(error)}
          </Alert>
        ) : data ? (
          <Alert icon={<CheckIcon fontSize="inherit" />} severity="success">
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </Alert>
        ) : null}
      </PageTmpl>
    </DefaultLayout>
  );
};
