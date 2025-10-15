import { Typography } from '@mui/material';
import { ProtectedRoute } from '../../auth/ProtectedRoute';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { AuthRoleGate } from '../../auth/AuthRoleGate';

export const Component = () => {
  return (
    <ProtectedRoute>
      <DefaultLayout>
        <PageTmpl>
          <Typography>Private Dashboard</Typography>
          <AuthRoleGate authRole="user">Hello User!</AuthRoleGate>
          <AuthRoleGate authRole="admin">Hello Admin!</AuthRoleGate>
          <AuthRoleGate authRole="doctor">Hello Doctor!</AuthRoleGate>
        </PageTmpl>
      </DefaultLayout>
    </ProtectedRoute>
  );
};
