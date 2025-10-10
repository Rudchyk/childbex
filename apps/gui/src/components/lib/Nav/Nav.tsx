import { FC } from 'react';
import { Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { Link } from '@mui/material';
import { startCase } from 'lodash';

export const Nav: FC = () => {
  return (
    <nav>
      <ul>
        {Object.entries(guiRoutes).map(([key, url]) => (
          <li key={key}>
            <Link component={RouteLink} to={url}>
              {startCase(key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default Nav;
