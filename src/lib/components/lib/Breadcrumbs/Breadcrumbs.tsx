'use client';

import { usePathname } from 'next/navigation';
import { Breadcrumbs as MUIBreadcrumbs, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
// import { capitalize } from 'lodash';
import HomeIcon from '@mui/icons-material/Home';
import NextLink from 'next/link';

type Crumb = {
  href: string;
  label: string;
};

export const Breadcrumbs = () => {
  const pathname = usePathname(); // e.g. "/blog/posts/123"
  const segments = pathname
    .split('/') // ["", "blog", "posts", "123"]
    .filter(Boolean);

  // Build an array of { href, label } for each “crumb”
  const crumbs: Crumb[] = segments.map((seg, idx) => {
    const href = '/' + segments.slice(0, idx + 1).join('/');
    // let label = seg;

    // console.log('seg', seg);

    // Optional: map dynamic params to human labels
    // e.g. if seg matches /^\d+$/ you might fetch post title, but here:
    // for IDs, just show “Post #123”
    // TODO:
    // if (/^\d+$/.test(seg)) {
    //   label = `#${seg}`;
    // } else {
    //   label = capitalize(seg.replace(/[-_]/g, ' '));
    // }

    return { href, label: seg };
  });

  if (pathname === '/') {
    return null;
  }

  return (
    <MUIBreadcrumbs
      separator={<NavigateNextIcon fontSize="small" />}
      aria-label="breadcrumb"
      sx={{ mb: 2 }}
    >
      <Typography
        component={NextLink}
        color="primary"
        href="/"
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
            component={NextLink}
            href={href}
            sx={{ color: 'primary', textDecoration: 'none' }}
          >
            {label}
          </Typography>
        )
      )}
    </MUIBreadcrumbs>
  );
};
