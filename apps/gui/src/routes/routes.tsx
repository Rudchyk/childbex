import { Outlet, createBrowserRouter } from 'react-router-dom';
import { NameSchema } from '@libs/schemas';
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
    path: guiRoutes.home,
    loader: () => ({ title: 'Home' }),
    element: <Outlet />,
    errorElement: <ErrorPage />,
    ...defaultOptions,
    children: [
      {
        index: true,
        loader: () => ({ title: JSON.stringify(NameSchema) }),
        lazy: () => import('../pages/HomePage/HomePage'),
        ...defaultOptions,
      },
      {
        loader: () => ({ title: 'About' }),
        path: guiRoutes.about,
        lazy: () => import('../pages/AboutPage/AboutPage'),
        ...defaultOptions,
      },
    ],
  },
]);
