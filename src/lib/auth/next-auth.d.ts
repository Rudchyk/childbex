import { DefaultSession } from 'next-auth';
import { PublicUser } from '@/types';

declare module 'next-auth' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends PublicUser {}
  interface Session extends DefaultSession {
    user: User;
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: UserRolesEnum;
  }
}
