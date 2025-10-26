import {
  LoaderFunctionArgs,
  Outlet,
  createBrowserRouter,
  redirect,
} from 'react-router-dom';
import ErrorPage from '../pages/ErrorPage/ErrorPage';
import { LoaderData } from '../types';
import { guiRoutes } from '@libs/constants';
import { ProtectedRoute } from '../auth/ProtectedRoute';

const defaultOptions = {
  handle: {
    crumb: (data: LoaderData) => data,
  },
};

export async function requireAuth({ request }: LoaderFunctionArgs) {
  if (!window.keycloak?.authenticated) {
    throw redirect('/');
  }
  return null;
}

export default createBrowserRouter([
  {
    element: <Outlet />,
    errorElement: <ErrorPage />,
    ...defaultOptions,
    children: [
      {
        index: true,
        loader: () => ({ title: '' }),
        lazy: () => import('../pages/HomePage/HomePage'),
        ...defaultOptions,
      },
      {
        path: guiRoutes.about,
        lazy: () => import('../pages/AboutPage/AboutPage'),
        ...defaultOptions,
      },
      {
        loader: () => ({ title: 'Brief' }),
        path: guiRoutes.brief,
        lazy: () => import('../pages/BriefPage/BriefPage'),
        ...defaultOptions,
      },
      {
        loader: () => ({ title: 'Playground' }),
        path: guiRoutes.playground,
        lazy: () => import('../pages/PlaygroundPage/PlaygroundPage'),
        ...defaultOptions,
      },
      {
        path: guiRoutes.contacts,
        lazy: () => import('../pages/ContactsPage/ContactsPage'),
        ...defaultOptions,
      },
      {
        loader: () => ({ title: 'Dashboard' }),
        path: guiRoutes.dashboard,
        lazy: () => import('../pages/DashboardPage/DashboardPage'),
        ...defaultOptions,
      },
      {
        loader: () => ({ title: 'Dicom Viewer' }),
        path: guiRoutes.dwv,
        lazy: () => import('../pages/DWVPage/DWVPage'),
        ...defaultOptions,
      },
      {
        element: (
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        ),
        // loader: requireAuth,
        children: [
          {
            loader: () => ({ title: 'Patients' }),
            path: guiRoutes.patients,
            lazy: () => import('../pages/PatientsPage/PatientsPage'),
            ...defaultOptions,
          },
        ],
      },
    ],
  },
]);
