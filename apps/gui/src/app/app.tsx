import { LinearProgress } from '@mui/material';
import router from '../routes/routes';
import { RouterProvider } from 'react-router-dom';

export function App() {
  return (
    <RouterProvider router={router} fallbackElement={<LinearProgress />} />
  );
}

export default App;
