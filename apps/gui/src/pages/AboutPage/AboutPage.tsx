import * as React from 'react';
import {
  Box,
  Container,
  Typography,
  Stack,
  Grid,
  Card,
  CardContent,
  Avatar,
  Chip,
  Divider,
  LinearProgress,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import ScienceIcon from '@mui/icons-material/Science';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import PsychologyIcon from '@mui/icons-material/Psychology';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { DefaultLayout } from '../../layouts';
import { Breadcrumbs } from '../../components';

export const Component = () => {
  return (
    <DefaultLayout isContainer={false}>
      <Container maxWidth="lg" sx={{ pt: 3 }}>
        <Breadcrumbs />
      </Container>
      <Box component="main" sx={{ py: { xs: 6, md: 10 } }}>
        {/* Intro / Hero (content-only) */}
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ md: 6, xs: 12 }}>
              <Stack spacing={2}>
                <Chip
                  label="About us"
                  color="primary"
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start' }}
                />
                <Typography variant="h3" lineHeight={1.1}>
                  Pediatric Bronchiectasis Expert
                </Typography>
                <Typography variant="h6" color="text.secondary">
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                  Integer nec odio. Praesent libero. Sed cursus ante dapibus
                  diam. Cras mattis consectetur purus sit amet fermentum.
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Chip
                    icon={<HealthAndSafetyIcon />}
                    label="Clinical focus"
                    color="primary"
                  />
                  <Chip
                    icon={<ScienceIcon />}
                    label="AI-driven"
                    variant="outlined"
                  />
                </Stack>
              </Stack>
            </Grid>
            <Grid size={{ md: 6, xs: 12 }}>
              <Box
                sx={{
                  aspectRatio: '16/10',
                  borderRadius: 3,
                  overflow: 'hidden',
                  boxShadow: 6,
                  backgroundImage:
                    'url(https://picsum.photos/seed/about-hero/1600/1000)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            </Grid>
          </Grid>
        </Container>

        {/* Mission */}
        <Box sx={{ py: { xs: 8, md: 12 } }}>
          <Container maxWidth="md">
            <Stack spacing={2} textAlign="center" alignItems="center">
              <Typography variant="overline" color="primary">
                Our mission
              </Typography>
              <Typography variant="h4">
                Improving pediatric respiratory care
              </Typography>
              <Typography color="text.secondary">
                Aenean lacinia bibendum nulla sed consectetur. Vestibulum id
                ligula porta felis euismod semper. Donec ullamcorper nulla non
                metus auctor fringilla.
              </Typography>
            </Stack>
          </Container>
        </Box>

        {/* What we do */}
        <Container maxWidth="lg">
          <Grid container spacing={3}>
            {[
              {
                icon: <PsychologyIcon />,
                title: 'Evidence-based AI',
                text: 'Etiam porta sem malesuada magna mollis euismod. Donec sed odio dui. Integer posuere erat a ante venenatis.',
              },
              {
                icon: <HealthAndSafetyIcon />,
                title: 'Clinician-first design',
                text: 'Nullam id dolor id nibh ultricies vehicula ut id elit. Maecenas faucibus mollis interdum.',
              },
              {
                icon: <VolunteerActivismIcon />,
                title: 'Patient-centric outcomes',
                text: 'Cras mattis consectetur purus sit amet fermentum. Curabitur blandit tempus porttitor.',
              },
            ].map((item, i) => (
              <Grid size={{ md: 6, xs: 12 }} key={i}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Avatar
                      variant="rounded"
                      sx={{
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        mb: 2,
                      }}
                    >
                      {item.icon}
                    </Avatar>
                    <Typography variant="h6" gutterBottom>
                      {item.title}
                    </Typography>
                    <Typography color="text.secondary">{item.text}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>

        {/* Impact / Stats */}
        <Box sx={{ py: { xs: 8, md: 12 } }}>
          <Container maxWidth="lg">
            <Grid container spacing={3}>
              {[
                { label: 'Clinics piloting', value: '24+' },
                { label: 'Studies analyzed', value: '12k+' },
                { label: 'Avg. turn-around', value: '6m' },
                { label: 'Uptime', value: '99.95%' },
              ].map((s, i) => (
                <Grid key={i} size={{ md: 6, xs: 12 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h4">{s.value}</Typography>
                      <Typography color="text.secondary">{s.label}</Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>

        {/* Values */}
        <Container maxWidth="md">
          <Stack
            spacing={2}
            textAlign="center"
            alignItems="center"
            sx={{ mb: 4 }}
          >
            <Typography variant="overline" color="primary">
              Our values
            </Typography>
            <Typography variant="h4">What guides our work</Typography>
          </Stack>
          <Stack spacing={2} direction="row">
            {[
              'Integrity',
              'Safety',
              'Transparency',
              'Excellence',
              'Collaboration',
              'Privacy-first',
            ].map((v, i) => (
              <Chip
                key={i}
                icon={<CheckCircleIcon />}
                label={v}
                variant="outlined"
              />
            ))}
          </Stack>
        </Container>

        {/* Team */}
        <Box sx={{ py: { xs: 8, md: 12 } }}>
          <Container maxWidth="lg">
            <Stack spacing={2} alignItems="center" sx={{ mb: 4 }}>
              <Typography variant="overline" color="primary">
                Team
              </Typography>
              <Typography variant="h4">Meet the people behind PBE</Typography>
              <Typography
                color="text.secondary"
                textAlign="center"
                maxWidth={720}
              >
                Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor
                auctor. Donec ullamcorper nulla non metus auctor fringilla.
              </Typography>
            </Stack>
            <Grid container spacing={3}>
              {[1, 2, 3, 4].map((i) => (
                <Grid key={i} size={{ md: 3, xs: 12, sm: 6 }}>
                  <Card sx={{ textAlign: 'center' }}>
                    <Box
                      sx={{
                        height: 160,
                        backgroundImage: `url(https://picsum.photos/seed/team-${i}/600/400)`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                    />
                    <CardContent>
                      <Typography fontWeight={700}>
                        Dr. Lorem Ipsum {i}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Specialty / Role
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Container>
        </Box>

        {/* Milestones (simple timeline substitute) */}
        <Container maxWidth="md">
          <Stack spacing={2} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="overline" color="primary">
              Milestones
            </Typography>
            <Typography variant="h4">From idea to impact</Typography>
          </Stack>
          <Stack spacing={3}>
            {[
              {
                year: '2023',
                title: 'Concept & early research',
                text: 'Maecenas faucibus mollis interdum. Nulla vitae elit libero, a pharetra augue.',
              },
              {
                year: '2024',
                title: 'Pilot with leading clinics',
                text: 'Aenean lacinia bibendum nulla sed consectetur. Cras justo odio, dapibus ac facilisis in.',
              },
              {
                year: '2025',
                title: 'Scaling & validation',
                text: 'Cras mattis consectetur purus sit amet fermentum. Curabitur blandit tempus porttitor.',
              },
            ].map((m, i) => (
              <Card key={i}>
                <CardContent>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                  >
                    <Chip label={m.year} color="primary" variant="outlined" />
                    <Box>
                      <Typography variant="h6">{m.title}</Typography>
                      <Typography color="text.secondary">{m.text}</Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Container>

        {/* Compliance teaser / Progress bars as example section */}
        <Box sx={{ py: { xs: 8, md: 12 } }}>
          <Container maxWidth="md">
            <Stack
              spacing={2}
              textAlign="center"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="overline" color="primary">
                Readiness
              </Typography>
              <Typography variant="h4">Compliance in progress</Typography>
              <Typography color="text.secondary">
                Integer posuere erat a ante venenatis dapibus posuere velit
                aliquet.
              </Typography>
            </Stack>
            <Stack spacing={3}>
              {[
                { label: 'Security hardening', value: 80 },
                { label: 'Data governance', value: 70 },
                { label: 'Clinical validation', value: 60 },
              ].map((p, i) => (
                <Box key={i}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={600}>{p.label}</Typography>
                    <Typography color="text.secondary">{p.value}%</Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={p.value}
                    sx={{ height: 8, borderRadius: 999 }}
                  />
                </Box>
              ))}
            </Stack>
          </Container>
        </Box>

        {/* Closing blurb (no footer) */}
        <Container maxWidth="sm">
          <Divider sx={{ my: 4 }} />
          <Typography textAlign="center" color="text.secondary">
            Sed posuere consectetur est at lobortis. Donec sed odio dui. Etiam
            porta sem malesuada magna mollis euismod.
          </Typography>
        </Container>
      </Box>
    </DefaultLayout>
  );
};
