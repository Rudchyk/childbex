import { UserRoles } from '../../types';

export const roleValues = Object.values(UserRoles).filter(
  (item) => item !== UserRoles.SUPER
) as UserRoles[];
