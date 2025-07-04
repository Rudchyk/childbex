import { ModelTimestamps, ModelSoftDeleted } from './Model.types';

export enum UserRoles {
  SUPER = 'super',
  ADMIN = 'admin',
  USER = 'user',
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRoles;
}

export interface UserModelAttributes
  extends User,
    ModelTimestamps,
    ModelSoftDeleted {
  password: string;
}

export type PublicUser = Omit<UserModelAttributes, 'password'>;
