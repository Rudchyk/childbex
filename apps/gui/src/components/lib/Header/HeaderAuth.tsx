import Avatar from '@mui/material/Avatar';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Logout from '@mui/icons-material/Logout';
import LoginIcon from '@mui/icons-material/Login';
import PersonIcon from '@mui/icons-material/Person';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import { useAuth } from '../../../auth/useAuth';

export const HeaderAuth = () => {
  const { login, logout, authenticated, username, isAdmin, isDoctor, isUser } =
    useAuth();
  const getIcon = () => {
    if (isAdmin) {
      return <AdminPanelSettingsIcon />;
    } else if (isDoctor) {
      return <LocalHospitalIcon />;
    } else if (isUser) {
      return <PersonIcon />;
    } else {
      return <PsychologyAltIcon />;
    }
  };

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
        <Avatar sx={{ bgcolor: 'primary.main' }}>{getIcon()}</Avatar>
      </Tooltip>
      <Tooltip title="logout">
        <IconButton onClick={() => logout()} color="inherit">
          <Logout />
        </IconButton>
      </Tooltip>
    </>
  );
};
