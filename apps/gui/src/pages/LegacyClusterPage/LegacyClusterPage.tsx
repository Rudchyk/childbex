import { Alert, AlertTitle, Link } from '@mui/material';
import { generatePath, Link as RouteLink, useParams } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';

/**
 * Old bookmarks of the removed cluster page. No redirect to a Series: a
 * cluster could hold images of several Series.
 */
export const LegacyClusterNotice = () => {
  const { slug = '' } = useParams<{ slug: string }>();
  return (
    <Alert severity="info">
      <AlertTitle>This page no longer exists</AlertTitle>
      Image clusters were replaced by DICOM Studies and Series.{' '}
      <Link component={RouteLink} to={generatePath(guiRoutes.patient, { slug })}>
        Open the patient&apos;s studies
      </Link>
      .
    </Alert>
  );
};

export const Component = () => (
  <DefaultLayout>
    <PageTmpl>
      <LegacyClusterNotice />
    </PageTmpl>
  </DefaultLayout>
);
