import { JSX } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import PeopleIcon from '@mui/icons-material/People';
import DeleteIcon from '@mui/icons-material/Delete';
import NextLink from 'next/link';
import { paths } from '../../../lib/constants/paths';

const Page: React.FC = (): JSX.Element => {
  const links = [
    {
      href: paths.adminUsers,
      label: 'Users',
      icon: <PeopleIcon />,
    },
    {
      href: paths.adminTrash,
      label: 'Trash',
      icon: <DeleteIcon />,
    },
  ];
  return (
    <nav aria-label="main mailbox folders">
      <List>
        {links.map(({ href, icon, label }) => (
          <ListItem key={label + href} disablePadding>
            <ListItemButton LinkComponent={NextLink} href={href}>
              <ListItemIcon>{icon}</ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </nav>
  );
};

export default Page;
