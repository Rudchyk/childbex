import {
  LoaderFunctionArgs,
  createBrowserRouter,
  redirect,
} from 'react-router-dom';
import { appRoutes } from './appRoutes';

export async function requireAuth({ request }: LoaderFunctionArgs) {
  if (!window.keycloak?.authenticated) {
    throw redirect('/');
  }
  return null;
}

export default createBrowserRouter(appRoutes);
