import { Stack, Typography, Button } from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { Nav } from '../../components';

export const Component = () => {
  return (
    <DefaultLayout>
      <PageTmpl>
        <Nav />
        <Stack spacing={2}>
          {['outlined', 'contained', 'text'].map((variant: any) => (
            <Stack key={variant} direction="row" spacing={1}>
              {['primary', 'secondary', 'info', 'success'].map((color: any) => (
                <Button key={color} variant={variant} color={color}>
                  {color}
                </Button>
              ))}
            </Stack>
          ))}
          <h4 className="poppins">Poppins font family CSS Class: .poppins</h4>
          <Typography sx={{ fontFamily: 'var(--font-poppins)' }}>
            Poppins font family CSS Class: var(--font-poppins)
          </Typography>
        </Stack>
      </PageTmpl>
    </DefaultLayout>
  );
};
