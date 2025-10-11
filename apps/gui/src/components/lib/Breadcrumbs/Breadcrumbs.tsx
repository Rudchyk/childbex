import { Link as RouterLink, useLocation } from 'react-router-dom';
import { Breadcrumbs as MUIBreadcrumbs, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import { guiRoutes } from '@libs/constants';

type Crumb = {
  href: string;
  label: string;
};

export const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  const crumbs: Crumb[] = segments.map((seg, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    return { href, label: seg };
  });

  if (pathname === guiRoutes.home) {
    return null;
  }

  return (
    <MUIBreadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      aria-label="breadcrumb"
      sx={{ mb: 2 }}
    >
      <Typography
        component={RouterLink}
        color="primary"
        to={guiRoutes.home}
        sx={{
          textDecoration: 'none',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <HomeIcon sx={{ mr: 0.5 }} fontSize="inherit" />
        Home
      </Typography>

      {crumbs.map(({ href, label }, i) =>
        i === crumbs.length - 1 ? (
          <Typography key={href} color="text.primary">
            {label}
          </Typography>
        ) : (
          <Typography
            key={href}
            component={RouterLink}
            to={href}
            sx={{ color: 'primary', textDecoration: 'none' }}
          >
            {label}
          </Typography>
        )
      )}
    </MUIBreadcrumbs>
  );
};
