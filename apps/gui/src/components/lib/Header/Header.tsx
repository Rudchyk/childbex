import { AppBar, Toolbar, Stack, Link } from '@mui/material';
import { ThemeSwitcher } from '../../../theme';
import { useBase } from '../../../store/slices';
import { Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';

export const Header = () => {
  const { title } = useBase();
  return (
    <AppBar position="static">
      <Toolbar>
        <Stack sx={{ flexGrow: 1 }} direction="row" alignItems="center">
          <Link
            component={RouteLink}
            to={guiRoutes.home}
            sx={{ display: 'inline-flex' }}
          >
            <img alt={title} src="/logo-white.svg" width={139} height={30} />
          </Link>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <ThemeSwitcher />
        </Stack>
      </Toolbar>
    </AppBar>
  );
};
