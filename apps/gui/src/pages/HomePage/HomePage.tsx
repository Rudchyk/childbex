import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { useBase } from '../../store/slices';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import SpeedIcon from '@mui/icons-material/Speed';
import SecurityIcon from '@mui/icons-material/Security';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import VerifiedIcon from '@mui/icons-material/Verified';

export const Component = () => {
  const { msg } = useBase();
  return (
    <DefaultLayout isContainer={false}>
      {/* Hero */}
      <Box
        component="section"
        sx={{
          position: 'relative',
          py: { xs: 8, md: 14 },
          background: (t) =>
            `linear-gradient(180deg, ${t.palette.background.default} 0%, ${t.palette.action.hover} 100%)`,
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ md: 6, xs: 12 }}>
              <Stack spacing={3}>
                <Typography
                  variant="overline"
                  color="primary"
                  sx={{ letterSpacing: 1.2 }}
                >
                  AI • MEDICAL • IMAGING
                </Typography>
                <Typography variant="h2" lineHeight={1.1}>
                  Lorem ipsum platform for
                  <Box component="span" sx={{ color: 'primary.main' }}>
                    {' '}
                    pediatric bronchiectasis
                  </Box>
                </Typography>
                <Typography variant="h6" color="text.secondary">
                  Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                  Integer nec odio. Praesent libero. Sed cursus ante dapibus
                  diam.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <Button
                    variant="contained"
                    size="large"
                    component="a"
                    href="#cta"
                  >
                    Request demo
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    color="secondary"
                    component="a"
                    href="#how-it-works"
                  >
                    See how it works
                  </Button>
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Avatar
                    sx={{ bgcolor: 'success.main', width: 28, height: 28 }}
                  >
                    <VerifiedIcon fontSize="small" />
                  </Avatar>
                  <Typography variant="body2" color="text.secondary">
                    Lorem ipsum dolor sit amet, consectetur — ISO/IEC 27001
                    ready.
                  </Typography>
                </Stack>
              </Stack>
            </Grid>
            <Grid size={{ md: 6, xs: 12 }}>
              <Box
                sx={{
                  borderRadius: 3,
                  overflow: 'hidden',
                  boxShadow: 6,
                  aspectRatio: '16/10',
                  backgroundImage:
                    'url(https://picsum.photos/seed/dicom-workflow/1200/1600)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            </Grid>
          </Grid>
        </Container>
      </Box>
      {/* Features */}
      <Box component="section" id="features" sx={{ py: { xs: 8, md: 12 } }}>
        <Container maxWidth="lg">
          <Stack spacing={2} alignItems="center" sx={{ mb: 6 }}>
            <Typography variant="overline" color="primary">
              Key features
            </Typography>
            <Typography variant="h3" textAlign="center">
              Everything you need — lorem ipsum
            </Typography>
            <Typography
              color="text.secondary"
              textAlign="center"
              maxWidth={720}
            >
              Sed nisi. Nulla quis sem at nibh elementum imperdiet. Duis
              sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue semper
              porta.
            </Typography>
          </Stack>

          <Grid container spacing={3}>
            {[
              {
                icon: <HealthAndSafetyIcon />,
                title: 'Clinical focus',
                text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam porta sem malesuada magna mollis euismod.',
              },
              {
                icon: <SpeedIcon />,
                title: 'Fast results',
                text: 'Aenean lacinia bibendum nulla sed consectetur. Vestibulum id ligula porta felis euismod semper.',
              },
              {
                icon: <SecurityIcon />,
                title: 'Security by design',
                text: 'Cras mattis consectetur purus sit amet fermentum. Donec id elit non mi porta gravida at eget metus.',
              },
              {
                icon: <CloudUploadIcon />,
                title: 'Seamless uploads',
                text: 'Nullam id dolor id nibh ultricies vehicula ut id elit. Maecenas faucibus mollis interdum.',
              },
              {
                icon: <AnalyticsIcon />,
                title: 'Actionable insights',
                text: 'Curabitur blandit tempus porttitor. Vestibulum id ligula porta felis euismod semper.',
              },
              {
                icon: <VerifiedIcon />,
                title: 'Compliance-ready',
                text: 'Integer posuere erat a ante venenatis dapibus posuere velit aliquet.',
              },
            ].map((f, i) => (
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
                      {f.icon}
                    </Avatar>
                    <Typography variant="h6" gutterBottom>
                      {f.title}
                    </Typography>
                    <Typography color="text.secondary">{f.text}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>
      {/* How it works */}
      <Box
        component="section"
        id="how-it-works"
        sx={{ py: { xs: 8, md: 12 }, backgroundColor: 'action.hover' }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={6} alignItems="center">
            <Grid size={{ md: 6, xs: 12 }}>
              <Stack spacing={2}>
                <Typography variant="overline" color="primary">
                  Workflow
                </Typography>
                <Typography variant="h3">How it works</Typography>
                <Typography color="text.secondary">
                  Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor
                  auctor. Donec sed odio dui. Integer posuere erat a ante
                  venenatis dapibus posuere velit aliquet.
                </Typography>
                <Stack spacing={2}>
                  {[
                    {
                      title: 'Upload DICOM',
                      text: 'Donec id elit non mi porta gravida at eget metus. Cras mattis consectetur purus sit amet fermentum.',
                    },
                    {
                      title: 'Analyze with AI',
                      text: 'Maecenas faucibus mollis interdum. Nulla vitae elit libero, a pharetra augue.',
                    },
                    {
                      title: 'Review insights',
                      text: 'Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor.',
                    },
                  ].map((s, i) => (
                    <Stack key={i} direction="row" spacing={2}>
                      <Avatar
                        sx={{
                          bgcolor: 'secondary.main',
                          color: 'secondary.contrastText',
                        }}
                      >
                        {i + 1}
                      </Avatar>
                      <Box>
                        <Typography variant="subtitle1" fontWeight={700}>
                          {s.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {s.text}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            </Grid>
            <Grid size={{ md: 6, xs: 12 }}>
              <Box
                sx={{
                  borderRadius: 3,
                  overflow: 'hidden',
                  boxShadow: 6,
                  aspectRatio: '3/4',
                  backgroundImage:
                    'url(https://picsum.photos/seed/dicom-workflow/1200/1600)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
            </Grid>
          </Grid>
        </Container>
      </Box>
      {/* Testimonials */}
      <Box component="section" sx={{ py: { xs: 8, md: 12 } }}>
        <Container maxWidth="lg">
          <Stack spacing={2} alignItems="center" sx={{ mb: 6 }}>
            <Typography variant="overline" color="primary">
              Testimonials
            </Typography>
            <Typography variant="h3" textAlign="center">
              What clinicians say
            </Typography>
          </Stack>
          <Grid container spacing={3}>
            {[1, 2, 3].map((i) => (
              <Grid size={{ md: 6, xs: 12 }} key={i}>
                <Card>
                  <CardContent>
                    <Stack
                      direction="row"
                      spacing={2}
                      alignItems="center"
                      sx={{ mb: 2 }}
                    >
                      <Avatar src={`https://i.pravatar.cc/150?img=${i + 10}`} />
                      <Box>
                        <Typography fontWeight={700}>
                          Dr. Lorem Ipsum
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Pediatric Pulmonology
                        </Typography>
                      </Box>
                    </Stack>
                    <Typography>
                      “Etiam porta sem malesuada magna mollis euismod. Cras
                      justo odio, dapibus ac facilisis in, egestas eget quam.”
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>
      {/* FAQ */}
      <Box component="section" id="faq" sx={{ py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Stack spacing={2} alignItems="center" sx={{ mb: 4 }}>
            <Typography variant="overline" color="primary">
              FAQ
            </Typography>
            <Typography variant="h3" textAlign="center">
              Frequently asked questions
            </Typography>
          </Stack>
          {[
            {
              q: 'Is this a medical device?',
              a: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse eu ligula porta, dictum sem a, viverra arcu.',
            },
            {
              q: 'How is my data secured?',
              a: 'Cras mattis consectetur purus sit amet fermentum. Donec id elit non mi porta gravida at eget metus.',
            },
            {
              q: 'Can I try it for free?',
              a: 'Nullam id dolor id nibh ultricies vehicula ut id elit. Maecenas faucibus mollis interdum.',
            },
          ].map((item, i) => (
            <Accordion key={i} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                {item.q}
              </AccordionSummary>
              <AccordionDetails>
                <Typography color="text.secondary">{item.a}</Typography>
              </AccordionDetails>
            </Accordion>
          ))}
        </Container>
      </Box>
      {/* CTA */}
      <Box
        component="section"
        id="cta"
        sx={{
          py: { xs: 8, md: 12 },
          background: (t) =>
            `linear-gradient(180deg, ${t.palette.action.hover} 0%, ${t.palette.background.default} 100%)`,
        }}
      >
        <Container maxWidth="md">
          <Card sx={{ p: { xs: 3, md: 5 } }}>
            <Stack spacing={2} alignItems="center" textAlign="center">
              <Typography variant="h4">Ready to get started?</Typography>
              <Typography color="text.secondary">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer
                posuere erat a ante venenatis dapibus posuere velit aliquet.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Button variant="contained" size="large">
                  Request a demo
                </Button>
                <Button variant="outlined" size="large" color="secondary">
                  Contact sales
                </Button>
              </Stack>
            </Stack>
          </Card>
        </Container>
      </Box>
    </DefaultLayout>
  );
};
