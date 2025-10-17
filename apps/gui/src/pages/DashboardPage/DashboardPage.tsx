import { Typography } from '@mui/material';
import { ProtectedRoute } from '../../auth/ProtectedRoute';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { AuthRoleGate } from '../../auth/AuthRoleGate';
import { ROLES } from '../../auth/useAuth';

export const Component = () => {
  return (
    <ProtectedRoute>
      <DefaultLayout>
        <PageTmpl>
          <Typography>Private Dashboard</Typography>
          <AuthRoleGate authRole={ROLES.USER}>Hello User!</AuthRoleGate>
          <AuthRoleGate authRole={ROLES.ADMIN}>Hello Admin!</AuthRoleGate>
          <AuthRoleGate authRole={ROLES.DOCTOR}>Hello Doctor!</AuthRoleGate>
        </PageTmpl>
      </DefaultLayout>
    </ProtectedRoute>
  );
};
