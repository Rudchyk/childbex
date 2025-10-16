import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Logout from '@mui/icons-material/Logout';
import LoginIcon from '@mui/icons-material/Login';
import PersonIcon from '@mui/icons-material/Person';
import { useAuth } from '../../../auth/useAuth';

export const HeaderAuth = () => {
  const { login, logout, authenticated, username } = useAuth();

  if (!authenticated) {
    return (
      <Tooltip title="login">
        <IconButton onClick={() => login()} color="inherit">
          <LoginIcon />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip title={username}>
        <Avatar sx={{ bgcolor: 'primary.main' }}>
          <PersonIcon />
        </Avatar>
      </Tooltip>
      <Tooltip title="logout">
        <IconButton onClick={() => logout()} color="inherit">
          <Logout />
        </IconButton>
      </Tooltip>
    </>
  );
};
