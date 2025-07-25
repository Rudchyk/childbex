import { Timestamps, SoftDeletion } from './Model.types';

export enum UserRoles {
  SUPER = 'super',
  ADMIN = 'admin',
  USER = 'user',
  DOCTOR = 'doctor',
}

export interface User extends Timestamps, SoftDeletion {
  id: string;
  email: string;
  name: string;
  role: UserRoles;
  password: string;
}

export type PublicUser = Omit<User, 'password'>;
