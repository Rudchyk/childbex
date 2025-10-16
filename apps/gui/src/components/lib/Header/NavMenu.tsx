import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import { useState } from 'react';
import { Button, Stack } from '@mui/material';
import { Link as RouteLink } from 'react-router-dom';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import { guiRoutes } from '@libs/constants';

export const NavMenu = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
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
  return (
    <>
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        sx={{ display: { xs: 'none', md: 'flex' } }}
      >
        {menuItems.map(({ text, to }) => (
          <Button key={text + to} color="inherit" component={RouteLink} to={to}>
            {text}
          </Button>
        ))}
      </Stack>
      <Box
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'relative',
        }}
      >
        <IconButton
          size="large"
          aria-label="account of current user"
          aria-controls="menu-appbar"
          aria-haspopup="true"
          onClick={() => setMobileOpen(!mobileOpen)}
          color="inherit"
        >
          <MenuIcon />
        </IconButton>
      </Box>
      {mobileOpen && (
        <Box
          sx={{
            display: { xs: 'block', md: 'none' },
            position: 'absolute',
            width: '100%',
            left: 0,
            top: 56,
            zIndex: 1,
            backgroundColor: 'primary.main',
            ml: '0!important',
          }}
        >
          <List dense sx={{ p: 0, borderTop: '1px solid gray' }}>
            {menuItems.map(({ to, text }) => (
              <ListItem key={text + to} sx={{ borderBottom: '1px solid gray' }}>
                <ListItemButton
                  sx={{
                    justifyContent: 'center',
                  }}
                  component={RouteLink}
                  to={to}
                >
                  {text}
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </>
  );
};
