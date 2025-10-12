import { Stack, Typography, Button, ButtonProps, Box } from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { useNotifications } from '../../modules/notifications';

export const Component = () => {
  const { notifyError, notifyInfo, notifySuccess, notifyWarning } =
    useNotifications();
  const notifications = [
    {
      color: 'success',
      text: 'Notify success',
      action: () => {
        notifySuccess('Some success!');
      },
    },
    {
      color: 'info',
      text: 'Notify info',
      action: () => {
        notifyInfo('Hello world!');
      },
    },
    {
      color: 'warning',
      text: 'Notify warning',
      action: () => {
        notifyWarning(
          'Not Implemented. This service is currently not implemented'
        );
      },
    },
    {
      color: 'error',
      text: 'Notify error',
      action: () => {
        notifyError('Unknown error');
      },
    },
  ];
  return (
    <DefaultLayout>
      <PageTmpl>
        <Stack spacing={2}>
          <Box component="section">
            <Typography variant="h6">Buttons</Typography>
            <Stack spacing={1}>
              {['outlined', 'contained', 'text'].map((variant) => (
                <Stack key={variant} direction="row" spacing={1}>
                  {[
                    'primary',
                    'secondary',
                    'info',
                    'success',
                    'error',
                    'warning',
                  ].map((color) => (
                    <Button
                      key={color}
                      variant={variant as ButtonProps['variant']}
                      color={color as ButtonProps['color']}
                    >
                      {color}
                    </Button>
                  ))}
                </Stack>
              ))}
            </Stack>
          </Box>
          <Box component="section">
            <Typography variant="h6">Fonts</Typography>
            <h4 className="poppins">Poppins font family CSS Class: .poppins</h4>
            <Typography sx={{ fontFamily: 'var(--font-poppins)' }}>
              Poppins font family CSS Class: var(--font-poppins)
            </Typography>
          </Box>
          <Box component="section">
            <Typography variant="h6">Notifications</Typography>
            <Stack direction="row" spacing={1}>
              {notifications.map(({ text, color, action }) => (
                <Button
                  key={color}
                  variant="contained"
                  color={color as ButtonProps['color']}
                  onClick={action}
                >
                  {text}
                </Button>
              ))}
            </Stack>
          </Box>
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
