import {
  Box,
  Container,
  Grid,
  Link,
  Typography,
  useTheme,
} from '@mui/material';
import { FC } from 'react';
import { useBase } from '../../../store/slices';
import { guiRoutes } from '@libs/constants';

export const Footer: FC = () => {
  const year = new Date().getFullYear();
  const theme = useTheme();
  const { isDev, nodeEnv, title } = useBase();
  const navLinks = [
    { label: 'Privacy Policy', href: guiRoutes.privacy },
    { label: 'Terms of Service', href: guiRoutes.terms },
    { label: 'Medical Disclaimer', href: guiRoutes.disclaimer },
    { label: 'Compliance', href: guiRoutes.compliance },
    { label: 'Contacts', href: guiRoutes.contacts },
    { label: 'About us', href: guiRoutes.about },
    { label: 'Cookie Policy', href: guiRoutes.cookies },
  ];
  return (
    <Box
      component="footer"
      sx={{
        py: 3,
        mt: 'auto',
        borderTop: 1,
        borderColor: 'divider',
        position: 'relative',
        ...theme.applyStyles('light', {
          backgroundColor: theme.palette.grey['100'],
        }),
      }}
    >
      <Container maxWidth="lg">
        <Grid container spacing={2} alignItems="center">
          <Grid size={12}>
            <Typography variant="body2" color="text.secondary" align="center">
              © {year} {title} {isDev && `(${nodeEnv?.toUpperCase()})`} —{' '}
              Pediatric Bronchiectasis Expert. All rights reserved .
            </Typography>
          </Grid>
          <Grid size={12}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  color="text.secondary"
                  underline="hover"
                  variant="body2"
                >
                  {link.label}
                </Link>
              ))}
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};
