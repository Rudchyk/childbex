import {
  Box,
  Tooltip,
  Button,
  Stack,
  Typography,
  MenuItem,
  Divider,
  IconButton,
  ListItemButton,
  Link,
  ListItemText,
} from '@mui/material';
import { useId, useState, MouseEvent } from 'react';
import PersonIcon from '@mui/icons-material/Person';
import StyledHeaderMenu from './StyledHeaderMenu';
import CloseIcon from '@mui/icons-material/Close';
import { guiRoutes } from '@libs/constants';
import { Link as RouteLink } from 'react-router-dom';

// TODO:
const userEmail = 'test@gmail.com';

export const HeaderMenu = () => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const id = useId();
  const open = Boolean(anchorEl);
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };
  const menuItems = [
    {
      to: guiRoutes.playground,
      text: 'Playground',
    },
    {
      to: guiRoutes.brief,
      text: 'Brief',
    },
  ];
  const logout = () => {
    alert('logout');
  };
  return (
    <Box>
      <Tooltip title={userEmail}>
        <IconButton
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClick}
          color="inherit"
        >
          <PersonIcon />
        </IconButton>
      </Tooltip>
      <StyledHeaderMenu anchorEl={anchorEl} open={open} onClose={handleClose}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          component="li"
        >
          <Typography variant="body2" color="#9F9F9F">
            <Tooltip title={userEmail}>
              <span>{userEmail}</span>
            </Tooltip>
          </Typography>
          <IconButton onClick={handleClose} color="inherit">
            <CloseIcon />
          </IconButton>
        </Stack>
        {menuItems.map(({ to, text }, index) => (
          <MenuItem key={`${id}-${index}`} component={RouteLink} to={to}>
            {text}
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={logout}>Log out</MenuItem>
      </StyledHeaderMenu>
    </Box>
  );
};
export default HeaderMenu;
