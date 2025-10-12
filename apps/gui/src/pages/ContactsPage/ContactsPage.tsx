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
  TextField,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Link as MUILink,
  Button,
  Snackbar,
  Alert,
} from '@mui/material';
import { DefaultLayout } from '../../layouts';
import { Breadcrumbs } from '../../components';
import SendIcon from '@mui/icons-material/Send';
import EmailIcon from '@mui/icons-material/Email';
import PhoneIcon from '@mui/icons-material/Phone';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import TwitterIcon from '@mui/icons-material/Twitter';

export const Component = () => {
  const [values, setValues] = React.useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    agree: false,
  });
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const [open, setOpen] = React.useState(false);

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
  };

  const onAgreeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, agree: e.target.checked }));
  };

  const markTouched = (field: string) =>
    setTouched((t) => ({ ...t, [field]: true }));

  const emailValid = /.+@.+\..+/.test(values.email);
  const nameError = touched.name && values.name.trim() === '';
  const emailError = touched.email && !emailValid;
  const subjectError = touched.subject && values.subject.trim() === '';
  const messageError = touched.message && values.message.trim().length < 10;
  const agreeError = touched.agree && !values.agree;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // mark all touched
    setTouched({
      name: true,
      email: true,
      subject: true,
      message: true,
      agree: true,
    });

    if (
      values.name.trim() &&
      emailValid &&
      values.subject.trim() &&
      values.message.trim().length >= 10 &&
      values.agree
    ) {
      // Here you can call your API. For now, just show success.
      setOpen(true);
      // reset minimal
      setValues({
        name: '',
        email: '',
        subject: '',
        message: '',
        agree: false,
      });
      setTouched({});
    }
  };
  return (
    <DefaultLayout isContainer={false}>
      <Container maxWidth="lg" sx={{ pt: 3 }}>
        <Breadcrumbs />
      </Container>
      <Box component="main" sx={{ py: { xs: 6, md: 10 } }}>
        {/* Title */}
        <Container maxWidth="md" sx={{ mb: 6 }}>
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Chip label="Contact us" color="primary" variant="outlined" />
            <Typography variant="h3">We'd love to hear from you</Typography>
            <Typography color="text.secondary" maxWidth={720}>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas
              faucibus mollis interdum. Nulla vitae elit libero, a pharetra
              augue.
            </Typography>
          </Stack>
        </Container>

        {/* Map / Visual */}
        <Container maxWidth="lg" sx={{ mb: 6 }}>
          <Box
            sx={{
              height: { xs: 220, sm: 320, md: 420 },
              borderRadius: 3,
              overflow: 'hidden',
              boxShadow: 6,
              backgroundImage:
                'url(https://picsum.photos/seed/pbe-map/1600/900)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        </Container>

        {/* Form + Info */}
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            <Grid size={{ md: 7, xs: 12 }}>
              <Card component="form" onSubmit={handleSubmit} noValidate>
                <CardContent>
                  <Stack spacing={2}>
                    <Typography variant="h5">Send a message</Typography>
                    <Grid container spacing={2}>
                      <Grid size={{ md: 6, xs: 12 }}>
                        <TextField
                          label="Your name"
                          name="name"
                          value={values.name}
                          onChange={onChange}
                          onBlur={() => markTouched('name')}
                          error={!!nameError}
                          helperText={
                            nameError ? 'Please enter your name.' : ' '
                          }
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid size={{ md: 6, xs: 12 }}>
                        <TextField
                          label="Email"
                          name="email"
                          type="email"
                          value={values.email}
                          onChange={onChange}
                          onBlur={() => markTouched('email')}
                          error={!!emailError}
                          helperText={
                            emailError ? 'Enter a valid email address.' : ' '
                          }
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          label="Subject"
                          name="subject"
                          value={values.subject}
                          onChange={onChange}
                          onBlur={() => markTouched('subject')}
                          error={!!subjectError}
                          helperText={
                            subjectError ? 'Please enter a subject.' : ' '
                          }
                          fullWidth
                          required
                        />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <TextField
                          label="Message"
                          name="message"
                          value={values.message}
                          onChange={onChange}
                          onBlur={() => markTouched('message')}
                          error={!!messageError}
                          helperText={
                            messageError
                              ? 'Please enter at least 10 characters.'
                              : ' '
                          }
                          fullWidth
                          required
                          multiline
                          minRows={5}
                        />
                      </Grid>
                    </Grid>
                    <FormGroup>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={values.agree}
                            onChange={onAgreeChange}
                          />
                        }
                        label={
                          <Typography variant="body2">
                            I agree to the{' '}
                            <MUILink href="#" underline="hover">
                              privacy notice
                            </MUILink>{' '}
                            and consent to being contacted.
                          </Typography>
                        }
                        onBlur={() => markTouched('agree')}
                      />
                      {agreeError && (
                        <Typography
                          variant="caption"
                          color="error"
                          sx={{ ml: 5, mt: -1 }}
                        >
                          Please accept the privacy notice to proceed.
                        </Typography>
                      )}
                    </FormGroup>
                    <Stack direction="row" spacing={2}>
                      <Button
                        type="submit"
                        variant="contained"
                        startIcon={<SendIcon />}
                      >
                        Send
                      </Button>
                      <Button
                        type="reset"
                        variant="outlined"
                        onClick={() => {
                          setValues({
                            name: '',
                            email: '',
                            subject: '',
                            message: '',
                            agree: false,
                          });
                          setTouched({});
                        }}
                      >
                        Reset
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>

            <Grid size={{ md: 5, xs: 12 }}>
              <Stack spacing={3}>
                <Card>
                  <CardContent>
                    <Stack spacing={2}>
                      <Typography variant="h6">Contact details</Typography>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                      >
                        <Avatar
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                          }}
                        >
                          <EmailIcon />
                        </Avatar>
                        <Box>
                          <Typography fontWeight={600}>Email</Typography>
                          <MUILink
                            href="mailto:hello@pbe.example"
                            underline="hover"
                          >
                            hello@pbe.example
                          </MUILink>
                        </Box>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                      >
                        <Avatar
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                          }}
                        >
                          <PhoneIcon />
                        </Avatar>
                        <Box>
                          <Typography fontWeight={600}>Phone</Typography>
                          <MUILink href="tel:+1234567890" underline="hover">
                            +1 (234) 567-890
                          </MUILink>
                        </Box>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                      >
                        <Avatar
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                          }}
                        >
                          <LocationOnIcon />
                        </Avatar>
                        <Box>
                          <Typography fontWeight={600}>Address</Typography>
                          <Typography color="text.secondary">
                            123 Medical Way, Suite 100
                            <br />
                            Your City, Country
                          </Typography>
                        </Box>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="flex-start"
                      >
                        <Avatar
                          sx={{
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                          }}
                        >
                          <AccessTimeIcon />
                        </Avatar>
                        <Box>
                          <Typography fontWeight={600}>Hours</Typography>
                          <Typography color="text.secondary">
                            Mon–Fri, 09:00–18:00
                          </Typography>
                        </Box>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <Typography variant="h6" gutterBottom>
                      Follow
                    </Typography>
                    <Stack direction="row" spacing={2}>
                      <Button
                        startIcon={<LinkedInIcon />}
                        component="a"
                        href="#"
                        variant="outlined"
                      >
                        LinkedIn
                      </Button>
                      <Button
                        startIcon={<TwitterIcon />}
                        component="a"
                        href="#"
                        variant="outlined"
                      >
                        Twitter
                      </Button>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="body2" color="text.secondary">
                      For media inquiries, email{' '}
                      <MUILink href="mailto:press@pbe.example">
                        press@pbe.example
                      </MUILink>
                      .
                    </Typography>
                  </CardContent>
                </Card>
              </Stack>
            </Grid>
          </Grid>
        </Container>

        <Snackbar
          open={open}
          autoHideDuration={4000}
          onClose={() => setOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={() => setOpen(false)}
            severity="success"
            variant="filled"
            sx={{ width: '100%' }}
          >
            Message sent! We'll get back to you soon.
          </Alert>
        </Snackbar>
      </Box>
    </DefaultLayout>
  );
};
