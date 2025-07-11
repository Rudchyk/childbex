import { JSX } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import PeopleIcon from '@mui/icons-material/People';
import NextLink from 'next/link';
import { paths } from '@/lib/constants/paths';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';

const Page: React.FC = (): JSX.Element => {
  const links = [
    {
      href: paths.adminTrashedUsers,
      label: 'Users',
      icon: <PeopleIcon />,
    },
    {
      href: paths.adminTrashedPatients,
      label: 'Patients',
      icon: <LocalHospitalIcon />,
    },
  ];
  return (
    <nav>
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
