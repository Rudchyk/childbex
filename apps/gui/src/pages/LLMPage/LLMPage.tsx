import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import {
  useLlmServiceCheckItemsMutation,
  useLlmServiceHealthMutation,
  useLlmServiceInferenceMutation,
} from '../../store/apis';
import { Alert, Button, Stack, CircularProgress } from '@mui/material';

export const Component = () => {
  const [llmServiceCheckItems, llmServiceCheckItemsStatus] =
    useLlmServiceCheckItemsMutation();
  const [llmServiceHealth, llmServiceHealthStatus] =
    useLlmServiceHealthMutation();
  const [llmServiceInference, llmServiceInferenceStatus] =
    useLlmServiceInferenceMutation();
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack spacing={2}>
          <Button
            variant="contained"
            color="success"
            onClick={() => llmServiceHealth()}
          >
            Check LLM health
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={() => llmServiceInference({ model: 'test' })}
          >
            Get LLM inference
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() =>
              llmServiceCheckItems([
                'item1',
                'item2',
                'item3',
                'item4',
                'item5',
                'item6',
                'item7',
              ])
            }
          >
            Check LLM health
          </Button>
        </Stack>
        {llmServiceHealthStatus.isLoading ? (
          <CircularProgress />
        ) : llmServiceHealthStatus.isError ? (
          <Alert severity="error">
            {'message' in llmServiceHealthStatus.error
              ? llmServiceHealthStatus.error.message
              : JSON.stringify(llmServiceHealthStatus.error)}
          </Alert>
        ) : (
          <pre>{JSON.stringify(llmServiceHealthStatus.data, null, 2)}</pre>
        )}
        {llmServiceInferenceStatus.isLoading ? (
          <CircularProgress />
        ) : llmServiceInferenceStatus.isError ? (
          <Alert severity="error">
            {'message' in llmServiceInferenceStatus.error
              ? llmServiceInferenceStatus.error.message
              : JSON.stringify(llmServiceInferenceStatus.error)}
          </Alert>
        ) : (
          <pre>{JSON.stringify(llmServiceInferenceStatus.data, null, 2)}</pre>
        )}
        {llmServiceCheckItemsStatus.isLoading ? (
          <CircularProgress />
        ) : llmServiceCheckItemsStatus.isError ? (
          <Alert severity="error">
            {'message' in llmServiceCheckItemsStatus.error
              ? llmServiceCheckItemsStatus.error.message
              : JSON.stringify(llmServiceCheckItemsStatus.error)}
          </Alert>
        ) : (
          <pre>{JSON.stringify(llmServiceCheckItemsStatus.data, null, 2)}</pre>
        )}
      </PageTmpl>
    </DefaultLayout>
  );
};
