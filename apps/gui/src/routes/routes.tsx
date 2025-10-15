import { Outlet, createBrowserRouter } from 'react-router-dom';
import ErrorPage from '../pages/ErrorPage/ErrorPage';
import { LoaderData } from '../types';
import { guiRoutes } from '@libs/constants';

const defaultOptions = {
  handle: {
    crumb: (data: LoaderData) => data,
  },
};

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
    ],
  },
]);
