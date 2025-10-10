import { LinearProgress } from '@mui/material';
import router from '../routes/routes';
import { RouterProvider } from 'react-router-dom';
import { StoreProvider } from '../store/StoreProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { NotificationsProvider } from '../modules/notifications';
import { HeadProvider } from '../head/HeadProvider';

export function App() {
  return (
    <StoreProvider>
      <HeadProvider>
        <ThemeProvider>
          <NotificationsProvider>
            <RouterProvider
              router={router}
              fallbackElement={<LinearProgress />}
            />
          </NotificationsProvider>
        </ThemeProvider>
      </HeadProvider>
    </StoreProvider>
  );
}

export default App;
