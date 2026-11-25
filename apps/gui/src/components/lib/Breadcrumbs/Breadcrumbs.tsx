import { FC } from 'react';
import { Link as RouterLink, matchPath, useLocation } from 'react-router-dom';
import { Breadcrumbs as MUIBreadcrumbs, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import { guiRoutes } from '@libs/constants';

export type BreadcrumbItem = {
  /** Human-readable label (never a raw id or URL segment). */
  label: string;
  /** A resolved app route; without it the item is plain text. */
  to?: string;
};

export interface BreadcrumbsProps {
  /**
   * The page's trail after Home, current page last (never a link). Without
   * it, a static route gets its own label and any other route only Home:
   * labels and parents are never derived from the URL's segments.
   */
  items?: BreadcrumbItem[];
}

/** Labels of the static routes of the router (dynamic pages pass items). */
const staticRouteLabels: Record<string, string> = {
  [guiRoutes.about]: 'About',
  [guiRoutes.brief]: 'Brief',
  [guiRoutes.playground]: 'Playground',
  [guiRoutes.contacts]: 'Contacts',
  [guiRoutes.dashboard]: 'Dashboard',
  [guiRoutes.dwv]: 'Dicom Viewer',
  [guiRoutes.error]: 'Error',
  [guiRoutes.llm]: 'LLM',
  [guiRoutes.patients]: 'Patients',
};

export const getStaticRouteCrumbs = (pathname: string): BreadcrumbItem[] => {
  const route = Object.keys(staticRouteLabels).find((path) =>
    matchPath(path, pathname)
  );
  return route ? [{ label: staticRouteLabels[route], to: route }] : [];
};

const linkSx = {
  textDecoration: 'none',
  '&:hover, &:focus-visible': { textDecoration: 'underline' },
};

export const Breadcrumbs: FC<BreadcrumbsProps> = ({ items }) => {
  const { pathname } = useLocation();

  if (pathname === guiRoutes.home) {
    return null;
  }

  const crumbs = items ?? getStaticRouteCrumbs(pathname);

  return (
    <MUIBreadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      aria-label="breadcrumb"
      sx={{ mb: 2, overflowWrap: 'anywhere' }}
    >
      <Typography
        component={RouterLink}
        color="primary"
        to={guiRoutes.home}
        sx={{ ...linkSx, display: 'flex', alignItems: 'center' }}
      >
        <HomeIcon sx={{ mr: 0.5 }} fontSize="inherit" />
        Home
      </Typography>

      {crumbs.map(({ to, label }, i) =>
        i === crumbs.length - 1 ? (
          <Typography key={i} color="text.primary" aria-current="page">
            {label}
          </Typography>
        ) : to ? (
          <Typography
            key={i}
            component={RouterLink}
            to={to}
            color="primary"
            sx={linkSx}
          >
            {label}
          </Typography>
        ) : (
          <Typography key={i} color="text.secondary">
            {label}
          </Typography>
        )
      )}
    </MUIBreadcrumbs>
  );
};
