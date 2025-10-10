import { LinearProgress } from '@mui/material';
import router from '../routes/routes';
import { RouterProvider } from 'react-router-dom';
import { StoreProvider } from '../providers';

export function App() {
  return (
    <StoreProvider>
      <RouterProvider router={router} fallbackElement={<LinearProgress />} />
    </StoreProvider>
  );
}

export default App;
